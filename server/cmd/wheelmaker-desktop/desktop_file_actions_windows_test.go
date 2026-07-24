//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

type desktopLaunchCall struct {
	name string
	args []string
}

func newDesktopFileActionTestEnvironment(launches *[]desktopLaunchCall) desktopFileActionEnvironment {
	return desktopFileActionEnvironment{
		stat: os.Stat,
		lookPath: func(string) (string, error) {
			return "", exec.ErrNotFound
		},
		getenv: func(string) string {
			return ""
		},
		launch: func(name string, args ...string) error {
			*launches = append(*launches, desktopLaunchCall{name: name, args: append([]string(nil), args...)})
			return nil
		},
	}
}

func writeDesktopTestFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("test"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopAbsoluteFileActions(t *testing.T) {
	base := t.TempDir()
	file := filepath.Join(base, "outside file.go")
	code := filepath.Join(base, "Code.exe")
	writeDesktopTestFile(t, file)
	writeDesktopTestFile(t, code)
	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.lookPath = func(string) (string, error) {
		return code, nil
	}

	if err := environment.openFileInVSCode(file); err != nil {
		t.Fatal(err)
	}
	if err := environment.showFileInFolder(file); err != nil {
		t.Fatal(err)
	}
	if len(launches) != 2 ||
		launches[0].name != code ||
		launches[0].args[0] != file ||
		launches[1].name != "explorer.exe" ||
		launches[1].args[0] != "/select,"+file {
		t.Fatalf("launches=%v", launches)
	}
}

func TestDesktopAbsoluteFileActionsRejectInvalidTargets(t *testing.T) {
	base := t.TempDir()
	directory := filepath.Join(base, "folder")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(base, "missing.go")

	for _, target := range []string{"relative.go", missing, directory} {
		t.Run(target, func(t *testing.T) {
			var launches []desktopLaunchCall
			environment := newDesktopFileActionTestEnvironment(&launches)
			if err := environment.openFileInVSCode(target); err == nil {
				t.Fatal("openFileInVSCode() error = nil")
			}
			if err := environment.showFileInFolder(target); err == nil {
				t.Fatal("showFileInFolder() error = nil")
			}
			if len(launches) != 0 {
				t.Fatalf("launches=%v, want none", launches)
			}
		})
	}
}

func TestDesktopProjectFilePathRejectsInvalidRoots(t *testing.T) {
	tempDir := t.TempDir()
	fileRoot := filepath.Join(tempDir, "root.txt")
	if err := os.WriteFile(fileRoot, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		root string
	}{
		{name: "relative", root: "."},
		{name: "missing", root: filepath.Join(tempDir, "missing")},
		{name: "file", root: fileRoot},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, _, err := resolveDesktopProjectFilePath(tt.root, "src/main.go"); err == nil {
				t.Fatal("resolveDesktopProjectFilePath() error = nil, want validation error")
			}
		})
	}
}

func TestDesktopProjectFilePathRejectsInvalidArtifactPaths(t *testing.T) {
	root := t.TempDir()
	tests := []struct {
		name string
		path string
	}{
		{name: "empty", path: ""},
		{name: "dot", path: "."},
		{name: "dot with separator", path: "./"},
		{name: "absolute", path: filepath.Join(root, "outside.txt")},
		{name: "drive qualified", path: `C:Windows\system.ini`},
		{name: "drive absolute", path: `C:\Windows\system.ini`},
		{name: "current drive rooted backslash", path: `\Windows\system.ini`},
		{name: "current drive rooted slash", path: "/Windows/system.ini"},
		{name: "UNC", path: `\\server\share\file.txt`},
		{name: "parent", path: ".."},
		{name: "parent traversal", path: `..\outside.txt`},
		{name: "nested parent traversal", path: `src\..\..\outside.txt`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, _, err := resolveDesktopProjectFilePath(root, tt.path); err == nil {
				t.Fatal("resolveDesktopProjectFilePath() error = nil, want validation error")
			}
		})
	}
}

func TestDesktopProjectFilePathResolvesForwardSlashRelativePath(t *testing.T) {
	root := t.TempDir()

	cleanRoot, target, err := resolveDesktopProjectFilePath(root, "src/main.go")
	if err != nil {
		t.Fatalf("resolveDesktopProjectFilePath() error = %v", err)
	}
	if cleanRoot != filepath.Clean(root) {
		t.Fatalf("cleanRoot = %q, want %q", cleanRoot, filepath.Clean(root))
	}
	wantTarget := filepath.Join(root, "src", "main.go")
	if target != wantTarget {
		t.Fatalf("target = %q, want %q", target, wantTarget)
	}
}

