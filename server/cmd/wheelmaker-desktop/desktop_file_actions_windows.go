//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type desktopFileActionEnvironment struct {
	stat     func(string) (os.FileInfo, error)
	lookPath func(string) (string, error)
	getenv   func(string) string
	launch   func(string, ...string) error
}

func newDefaultDesktopFileActionEnvironment() desktopFileActionEnvironment {
	return desktopFileActionEnvironment{
		stat:     os.Stat,
		lookPath: exec.LookPath,
		getenv:   os.Getenv,
		launch:   launchDesktopProcess,
	}
}

func launchDesktopProcess(name string, args ...string) error {
	command := exec.Command(name, args...)
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}

func resolveDesktopProjectFilePath(projectRoot, relativePath string) (cleanRoot, target string, err error) {
	if !filepath.IsAbs(projectRoot) {
		return "", "", fmt.Errorf("project root must be absolute")
	}
	cleanRoot = filepath.Clean(projectRoot)
	rootInfo, err := os.Stat(cleanRoot)
	if err != nil {
		return "", "", fmt.Errorf("validate project root: %w", err)
	}
	if !rootInfo.IsDir() {
		return "", "", fmt.Errorf("project root is not a directory")
	}

	localPath := filepath.FromSlash(relativePath)
	if localPath == "" || filepath.IsAbs(localPath) || filepath.VolumeName(localPath) != "" || strings.HasPrefix(localPath, string(filepath.Separator)) {
		return "", "", fmt.Errorf("artifact path must be project-relative")
	}
	for _, component := range strings.Split(localPath, string(filepath.Separator)) {
		if component == ".." {
			return "", "", fmt.Errorf("artifact path must not traverse parent directories")
		}
	}
	localPath = filepath.Clean(localPath)
	if localPath == "." || !filepath.IsLocal(localPath) {
		return "", "", fmt.Errorf("artifact path must be a local project-relative path")
	}

	target = filepath.Join(cleanRoot, localPath)
	relativeTarget, err := filepath.Rel(cleanRoot, target)
	if err != nil || relativeTarget == "." || !filepath.IsLocal(relativeTarget) {
		return "", "", fmt.Errorf("artifact path resolves outside the project root")
	}
	return cleanRoot, target, nil
}

func openProjectFileInVSCode(projectRoot, relativePath string) error {
	return newDefaultDesktopFileActionEnvironment().openProjectFileInVSCode(projectRoot, relativePath)
}

func resolveDesktopAbsoluteFilePath(absolutePath string) (string, error) {
	return resolveDesktopAbsoluteFilePathWithStat(absolutePath, os.Stat)
}

