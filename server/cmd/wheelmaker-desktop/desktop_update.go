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
	SHA256       string `json:"sha256"`
	UpdaterReady bool   `json:"updaterReady"`
}

type desktopUpdateDependencies struct {
	userHome     func() (string, error)
	executable   func() (string, error)
	hashFile     func(string) (string, error)
	stat         func(string) (os.FileInfo, error)
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
	expected := filepath.Join(home, ".wheelmaker", "desktop", "WheelMakerDesktop.exe")
	current, err := c.deps.executable()
	if err != nil {
		return "", "", fmt.Errorf("resolve Desktop executable: %w", err)
	}
	if !strings.EqualFold(filepath.Clean(current), filepath.Clean(expected)) {
		return "", "", errors.New("Desktop self-update requires the standard install directory")
	}
	return expected, filepath.Join(filepath.Dir(expected), "update.exe"), nil
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
	_, statErr := c.deps.stat(updater)
	return desktopUpdateInfo{SHA256: sha, UpdaterReady: statErr == nil}, nil
}

func (c *desktopUpdateController) Start(parentPID int) error {
	_, updater, err := c.paths()
	if err != nil {
		return err
	}
	if _, err := c.deps.stat(updater); err != nil {
		return fmt.Errorf("Desktop updater is unavailable: %w", err)
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
