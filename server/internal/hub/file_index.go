package hub

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/sahilm/fuzzy"
)

const (
	projectFileIndexStatusMissing  = "missing"
	projectFileIndexStatusIndexed  = "indexed"
	projectFileIndexStatusScanning = "scanning"
	projectFileIndexStatusError    = "error"

	projectFileIndexDefaultLimit       = 20
	projectFileIndexMaxLimit           = 100
	projectFileIndexQuerySessionTTL    = 30 * time.Second
	projectFileIndexQuerySessionMaxSet = 5000
)

type projectFileIndexManager struct {
	baseDir string

	mu            sync.Mutex
	snapshots     map[string]projectFileIndexSnapshot
	running       map[string]bool
	lastErrors    map[string]string
	querySessions map[string]projectFileIndexQuerySession

	scanFilesForTest func(context.Context, projectFileIndexProject) ([]string, error)
	now              func() time.Time
}

type projectFileIndexProject struct {
	ProjectID string
	Name      string
	Root      string
}

type projectFileIndexSnapshot struct {
	ProjectID string
	Name      string
	Path      string
	Status    string
	FileCount int
	IndexedAt string
	IndexPath string
	Paths     []string
}

type projectFileIndexStatusResponse struct {
	HubID    string                   `json:"hubId,omitempty"`
	Projects []projectFileIndexStatus `json:"projects"`
}