func resolveDesktopAbsoluteFilePathWithStat(
	absolutePath string,
	stat func(string) (os.FileInfo, error),
) (string, error) {
	if !filepath.IsAbs(absolutePath) {
		return "", fmt.Errorf("file path must be absolute")
	}
	target := filepath.Clean(absolutePath)
	info, err := stat(target)
	if err != nil {
		if os.IsNotExist(err) {
			return "", errors.New("file is unavailable")
		}
		return "", fmt.Errorf("validate file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("file is not a regular file")
	}
	return target, nil
}

func openFileInVSCode(absolutePath string) error {
	return newDefaultDesktopFileActionEnvironment().openFileInVSCode(absolutePath)
}

func (environment desktopFileActionEnvironment) openFileInVSCode(absolutePath string) error {
	target, err := resolveDesktopAbsoluteFilePathWithStat(absolutePath, environment.stat)
	if err != nil {
		return err
	}
	return environment.openResolvedFileInVSCode(target, "open file in Visual Studio Code")
}

func (environment desktopFileActionEnvironment) openProjectFileInVSCode(projectRoot, relativePath string) error {
	_, target, err := resolveDesktopProjectFilePath(projectRoot, relativePath)
	if err != nil {
		return err
	}
	targetInfo, err := environment.stat(target)
	if err != nil {
		if os.IsNotExist(err) {
			return errors.New("project file is unavailable")
		}
		return fmt.Errorf("validate project file: %w", err)
	}
	if !targetInfo.Mode().IsRegular() {
		return fmt.Errorf("project file is not a regular file")
	}

	return environment.openResolvedFileInVSCode(target, "open project file in Visual Studio Code")
}

func (environment desktopFileActionEnvironment) openResolvedFileInVSCode(target, action string) error {
	executable, err := environment.findVSCodeExecutable()
	if err != nil {
		return err
	}
	if err := environment.launch(executable, target); err != nil {
		return fmt.Errorf("%s: %w", action, err)
	}
	return nil
}

func (environment desktopFileActionEnvironment) findVSCodeExecutable() (string, error) {
	if candidate, err := environment.lookPath("Code.exe"); err == nil && environment.isRegularFile(candidate) {
		return candidate, nil
	}

	locations := []struct {
		environmentVariable string
		pathParts           []string
	}{
		{environmentVariable: "LOCALAPPDATA", pathParts: []string{"Programs", "Microsoft VS Code", "Code.exe"}},
		{environmentVariable: "ProgramFiles", pathParts: []string{"Microsoft VS Code", "Code.exe"}},
		{environmentVariable: "ProgramFiles(x86)", pathParts: []string{"Microsoft VS Code", "Code.exe"}},
	}
	for _, location := range locations {
		basePath := environment.getenv(location.environmentVariable)
		if basePath == "" {
			continue
		}
		parts := append([]string{basePath}, location.pathParts...)
		candidate := filepath.Join(parts...)
		if environment.isRegularFile(candidate) {
			return candidate, nil
		}
	}
	return "", errors.New("Visual Studio Code was not found")
}

func (environment desktopFileActionEnvironment) isRegularFile(path string) bool {
	if path == "" {
		return false
	}
	info, err := environment.stat(path)
	return err == nil && info.Mode().IsRegular()
}

func showProjectFileInFolder(projectRoot, relativePath string) error {
	return newDefaultDesktopFileActionEnvironment().showProjectFileInFolder(projectRoot, relativePath)
}

func showFileInFolder(absolutePath string) error {
	return newDefaultDesktopFileActionEnvironment().showFileInFolder(absolutePath)
}

func (environment desktopFileActionEnvironment) showFileInFolder(absolutePath string) error {
	target, err := resolveDesktopAbsoluteFilePathWithStat(absolutePath, environment.stat)
	if err != nil {
		return err
	}
	return environment.showResolvedFileInFolder(target, "show file in File Explorer")
}

func (environment desktopFileActionEnvironment) showProjectFileInFolder(projectRoot, relativePath string) error {
	cleanRoot, target, err := resolveDesktopProjectFilePath(projectRoot, relativePath)
	if err != nil {
		return err
	}
	targetInfo, err := environment.stat(target)
	if err == nil {
		if !targetInfo.Mode().IsRegular() {
			return fmt.Errorf("project file is not a regular file")
		}
		return environment.showResolvedFileInFolder(target, "show project file in File Explorer")
	}
	if !os.IsNotExist(err) {
		return fmt.Errorf("validate project file: %w", err)
	}

	directory, err := environment.nearestExistingProjectDirectory(cleanRoot, filepath.Dir(target))
	if err != nil {
		return err
	}
	if err := environment.launch("explorer.exe", directory); err != nil {
		return fmt.Errorf("show project folder in File Explorer: %w", err)
	}
	return nil
}

func (environment desktopFileActionEnvironment) showResolvedFileInFolder(target, action string) error {
	if err := environment.launch("explorer.exe", "/select,"+target); err != nil {
		return fmt.Errorf("%s: %w", action, err)
	}
	return nil
}

func (environment desktopFileActionEnvironment) nearestExistingProjectDirectory(cleanRoot, start string) (string, error) {
	for candidate := start; ; candidate = filepath.Dir(candidate) {
		relativeCandidate, err := filepath.Rel(cleanRoot, candidate)
		if err != nil || (relativeCandidate != "." && !filepath.IsLocal(relativeCandidate)) {
			return "", fmt.Errorf("project file parent resolves outside the project root")
		}

		info, statErr := environment.stat(candidate)
		if statErr == nil && info.IsDir() {
			return candidate, nil
		}
		if statErr != nil && !os.IsNotExist(statErr) {
			return "", fmt.Errorf("validate project file parent: %w", statErr)
		}
		if candidate == cleanRoot {
			break
		}
	}
	return "", fmt.Errorf("no existing project directory was found")
}
