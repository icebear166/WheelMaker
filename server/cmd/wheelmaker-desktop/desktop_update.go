package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type desktopUpdateInfo struct {
	Version      string `json:"version"`
	SHA256       string `json:"sha256"`
	UpdaterReady bool   `json:"updaterReady"`
}

const desktopSelfUpdateCapability = "@REM WHEELMAKER_DESKTOP_SELF_UPDATE=1"

var desktopReleaseVersion string

type desktopUpdateDependencies struct {
	userHome     func() (string, error)
	executable   func() (string, error)
	hashFile     func(string) (string, error)
	readFile     func(string) ([]byte, error)
	startUpdater func(string, int) error
}

type desktopUpdateController struct {
	deps desktopUpdateDependencies
}

func newDesktopUpdateController(deps desktopUpdateDependencies) *desktopUpdateController {
	return &desktopUpdateController{deps: deps}
}

func (c *desktopUpdateController) paths() (string, string, error) {
	home, err := c.deps.userHome()
	if err != nil {
		return "", "", fmt.Errorf("resolve user home: %w", err)
	}
	root := filepath.Join(home, ".wheelmaker")
	expected := filepath.Join(root, "desktop", "WheelMakerDesktop.exe")
	current, err := c.deps.executable()
	if err != nil {
		return "", "", fmt.Errorf("resolve Desktop executable: %w", err)
	}
	if !strings.EqualFold(filepath.Clean(current), filepath.Clean(expected)) {
		return "", "", errors.New("Desktop self-update requires the standard install directory")
	}
	return expected, filepath.Join(root, "update_exe.bat"), nil
}

func (c *desktopUpdateController) updaterReady(path string) bool {
	body, err := c.deps.readFile(path)
	if err != nil {
		return false
	}
	firstLine, _, _ := strings.Cut(
		strings.ReplaceAll(string(body), "\r\n", "\n"),
		"\n",
	)
	return firstLine == desktopSelfUpdateCapability
}

func (c *desktopUpdateController) Info() (desktopUpdateInfo, error) {
	desktop, updater, err := c.paths()
	if err != nil {
		return desktopUpdateInfo{}, err
	}
	sha, err := c.deps.hashFile(desktop)
	if err != nil {
		return desktopUpdateInfo{}, fmt.Errorf("hash Desktop executable: %w", err)
	}
	return desktopUpdateInfo{
		Version:      desktopReleaseVersion,
		SHA256:       sha,
		UpdaterReady: c.updaterReady(updater),
	}, nil
}

func (c *desktopUpdateController) Start(parentPID int) error {
	if parentPID <= 0 {
		return errors.New("Desktop parent PID must be positive")
	}
	_, updater, err := c.paths()
	if err != nil {
		return err
	}
	if !c.updaterReady(updater) {
		return errors.New("Desktop updater is unavailable")
	}
	return c.deps.startUpdater(updater, parentPID)
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
