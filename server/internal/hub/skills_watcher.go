package hub

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

const skillsWatchDebounce = 750 * time.Millisecond

// skillsWatchReconcileInterval re-resolves watch targets periodically. The home
// directory itself is never watched (see reconcileWatches), so skill roots that
// appear after startup are discovered by this poll instead of by a parent watch.
const skillsWatchReconcileInterval = 30 * time.Second

type skillsWatchTarget struct {
	Scope       string
	ProjectID   string
	ProjectName string
	Root        string
}

type skillsWatcherOptions struct {
	Events    <-chan fsnotify.Event
	Errors    <-chan error
	Reconcile <-chan time.Time
	After     func(time.Duration) <-chan time.Time
	OnChange  func(skillsWatchTarget)
}

type skillsWatcher struct {
	mu        sync.Mutex
	targets   map[string]skillsWatchTarget
	pending   map[string]bool
	watched   map[string]struct{}
	watcher   *fsnotify.Watcher
	events    <-chan fsnotify.Event
	errors    <-chan error
	reconcile <-chan time.Time
	after     func(time.Duration) <-chan time.Time
	onChange  func(skillsWatchTarget)
	stop      chan struct{}
	done      chan struct{}
	close     sync.Once
	err       error
}

func newSkillsWatcher(options skillsWatcherOptions) *skillsWatcher {
	watcher := &skillsWatcher{
		targets:   map[string]skillsWatchTarget{},
		pending:   map[string]bool{},
		watched:   map[string]struct{}{},
		events:    options.Events,
		errors:    options.Errors,
		reconcile: options.Reconcile,
		after:     options.After,
		onChange:  options.OnChange,
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
	if watcher.after == nil {
		watcher.after = time.After
	}
	if watcher.events == nil {
		native, err := fsnotify.NewWatcher()
		if err != nil {
			watcher.err = err
		} else {
			watcher.watcher = native
			watcher.events = native.Events
			watcher.errors = native.Errors
		}
	}
	go watcher.run()
	return watcher
}

func (w *skillsWatcher) Error() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.err
}

func (w *skillsWatcher) watchedPathsForTest() map[string]struct{} {
	w.mu.Lock()
	defer w.mu.Unlock()
	out := make(map[string]struct{}, len(w.watched))
	for path := range w.watched {
		out[path] = struct{}{}
	}
	return out
}

func (w *skillsWatcher) TrackHub(home string) {
	home = cleanAbsolutePath(home)
	if home == "" {
		return
	}
	w.mu.Lock()
	w.targets["hub"] = skillsWatchTarget{Scope: "hub", Root: home}
	w.mu.Unlock()
	w.reconcileWatches()
}

func (w *skillsWatcher) TrackProject(projectID, projectName, root string) {
	projectID = strings.TrimSpace(projectID)
	root = cleanAbsolutePath(root)
	if projectID == "" || root == "" {
		return
	}
	w.mu.Lock()
	w.targets["project:"+projectID] = skillsWatchTarget{
		Scope:       "project",
		ProjectID:   projectID,
		ProjectName: strings.TrimSpace(projectName),
		Root:        root,
	}
	w.mu.Unlock()
	w.reconcileWatches()
}

func (w *skillsWatcher) RemoveProject(projectID string) {
	key := "project:" + strings.TrimSpace(projectID)
	w.mu.Lock()
	delete(w.targets, key)
	delete(w.pending, key)
	w.mu.Unlock()
	w.reconcileWatches()
}

func (w *skillsWatcher) ReplaceProjects(targets []projectSkillsTarget) {
	next := make(map[string]projectSkillsTarget, len(targets))
	for _, target := range targets {
		next[target.ProjectID] = target
	}
	w.mu.Lock()
	for key, target := range w.targets {
		if target.Scope != "project" {
			continue
		}
		if _, ok := next[target.ProjectID]; !ok {
			delete(w.targets, key)
			delete(w.pending, key)
		}
	}
	for _, target := range next {
		name := target.ProjectID
		if index := strings.LastIndex(name, ":"); index >= 0 {
			name = name[index+1:]
		}
		w.targets["project:"+target.ProjectID] = skillsWatchTarget{
			Scope:       "project",
			ProjectID:   target.ProjectID,
			ProjectName: name,
			Root:        cleanAbsolutePath(target.Path),
		}
	}
	w.mu.Unlock()
	w.reconcileWatches()
}

func (w *skillsWatcher) Close() error {
	var closeErr error
	w.close.Do(func() {
		close(w.stop)
		<-w.done
		if w.watcher != nil {
			closeErr = w.watcher.Close()
		}
	})
	return closeErr
}

func (w *skillsWatcher) run() {
	defer close(w.done)
	events := w.events
	errors := w.errors
	reconcileEvents := w.reconcile
	var reconcileTicker *time.Ticker
	if reconcileEvents == nil {
		reconcileTicker = time.NewTicker(skillsWatchReconcileInterval)
		reconcileEvents = reconcileTicker.C
		defer reconcileTicker.Stop()
	}
	for {
		select {
		case <-w.stop:
			return
		case <-reconcileEvents:
			w.notifyTargets(w.reconcileWatches())
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			w.handleEvent(event)
		case err, ok := <-errors:
			if !ok {
				errors = nil
				continue
			}
			if err != nil {
				w.mu.Lock()
				w.err = err
				w.mu.Unlock()
			}
		}
	}
}

func (w *skillsWatcher) notifyTargets(keys []string) {
	for _, key := range keys {
		w.mu.Lock()
		target, stillTracked := w.targets[key]
		callback := w.onChange
		w.mu.Unlock()
		if stillTracked && callback != nil {
			callback(target)
		}
	}
}