type projectFileIndexStatus struct {
	ProjectID string `json:"projectId"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	Status    string `json:"status"`
	FileCount int    `json:"fileCount"`
	IndexedAt string `json:"indexedAt,omitempty"`
	IndexPath string `json:"indexPath,omitempty"`
	Running   bool   `json:"running"`
	Error     string `json:"error,omitempty"`
}

type projectFileIndexRebuildResponse struct {
	OK             bool   `json:"ok"`
	Accepted       bool   `json:"accepted"`
	AlreadyRunning bool   `json:"alreadyRunning,omitempty"`
	Running        bool   `json:"running"`
	ProjectID      string `json:"projectId"`
	Status         string `json:"status"`
	Error          string `json:"error,omitempty"`
}

type projectFileIndexSearchRequest struct {
	Query          string `json:"query"`
	QuerySessionID string `json:"querySessionId,omitempty"`
	QueryID        int    `json:"queryId,omitempty"`
	Limit          int    `json:"limit,omitempty"`
}

type projectFileIndexSearchResponse struct {
	Query          string                         `json:"query"`
	QuerySessionID string                         `json:"querySessionId,omitempty"`
	QueryID        int                            `json:"queryId,omitempty"`
	Status         string                         `json:"status"`
	Indexed        bool                           `json:"indexed"`
	FileCount      int                            `json:"fileCount"`
	Results        []projectFileIndexSearchResult `json:"results"`
	Error          string                         `json:"error,omitempty"`
}

type projectFileIndexSearchResult struct {
	Path  string `json:"path"`
	Name  string `json:"name"`
	Score int    `json:"score"`
}

type projectFileIndexQuerySession struct {
	query     string
	queryID   int
	paths     []string
	updatedAt time.Time
}

type projectFileIndexRankedPath struct {
	path  string
	score int
}

func newProjectFileIndexManager(baseDir string) *projectFileIndexManager {
	baseDir = strings.TrimSpace(baseDir)
	return &projectFileIndexManager{
		baseDir:       baseDir,
		snapshots:     map[string]projectFileIndexSnapshot{},
		running:       map[string]bool{},
		lastErrors:    map[string]string{},
		querySessions: map[string]projectFileIndexQuerySession{},
		now:           time.Now,
	}
}

func (m *projectFileIndexManager) startRebuild(ctx context.Context, project projectFileIndexProject) projectFileIndexRebuildResponse {
	project = normalizeProjectFileIndexProject(project)
	if project.ProjectID == "" {
		return projectFileIndexRebuildResponse{OK: false, Status: projectFileIndexStatusError, Error: "projectId is required"}
	}
	m.mu.Lock()
	if m.running[project.ProjectID] {
		m.mu.Unlock()
		return projectFileIndexRebuildResponse{
			OK:             true,
			Accepted:       true,
			AlreadyRunning: true,
			Running:        true,
			ProjectID:      project.ProjectID,
			Status:         projectFileIndexStatusScanning,
		}
	}
	m.running[project.ProjectID] = true
	delete(m.lastErrors, project.ProjectID)
	m.mu.Unlock()

	go func() {
		_, err := m.rebuildNow(ctx, project)
		m.mu.Lock()
		if err != nil {
			m.lastErrors[project.ProjectID] = err.Error()
			if _, ok := m.snapshots[project.ProjectID]; !ok {
				m.snapshots[project.ProjectID] = projectFileIndexSnapshot{
					ProjectID: project.ProjectID,
					Name:      project.Name,
					Path:      project.Root,
					Status:    projectFileIndexStatusError,
					IndexPath: m.indexPath(project.Name),
				}
			}
		}
		m.running[project.ProjectID] = false
		m.clearQuerySessionsLocked(project.ProjectID)
		m.mu.Unlock()
	}()

	return projectFileIndexRebuildResponse{
		OK:        true,
		Accepted:  true,
		Running:   true,
		ProjectID: project.ProjectID,
		Status:    projectFileIndexStatusScanning,
	}
}

func (m *projectFileIndexManager) rebuildNow(ctx context.Context, project projectFileIndexProject) (projectFileIndexSnapshot, error) {
	project = normalizeProjectFileIndexProject(project)
	if project.ProjectID == "" {
		return projectFileIndexSnapshot{}, fmt.Errorf("projectId is required")
	}
	if project.Root == "" {
		return projectFileIndexSnapshot{}, fmt.Errorf("project root is required")
	}
	paths, err := m.scanFiles(ctx, project)
	if err != nil {
		return projectFileIndexSnapshot{}, err
	}
	if err := m.writeIndexFile(project, paths); err != nil {
		return projectFileIndexSnapshot{}, err
	}
	snapshot := projectFileIndexSnapshot{
		ProjectID: project.ProjectID,
		Name:      project.Name,
		Path:      project.Root,
		Status:    projectFileIndexStatusIndexed,
		FileCount: len(paths),
		IndexedAt: m.now().UTC().Format(time.RFC3339),
		IndexPath: m.indexPath(project.Name),
		Paths:     paths,
	}
	m.mu.Lock()
	m.snapshots[project.ProjectID] = snapshot
	delete(m.lastErrors, project.ProjectID)
	m.clearQuerySessionsLocked(project.ProjectID)
	m.mu.Unlock()
	return snapshot, nil
}

func (m *projectFileIndexManager) status(projects []projectFileIndexProject) projectFileIndexStatusResponse {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneQuerySessionsLocked()
	out := make([]projectFileIndexStatus, 0, len(projects))
	for _, project := range projects {
		project = normalizeProjectFileIndexProject(project)
		snapshot := m.snapshotLocked(project)
		running := m.running[project.ProjectID]
		status := snapshot.Status
		if status == "" {
			status = projectFileIndexStatusMissing
		}
		if running {
			status = projectFileIndexStatusScanning
		}
		out = append(out, projectFileIndexStatus{
			ProjectID: project.ProjectID,
			Name:      project.Name,
			Path:      project.Root,
			Status:    status,
			FileCount: snapshot.FileCount,
			IndexedAt: snapshot.IndexedAt,
			IndexPath: snapshot.IndexPath,
			Running:   running,
			Error:     m.lastErrors[project.ProjectID],
		})
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return projectFileIndexStatusResponse{Projects: out}
}

func (m *projectFileIndexManager) search(ctx context.Context, project projectFileIndexProject, req projectFileIndexSearchRequest) (projectFileIndexSearchResponse, error) {
	_ = ctx
	project = normalizeProjectFileIndexProject(project)
	limit := req.Limit
	if limit <= 0 {
		limit = projectFileIndexDefaultLimit
	}
	if limit > projectFileIndexMaxLimit {
		limit = projectFileIndexMaxLimit
	}
	query := strings.TrimSpace(req.Query)

	m.mu.Lock()
	snapshot := m.snapshotLocked(project)
	running := m.running[project.ProjectID]
	status := snapshot.Status
	if status == "" {
		status = projectFileIndexStatusMissing
	}
	if running {
		status = projectFileIndexStatusScanning
	}
	indexed := snapshot.Status == projectFileIndexStatusIndexed
	if !indexed {
		errText := m.lastErrors[project.ProjectID]
		m.mu.Unlock()
		return projectFileIndexSearchResponse{
			Query:          query,
			QuerySessionID: strings.TrimSpace(req.QuerySessionID),
			QueryID:        req.QueryID,
			Status:         status,
			Indexed:        false,
			FileCount:      snapshot.FileCount,
			Results:        []projectFileIndexSearchResult{},
			Error:          errText,
		}, nil
	}
	paths := append([]string(nil), snapshot.Paths...)
	workingPaths := m.workingSetLocked(project.ProjectID, paths, query, req)
	m.mu.Unlock()

	ranked := rankProjectFileIndexPaths(query, workingPaths)
	results := make([]projectFileIndexSearchResult, 0, minInt(limit, len(ranked)))
	workingSet := make([]string, 0, minInt(projectFileIndexQuerySessionMaxSet, len(ranked)))
	for index, item := range ranked {
		if index < projectFileIndexQuerySessionMaxSet {
			workingSet = append(workingSet, item.path)
		}
		if len(results) >= limit {
			continue
		}
		results = append(results, projectFileIndexSearchResult{
			Path:  item.path,
			Name:  filepath.Base(filepath.FromSlash(item.path)),
			Score: item.score,
		})
	}
	if query == "" {
		for _, path := range workingPaths {
			if len(workingSet) < projectFileIndexQuerySessionMaxSet {
				workingSet = append(workingSet, path)
			}
			if len(results) >= limit {
				continue
			}
			results = append(results, projectFileIndexSearchResult{
				Path: path,
				Name: filepath.Base(filepath.FromSlash(path)),
			})
		}
	}

	m.mu.Lock()
	m.storeQuerySessionLocked(project.ProjectID, query, req, workingSet)
	m.mu.Unlock()

	return projectFileIndexSearchResponse{
		Query:          query,
		QuerySessionID: strings.TrimSpace(req.QuerySessionID),
		QueryID:        req.QueryID,
		Status:         status,
		Indexed:        true,
		FileCount:      snapshot.FileCount,
		Results:        results,
	}, nil
}

func (m *projectFileIndexManager) scanFiles(ctx context.Context, project projectFileIndexProject) ([]string, error) {
	if m.scanFilesForTest != nil {
		paths, err := m.scanFilesForTest(ctx, project)
		if err != nil {
			return nil, err
		}
		return normalizeProjectFileIndexPaths(project.Root, paths), nil
	}
	if paths, err := scanGitProjectFileIndex(ctx, project.Root); err == nil {
		return paths, nil
	}
	return scanWalkProjectFileIndex(project.Root)
}

func (m *projectFileIndexManager) writeIndexFile(project projectFileIndexProject, paths []string) error {
	indexPath := m.indexPath(project.Name)
	if err := os.MkdirAll(filepath.Dir(indexPath), 0o755); err != nil {
		return fmt.Errorf("create index dir: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(indexPath), "file-index-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp index: %w", err)
	}
	tmpPath := tmp.Name()
	removeTmp := true
	defer func() {
		if removeTmp {
			_ = os.Remove(tmpPath)
		}
	}()
	content := strings.Join(paths, "\n")
	if content != "" {
		content += "\n"
	}
	if _, err := tmp.WriteString(content); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp index: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp index: %w", err)
	}
	if err := replaceFileIndex(tmpPath, indexPath); err != nil {
		return fmt.Errorf("replace index: %w", err)
	}
	removeTmp = false
	return nil
}

func (m *projectFileIndexManager) indexPath(projectName string) string {
	return filepath.Join(m.baseDir, "db", "ext", fileIndexSafePathPart(projectName), "file-index.txt")
}

func (m *projectFileIndexManager) snapshotLocked(project projectFileIndexProject) projectFileIndexSnapshot {
	if snapshot, ok := m.snapshots[project.ProjectID]; ok {
		snapshot.Name = project.Name
		snapshot.Path = project.Root
		return snapshot
	}
	snapshot := m.loadSnapshotFromDiskLocked(project)
	m.snapshots[project.ProjectID] = snapshot
	return snapshot
}

func (m *projectFileIndexManager) loadSnapshotFromDiskLocked(project projectFileIndexProject) projectFileIndexSnapshot {
	indexPath := m.indexPath(project.Name)
	raw, err := os.ReadFile(indexPath)
	if err != nil {
		return projectFileIndexSnapshot{
			ProjectID: project.ProjectID,
			Name:      project.Name,
			Path:      project.Root,
			Status:    projectFileIndexStatusMissing,
			IndexPath: indexPath,
		}
	}
	paths := parseProjectFileIndexLines(string(raw))
	indexedAt := ""
	if info, statErr := os.Stat(indexPath); statErr == nil {
		indexedAt = info.ModTime().UTC().Format(time.RFC3339)
	}
	return projectFileIndexSnapshot{
		ProjectID: project.ProjectID,
		Name:      project.Name,
		Path:      project.Root,
		Status:    projectFileIndexStatusIndexed,
		FileCount: len(paths),
		IndexedAt: indexedAt,
		IndexPath: indexPath,
		Paths:     paths,
	}
}

func (m *projectFileIndexManager) workingSetLocked(projectID string, paths []string, query string, req projectFileIndexSearchRequest) []string {
	querySessionID := strings.TrimSpace(req.QuerySessionID)
	if querySessionID == "" || query == "" {
		return paths
	}
	key := projectID + "\x00" + querySessionID
	session, ok := m.querySessions[key]
	if !ok {
		return paths
	}
	if m.now().Sub(session.updatedAt) > projectFileIndexQuerySessionTTL {
		delete(m.querySessions, key)
		return paths
	}
	if req.QueryID == session.queryID+1 && strings.HasPrefix(strings.ToLower(query), strings.ToLower(session.query)) {
		return append([]string(nil), session.paths...)
	}
	return paths
}

func (m *projectFileIndexManager) storeQuerySessionLocked(projectID string, query string, req projectFileIndexSearchRequest, paths []string) {
	querySessionID := strings.TrimSpace(req.QuerySessionID)
	if querySessionID == "" {
		return
	}
	key := projectID + "\x00" + querySessionID
	m.querySessions[key] = projectFileIndexQuerySession{
		query:     query,
		queryID:   req.QueryID,
		paths:     append([]string(nil), paths...),
		updatedAt: m.now(),
	}
	m.pruneQuerySessionsLocked()
}

func (m *projectFileIndexManager) clearQuerySessionsLocked(projectID string) {
	prefix := projectID + "\x00"
	for key := range m.querySessions {
		if strings.HasPrefix(key, prefix) {
			delete(m.querySessions, key)
		}
	}
}

func (m *projectFileIndexManager) pruneQuerySessionsLocked() {
	now := m.now()
	for key, session := range m.querySessions {
		if now.Sub(session.updatedAt) > projectFileIndexQuerySessionTTL {
			delete(m.querySessions, key)
		}
	}
}

func scanGitProjectFileIndex(ctx context.Context, root string) ([]string, error) {
	cmd := exec.CommandContext(ctx, "git", "ls-files", "--cached", "--others", "--exclude-standard")
	cmd.Dir = root
	out, err := cmd.Output()
	if err != nil {
		return nil, err
	}
	return normalizeProjectFileIndexPaths(root, strings.Split(strings.ReplaceAll(string(out), "\r\n", "\n"), "\n")), nil
}

func scanWalkProjectFileIndex(root string) ([]string, error) {
	var paths []string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if path == root {
			return nil
		}
		if entry.IsDir() {
			if entry.Name() == ".git" || entry.Type()&os.ModeSymlink != 0 {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			info, statErr := os.Stat(path)
			if statErr != nil || info.IsDir() {
				return nil
			}
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return nil
		}
		paths = append(paths, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return nil, err
	}
	return normalizeProjectFileIndexPaths(root, paths), nil
}

func normalizeProjectFileIndexPaths(root string, paths []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(paths))
	for _, path := range paths {
		clean := cleanProjectFileIndexPath(path)
		if clean == "" || seen[clean] {
			continue
		}
		if !projectFileIndexPathIsFile(root, clean) {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
	}
	sort.Strings(out)
	return out
}

func cleanProjectFileIndexPath(path string) string {
	path = strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	if path == "" {
		return ""
	}
	clean := filepath.ToSlash(filepath.Clean(filepath.FromSlash(path)))
	if clean == "." || filepath.IsAbs(filepath.FromSlash(clean)) || strings.HasPrefix(clean, "../") || clean == ".." || strings.Contains(clean, `:\`) {
		return ""
	}
	return clean
}

func projectFileIndexPathIsFile(root, rel string) bool {
	target := filepath.Join(root, filepath.FromSlash(rel))
	info, err := os.Lstat(target)
	if err != nil {
		return false
	}
	if info.IsDir() {
		return false
	}
	if info.Mode()&os.ModeSymlink != 0 {
		resolved, statErr := os.Stat(target)
		return statErr == nil && !resolved.IsDir()
	}
	return info.Mode().IsRegular()
}

func parseProjectFileIndexLines(raw string) []string {
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	seen := map[string]bool{}
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		clean := cleanProjectFileIndexPath(line)
		if clean == "" || seen[clean] {
			continue
		}
		seen[clean] = true
		out = append(out, clean)
	}
	sort.Strings(out)
	return out
}

func rankProjectFileIndexPaths(query string, paths []string) []projectFileIndexRankedPath {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil
	}
	names := make([]string, len(paths))
	for i, path := range paths {
		names[i] = filepath.Base(filepath.FromSlash(path))
	}
	scoreByPath := map[string]int{}
	lowerQuery := strings.ToLower(query)
	for _, match := range fuzzy.Find(query, names) {
		path := paths[match.Index]
		score := 2_000_000 + match.Score
		lowerName := strings.ToLower(names[match.Index])
		if strings.HasPrefix(lowerName, lowerQuery) {
			score += 100_000
		} else if strings.Contains(lowerName, lowerQuery) {
			score += 50_000
		}
		scoreByPath[path] = maxInt(scoreByPath[path], score)
	}
	for _, match := range fuzzy.Find(query, paths) {
		path := paths[match.Index]
		score := 1_000_000 + match.Score
		lowerPath := strings.ToLower(path)
		if strings.HasPrefix(lowerPath, lowerQuery) {
			score += 100_000
		} else if strings.Contains(lowerPath, lowerQuery) {
			score += 50_000
		}
		scoreByPath[path] = maxInt(scoreByPath[path], score)
	}
	ranked := make([]projectFileIndexRankedPath, 0, len(scoreByPath))
	for path, score := range scoreByPath {
		ranked = append(ranked, projectFileIndexRankedPath{path: path, score: score})
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return ranked[i].path < ranked[j].path
	})
	return ranked
}

func replaceFileIndex(tmpPath, indexPath string) error {
	if err := os.Rename(tmpPath, indexPath); err == nil {
		return nil
	}
	if _, statErr := os.Stat(indexPath); statErr != nil {
		return os.Rename(tmpPath, indexPath)
	}
	backupPath := indexPath + ".bak-" + strconvTimeSuffix(time.Now())
	if err := os.Rename(indexPath, backupPath); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, indexPath); err != nil {
		_ = os.Rename(backupPath, indexPath)
		return err
	}
	_ = os.Remove(backupPath)
	return nil
}

func fileIndexSafePathPart(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		value = "project"
	}
	value = strings.NewReplacer(
		"\\", "_",
		"/", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
	).Replace(value)
	if value == "." || value == ".." {
		return "_"
	}
	return value
}

func normalizeProjectFileIndexProject(project projectFileIndexProject) projectFileIndexProject {
	project.ProjectID = strings.TrimSpace(project.ProjectID)
	project.Name = strings.TrimSpace(project.Name)
	project.Root = strings.TrimSpace(project.Root)
	return project
}

func strconvTimeSuffix(t time.Time) string {
	return strings.ReplaceAll(fmt.Sprintf("%d", t.UnixNano()), "-", "")
}
