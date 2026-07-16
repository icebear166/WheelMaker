package agentpath

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

var errNotFound = errors.New("not found")

func nopLookPath(string) (string, error) { return "", errNotFound }

func containsDir(haystack []string, needle string) bool {
	for _, item := range haystack {
		if item == needle {
			return true
		}
	}
	return false
}

func TestExtraDirs_AppendsNpmBinOnUnix(t *testing.T) {
	r := &Resolver{
		GOOS:      "linux",
		EnvPath:   "/usr/bin", // dedupes the /usr/bin fallback
		LookPath:  nopLookPath,
		NpmPrefix: func() (string, error) { return "/usr/local", nil },
	}
	got := r.ExtraDirs()
	wantBin := filepath.Join("/usr/local", "bin")
	if !containsDir(got, wantBin) {
		t.Fatalf("ExtraDirs=%v, want npm bin %q", got, wantBin)
	}
	if containsDir(got, "/usr/bin") {
		t.Fatalf("dir already on EnvPath must be excluded: %v", got)
	}
}

func TestExtraDirs_UsesNpmPrefixDirectlyOnWindows(t *testing.T) {
	prefix := `C:\Users\me\AppData\Roaming\npm`
	r := &Resolver{
		GOOS:      "windows",
		EnvPath:   `C:\Windows\System32`,
		LookPath:  nopLookPath,
		NpmPrefix: func() (string, error) { return prefix, nil },
	}
	got := r.ExtraDirs()
	if len(got) != 1 || got[0] != prefix {
		t.Fatalf("ExtraDirs=%v, want [%q] (windows uses npm prefix directly)", got, prefix)
	}
}

func TestExtraDirs_AppDataFallbackOnWindowsWhenNpmMissing(t *testing.T) {
	appData := `C:\Users\me\AppData\Roaming`
	r := &Resolver{
		GOOS:       "windows",
		AppDataDir: appData,
		EnvPath:    `C:\Windows\System32`,
		LookPath:   nopLookPath,
		NpmPrefix:  func() (string, error) { return "", errNotFound },
	}
	got := r.ExtraDirs()
	want := filepath.Join(appData, "npm")
	if !containsDir(got, want) {
		t.Fatalf("ExtraDirs=%v, want AppData npm fallback %q", got, want)
	}
}

func TestExtraDirs_AddsLookPathDir(t *testing.T) {
	bin := filepath.Join("/opt", "acme", "bin")
	binary := filepath.Join(bin, "node")
	r := &Resolver{
		GOOS:      runtime.GOOS,
		LookPath:  func(string) (string, error) { return binary, nil },
		NpmPrefix: func() (string, error) { return "", errNotFound },
	}
	if !containsDir(r.ExtraDirs(), bin) {
		t.Fatalf("ExtraDirs should include LookPath dir %q", bin)
	}
}

func TestExtraDirs_DedupesLookPathDirAlreadyOnPath(t *testing.T) {
	bin := filepath.Join("/opt", "acme", "bin")
	binary := filepath.Join(bin, "node")
	r := &Resolver{
		GOOS:      runtime.GOOS,
		EnvPath:   bin,
		LookPath:  func(string) (string, error) { return binary, nil },
		NpmPrefix: func() (string, error) { return "", errNotFound },
	}
	if containsDir(r.ExtraDirs(), bin) {
		t.Fatalf("ExtraDirs should exclude LookPath dir already on EnvPath")
	}
}

func TestAppendToPath_AppendsWithHostSeparator(t *testing.T) {
	orig := os.Getenv("PATH")
	t.Cleanup(func() { _ = os.Setenv("PATH", orig) })

	_ = os.Setenv("PATH", "/usr/bin")
	AppendToPath([]string{"/opt/a", "/opt/b"})
	sep := string(os.PathListSeparator)
	want := "/usr/bin" + sep + "/opt/a" + sep + "/opt/b"
	if got := os.Getenv("PATH"); got != want {
		t.Fatalf("PATH=%q want %q", got, want)
	}
}

func TestAppendToPath_NoopOnEmpty(t *testing.T) {
	orig := os.Getenv("PATH")
	t.Cleanup(func() { _ = os.Setenv("PATH", orig) })

	_ = os.Setenv("PATH", "/x")
	AppendToPath(nil)
	if got := os.Getenv("PATH"); got != "/x" {
		t.Fatalf("AppendToPath(nil) mutated PATH: %q", got)
	}
}