func (w *skillsWatcher) handleEvent(event fsnotify.Event) {
	if event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Remove|fsnotify.Rename) == 0 {
		return
	}
	key, target, ok := w.matchTarget(event.Name)
	if !ok {
		return
	}
	w.reconcileWatches()
	w.mu.Lock()
	if w.pending[key] {
		w.mu.Unlock()
		return
	}
	w.pending[key] = true
	after := w.after
	w.mu.Unlock()
	go func() {
		select {
		case <-w.stop:
			return
		case <-after(skillsWatchDebounce):
		}
		w.mu.Lock()
		delete(w.pending, key)
		current, stillTracked := w.targets[key]
		callback := w.onChange
		w.mu.Unlock()
		if stillTracked && callback != nil {
			callback(current)
		}
	}()
	_ = target
}

func (w *skillsWatcher) matchTarget(path string) (string, skillsWatchTarget, bool) {
	path = normalizeWatchPath(path)
	w.mu.Lock()
	defer w.mu.Unlock()
	for key, target := range w.targets {
		if target.Scope != "project" {
			continue
		}
		if relevantProjectSkillPath(target.Root, path) {
			return key, target, true
		}
	}
	if target, ok := w.targets["hub"]; ok && relevantHubSkillPath(target.Root, path) {
		return "hub", target, true
	}
	return "", skillsWatchTarget{}, false
}

func relevantProjectSkillPath(root, path string) bool {
	root = normalizeWatchPath(root)
	return path == normalizeWatchPath(filepath.Join(root, "skills-lock.json")) ||
		pathWithin(path, filepath.Join(root, ".agents")) ||
		pathWithin(path, filepath.Join(root, ".claude"))
}

func relevantHubSkillPath(home, path string) bool {
	home = normalizeWatchPath(home)
	return path == normalizeWatchPath(filepath.Join(home, ".agents", ".skill-lock.json")) ||
		pathWithin(path, filepath.Join(home, ".agents")) ||
		pathWithin(path, filepath.Join(home, ".claude"))
}

func pathWithin(path, root string) bool {
	path = normalizeWatchPath(path)
	root = normalizeWatchPath(root)
	return path == root || strings.HasPrefix(path, root+string(filepath.Separator))
}

func (w *skillsWatcher) reconcileWatches() []string {
	if w.watcher == nil {
		return nil
	}
	w.mu.Lock()
	targets := make(map[string]skillsWatchTarget, len(w.targets))
	for key, target := range w.targets {
		targets[key] = target
	}
	w.mu.Unlock()

	desired := map[string]struct{}{}
	owners := map[string]map[string]struct{}{}
	for key, target := range targets {
		targetDesired := map[string]struct{}{}
		// Never watch the target root when it is the user home directory. On
		// macOS fsnotify uses kqueue, and adding a directory opens every entry
		// inside it, which touches TCC-protected folders such as ~/Desktop,
		// ~/Documents and ~/Downloads and triggers privacy prompts. Hub scope is
		// always rooted at home; a project may also be configured with "~".
		if shouldWatchTargetRoot(target) {
			addExistingWatchDir(targetDesired, target.Root)
		}
		for _, relative := range []string{".agents", filepath.Join(".agents", "skills"), ".claude", filepath.Join(".claude", "skills")} {
			root := filepath.Join(target.Root, relative)
			addExistingWatchDir(targetDesired, root)
			if strings.HasSuffix(filepath.ToSlash(relative), "/skills") {
				entries, _ := os.ReadDir(root)
				for _, entry := range entries {
					if entry.IsDir() {
						addExistingWatchDir(targetDesired, filepath.Join(root, entry.Name()))
					}
				}
			}
		}
		for path := range targetDesired {
			desired[path] = struct{}{}
			if owners[path] == nil {
				owners[path] = map[string]struct{}{}
			}
			owners[path][key] = struct{}{}
		}
	}

	w.mu.Lock()
	addedTargets := map[string]struct{}{}
	for path := range desired {
		if _, exists := w.watched[path]; exists {
			continue
		}
		if err := w.watcher.Add(path); err != nil {
			w.err = err
			continue
		}
		w.watched[path] = struct{}{}
		for key := range owners[path] {
			addedTargets[key] = struct{}{}
		}
	}
	for path := range w.watched {
		if _, keep := desired[path]; keep {
			continue
		}
		_ = w.watcher.Remove(path)
		delete(w.watched, path)
	}
	w.mu.Unlock()
	keys := make([]string, 0, len(addedTargets))
	for key := range addedTargets {
		keys = append(keys, key)
	}
	return keys
}

func addExistingWatchDir(paths map[string]struct{}, path string) {
	info, err := os.Stat(path)
	if err == nil && info.IsDir() {
		paths[filepath.Clean(path)] = struct{}{}
	}
}

// shouldWatchTargetRoot reports whether a target root may be watched directly.
// Hub scope roots are always the user home directory and are only used as a
// prefix for ~/.agents and ~/.claude, which are watched explicitly, so watching
// the root adds nothing. Project scope roots must be watched to observe
// skills-lock.json, unless the project is rooted at the home directory.
func shouldWatchTargetRoot(target skillsWatchTarget) bool {
	if target.Scope == "hub" {
		return false
	}
	return !isUserHomeDir(target.Root)
}

func isUserHomeDir(path string) bool {
	home, err := os.UserHomeDir()
	if err != nil {
		return false
	}
	home = cleanAbsolutePath(home)
	if home == "" {
		return false
	}
	return normalizeWatchPath(path) == normalizeWatchPath(home)
}

func cleanAbsolutePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		return ""
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return ""
	}
	return filepath.Clean(absolute)
}

func normalizeWatchPath(path string) string {
	return strings.ToLower(filepath.Clean(path))
}