func TestDesktopVSCodeUsesPathBeforeInstallFallbacks(t *testing.T) {
	projectRoot := t.TempDir()
	target := filepath.Join(projectRoot, "src", "main.go")
	writeDesktopTestFile(t, target)
	pathCode := filepath.Join(t.TempDir(), "bin", "Code.exe")
	writeDesktopTestFile(t, pathCode)
	localAppData := t.TempDir()
	fallbackCode := filepath.Join(localAppData, "Programs", "Microsoft VS Code", "Code.exe")
	writeDesktopTestFile(t, fallbackCode)

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.lookPath = func(name string) (string, error) {
		if name != "Code.exe" {
			t.Fatalf("lookPath(%q), want Code.exe", name)
		}
		return pathCode, nil
	}
	environment.getenv = func(name string) string {
		if name == "LOCALAPPDATA" {
			return localAppData
		}
		return ""
	}

	if err := environment.openProjectFileInVSCode(projectRoot, "src/main.go"); err != nil {
		t.Fatalf("openProjectFileInVSCode() error = %v", err)
	}
	assertDesktopLaunch(t, launches, pathCode, target)
}

func TestDesktopVSCodeUsesInstallLocationFallbacks(t *testing.T) {
	tests := []struct {
		name      string
		envName   string
		pathParts []string
	}{
		{name: "LocalAppData", envName: "LOCALAPPDATA", pathParts: []string{"Programs", "Microsoft VS Code", "Code.exe"}},
		{name: "ProgramFiles", envName: "ProgramFiles", pathParts: []string{"Microsoft VS Code", "Code.exe"}},
		{name: "ProgramFiles x86", envName: "ProgramFiles(x86)", pathParts: []string{"Microsoft VS Code", "Code.exe"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			projectRoot := t.TempDir()
			target := filepath.Join(projectRoot, "main.go")
			writeDesktopTestFile(t, target)
			installRoot := t.TempDir()
			codePathParts := append([]string{installRoot}, tt.pathParts...)
			codePath := filepath.Join(codePathParts...)
			writeDesktopTestFile(t, codePath)

			var launches []desktopLaunchCall
			environment := newDesktopFileActionTestEnvironment(&launches)
			environment.getenv = func(name string) string {
				if name == tt.envName {
					return installRoot
				}
				return ""
			}

			if err := environment.openProjectFileInVSCode(projectRoot, "main.go"); err != nil {
				t.Fatalf("openProjectFileInVSCode() error = %v", err)
			}
			assertDesktopLaunch(t, launches, codePath, target)
		})
	}
}

func TestDesktopVSCodeUsesInstallLocationFallbacksInPriorityOrder(t *testing.T) {
	projectRoot := t.TempDir()
	target := filepath.Join(projectRoot, "main.go")
	writeDesktopTestFile(t, target)

	localAppData := t.TempDir()
	programFiles := t.TempDir()
	programFilesX86 := t.TempDir()
	localAppDataCode := filepath.Join(localAppData, "Programs", "Microsoft VS Code", "Code.exe")
	programFilesCode := filepath.Join(programFiles, "Microsoft VS Code", "Code.exe")
	programFilesX86Code := filepath.Join(programFilesX86, "Microsoft VS Code", "Code.exe")
	for _, codePath := range []string{localAppDataCode, programFilesCode, programFilesX86Code} {
		writeDesktopTestFile(t, codePath)
	}

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.getenv = func(name string) string {
		return map[string]string{
			"LOCALAPPDATA":      localAppData,
			"ProgramFiles":      programFiles,
			"ProgramFiles(x86)": programFilesX86,
		}[name]
	}

	if err := environment.openProjectFileInVSCode(projectRoot, "main.go"); err != nil {
		t.Fatalf("openProjectFileInVSCode() with all fallbacks error = %v", err)
	}
	assertDesktopLaunch(t, launches, localAppDataCode, target)

	if err := os.Remove(localAppDataCode); err != nil {
		t.Fatal(err)
	}
	launches = nil
	if err := environment.openProjectFileInVSCode(projectRoot, "main.go"); err != nil {
		t.Fatalf("openProjectFileInVSCode() without LocalAppData candidate error = %v", err)
	}
	assertDesktopLaunch(t, launches, programFilesCode, target)

	if err := os.Remove(programFilesCode); err != nil {
		t.Fatal(err)
	}
	launches = nil
	if err := environment.openProjectFileInVSCode(projectRoot, "main.go"); err != nil {
		t.Fatalf("openProjectFileInVSCode() without ProgramFiles candidate error = %v", err)
	}
	assertDesktopLaunch(t, launches, programFilesX86Code, target)
}

func TestDesktopVSCodeSkipsNonRegularPathCandidate(t *testing.T) {
	projectRoot := t.TempDir()
	target := filepath.Join(projectRoot, "main.go")
	writeDesktopTestFile(t, target)
	pathCodeDirectory := t.TempDir()
	programFiles := t.TempDir()
	fallbackCode := filepath.Join(programFiles, "Microsoft VS Code", "Code.exe")
	writeDesktopTestFile(t, fallbackCode)

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.lookPath = func(string) (string, error) {
		return pathCodeDirectory, nil
	}
	environment.getenv = func(name string) string {
		if name == "ProgramFiles" {
			return programFiles
		}
		return ""
	}

	if err := environment.openProjectFileInVSCode(projectRoot, "main.go"); err != nil {
		t.Fatalf("openProjectFileInVSCode() error = %v", err)
	}
	assertDesktopLaunch(t, launches, fallbackCode, target)
}

