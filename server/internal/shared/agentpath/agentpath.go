// Package agentpath discovers directories that should be on PATH so the hub can
// launch globally-installed agent CLIs (e.g. @openai/codex) even when it was
// started from a minimal environment such as a service/updater context.
package agentpath

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// toolNames are CLIs we want resolvable so the hub and its agent runtimes work.
var toolNames = []string{"node", "npm", "npx", "codex"}

// Resolver discovers PATH entries missing from the current PATH.
// All fields are injected so the logic is unit-testable across platforms.
type Resolver struct {
	// GOOS selects platform-specific behavior ("windows" vs anything else).
	GOOS string
	// HomeDir is the user home directory ($HOME / %USERPROFILE%).
	HomeDir string
	// AppDataDir is the Windows per-user app-data dir (%APPDATA%).
	AppDataDir string
	// ProgramFilesDir is the Windows Program Files dir.
	ProgramFilesDir string
	// EnvPath is the current PATH value to dedupe against.
	EnvPath string
	// LookPath resolves a binary name to its path (defaults to exec.LookPath).
	LookPath func(file string) (string, error)
	// NpmPrefix returns npm's global prefix (`npm prefix -g`).
	NpmPrefix func() (string, error)
}

// DefaultResolver returns a Resolver bound to the current process environment.
func DefaultResolver() *Resolver {
	home, _ := os.UserHomeDir()
	return &Resolver{
		GOOS:            runtime.GOOS,
		HomeDir:         home,
		AppDataDir:      os.Getenv("APPDATA"),
		ProgramFilesDir: os.Getenv("ProgramFiles"),
		EnvPath:         os.Getenv("PATH"),
		LookPath:        exec.LookPath,
		NpmPrefix:       defaultNpmGlobalPrefix,
	}
}

func defaultNpmGlobalPrefix() (string, error) {
	out, err := exec.Command("npm", "prefix", "-g").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// DiscoverExtraDirs returns the PATH entries the current environment is missing,
// using DefaultResolver.
func DiscoverExtraDirs() []string {
	return DefaultResolver().ExtraDirs()
}

// ExtraDirs returns directories that should be appended to PATH so globally
// installed CLIs become resolvable. The result is stable, unique, and excludes
// any directory already present on EnvPath.
//
// Discovery strategies, in order:
//  1. Directory of each resolvable tool binary (node/npm/npx/codex).
//  2. npm's global prefix bin directory (where `npm install -g` places shims).
//  3. Platform-specific fallback locations for common global installs.
func (r *Resolver) ExtraDirs() []string {
	if r == nil {
		return nil
	}
	goos := r.GOOS
	if goos == "" {
		goos = runtime.GOOS
	}
	sep := pathListSeparator(goos)

	seen := make(map[string]bool)
	for _, dir := range splitPath(r.EnvPath, sep) {
		seen[filepath.Clean(dir)] = true
	}

	var dirs []string
	add := func(dir string) {
		dir = strings.TrimSpace(dir)
		if dir == "" {
			return
		}
		cleaned := filepath.Clean(dir)
		if seen[cleaned] {
			return
		}
		seen[cleaned] = true
		dirs = append(dirs, dir)
	}

	for _, name := range toolNames {
		if r.LookPath != nil {
			if path, err := r.LookPath(name); err == nil {
				add(filepath.Dir(path))
			}
		}
	}

	if r.NpmPrefix != nil {
		if prefix, err := r.NpmPrefix(); err == nil {
			if goos == "windows" {
				// Windows: the prefix itself is the global bin dir (e.g. %APPDATA%\npm).
				add(prefix)
			} else {
				add(filepath.Join(prefix, "bin"))
			}
		}
	}

	for _, dir := range r.platformFallbackDirs(goos) {
		add(dir)
	}

	return dirs
}

func (r *Resolver) platformFallbackDirs(goos string) []string {
	switch goos {
	case "windows":
		var dirs []string
		if r.AppDataDir != "" {
			dirs = append(dirs, filepath.Join(r.AppDataDir, "npm"))
		}
		if r.ProgramFilesDir != "" {
			dirs = append(dirs, filepath.Join(r.ProgramFilesDir, "nodejs"))
		}
		return dirs
	default:
		dirs := []string{"/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"}
		if r.HomeDir != "" {
			dirs = append(dirs,
				filepath.Join(r.HomeDir, ".npm-global", "bin"),
				filepath.Join(r.HomeDir, ".local", "bin"),
			)
		}
		return dirs
	}
}

// AppendToPath appends dirs to the process PATH environment variable using the
// host's path-list separator. It is a no-op when dirs is empty.
func AppendToPath(dirs []string) {
	if len(dirs) == 0 {
		return
	}
	cur := os.Getenv("PATH")
	parts := make([]string, 0, len(dirs)+1)
	if cur != "" {
		parts = append(parts, cur)
	}
	parts = append(parts, dirs...)
	_ = os.Setenv("PATH", strings.Join(parts, string(os.PathListSeparator)))
}

func pathListSeparator(goos string) string {
	if goos == "windows" {
		return ";"
	}
	return ":"
}

func splitPath(raw, sep string) []string {
	if raw == "" {
		return nil
	}
	var dirs []string
	for _, dir := range strings.Split(raw, sep) {
		if dir != "" {
			dirs = append(dirs, dir)
		}
	}
	return dirs
}