func TestDesktopVSCodeRejectsMissingTargetWithoutLaunch(t *testing.T) {
	projectRoot := t.TempDir()
	codePath := filepath.Join(t.TempDir(), "Code.exe")
	writeDesktopTestFile(t, codePath)

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.lookPath = func(string) (string, error) {
		return codePath, nil
	}

	if err := environment.openProjectFileInVSCode(projectRoot, "missing.go"); err == nil || err.Error() != "project file is unavailable" {
		t.Fatalf("openProjectFileInVSCode() error = %v, want stable unavailable error", err)
	}
	if len(launches) != 0 {
		t.Fatalf("launches = %v, want none", launches)
	}
}

func TestDesktopVSCodeReportsMissingInstallationWithoutLaunch(t *testing.T) {
	projectRoot := t.TempDir()
	writeDesktopTestFile(t, filepath.Join(projectRoot, "main.go"))

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)

	err := environment.openProjectFileInVSCode(projectRoot, "main.go")
	if err == nil || !strings.Contains(err.Error(), "Visual Studio Code was not found") {
		t.Fatalf("openProjectFileInVSCode() error = %v, want Visual Studio Code not found", err)
	}
	if len(launches) != 0 {
		t.Fatalf("launches = %v, want none", launches)
	}
}

func TestDesktopFileExplorerSelectsExistingFile(t *testing.T) {
	projectRoot := t.TempDir()
	target := filepath.Join(projectRoot, "src", "main.go")
	writeDesktopTestFile(t, target)

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)

	if err := environment.showProjectFileInFolder(projectRoot, "src/main.go"); err != nil {
		t.Fatalf("showProjectFileInFolder() error = %v", err)
	}
	assertDesktopLaunch(t, launches, "explorer.exe", "/select,"+target)
}

func TestDesktopFileExplorerUsesNearestExistingParentForDeletedFile(t *testing.T) {
	projectRoot := t.TempDir()
	existingParent := filepath.Join(projectRoot, "src")
	if err := os.MkdirAll(existingParent, 0o700); err != nil {
		t.Fatal(err)
	}

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)

	if err := environment.showProjectFileInFolder(projectRoot, "src/missing/deleted.go"); err != nil {
		t.Fatalf("showProjectFileInFolder() error = %v", err)
	}
	assertDesktopLaunch(t, launches, "explorer.exe", existingParent)
}

func TestDesktopFileExplorerDeletedFileNeverFallsBackOutsideProjectRoot(t *testing.T) {
	projectRoot := t.TempDir()
	outsideParent := filepath.Dir(projectRoot)

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)
	environment.stat = func(path string) (os.FileInfo, error) {
		if path == outsideParent {
			return os.Stat(outsideParent)
		}
		return nil, os.ErrNotExist
	}

	if err := environment.showProjectFileInFolder(projectRoot, "missing/deleted.go"); err == nil {
		t.Fatal("showProjectFileInFolder() error = nil, want project-boundary error")
	}
	if len(launches) != 0 {
		t.Fatalf("launches = %v, want no launch outside project root", launches)
	}
}

func TestDesktopFileExplorerRejectsExistingDirectoryWithoutLaunch(t *testing.T) {
	projectRoot := t.TempDir()
	if err := os.Mkdir(filepath.Join(projectRoot, "src"), 0o700); err != nil {
		t.Fatal(err)
	}

	var launches []desktopLaunchCall
	environment := newDesktopFileActionTestEnvironment(&launches)

	if err := environment.showProjectFileInFolder(projectRoot, "src"); err == nil {
		t.Fatal("showProjectFileInFolder() error = nil, want non-regular target error")
	}
	if len(launches) != 0 {
		t.Fatalf("launches = %v, want none", launches)
	}
}

func assertDesktopLaunch(t *testing.T, launches []desktopLaunchCall, wantName string, wantArgs ...string) {
	t.Helper()
	if len(launches) != 1 {
		t.Fatalf("launches = %v, want exactly one", launches)
	}
	if launches[0].name != wantName {
		t.Fatalf("launch name = %q, want %q", launches[0].name, wantName)
	}
	if len(launches[0].args) != len(wantArgs) {
		t.Fatalf("launch args = %q, want %q", launches[0].args, wantArgs)
	}
	for index := range wantArgs {
		if launches[0].args[index] != wantArgs[index] {
			t.Fatalf("launch arg %d = %q, want %q", index, launches[0].args[index], wantArgs[index])
		}
	}
}
