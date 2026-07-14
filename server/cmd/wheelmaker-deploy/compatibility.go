package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/swm8023/wheelmaker/internal/security"
	"github.com/swm8023/wheelmaker/internal/shared"
)

const (
	legacyWindowsMonitorService           = "WheelMakerMonitor"
	legacyLinuxMonitorUnit                = "wheelmaker-monitor.service"
	legacyDarwinMonitorLabel              = "com.wheelmaker.monitor"
	legacyMonitorCleanupRequiresElevation = "legacy monitor cleanup requires elevation"
)

var errLegacyMonitorCleanupRequiresElevation = errors.New(legacyMonitorCleanupRequiresElevation)

func migrateLegacyMonitorConfig(path string) (bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, fmt.Errorf("read config for legacy monitor migration: %w", err)
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil {
		return false, fmt.Errorf("parse config for legacy monitor migration: %w", err)
	}
	if _, ok := root["monitor"]; !ok {
		return false, nil
	}
	delete(root, "monitor")
	encoded, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return false, fmt.Errorf("encode config after legacy monitor migration: %w", err)
	}
	if err := shared.WriteConfigFile(path, append(encoded, '\n')); err != nil {
		return false, err
	}
	return true, nil
}

func cleanupLegacyMonitor(ctx context.Context, cfg deployConfig, runner commandRunner, platform string) error {
	cfg = resolveDefaults(cfg)
	var err error
	switch platform {
	case "windows":
		script := fmt.Sprintf(`$ErrorActionPreference = 'Stop'
$service = Get-Service -Name '%s' -ErrorAction SilentlyContinue
if ($null -ne $service) {
  $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Output '%s'
    exit 0
  }
  if ($service.Status -ne 'Stopped') { Stop-Service -Name '%s' -Force -ErrorAction Stop }
  sc.exe delete '%s' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'failed to delete legacy monitor service' }
}
exit 0`, legacyWindowsMonitorService, legacyMonitorCleanupRequiresElevation, legacyWindowsMonitorService, legacyWindowsMonitorService)
		var output string
		output, err = runner.Run(ctx, "", "powershell", "-NoProfile", "-NonInteractive", "-Command", script)
		if err == nil && strings.Contains(output, legacyMonitorCleanupRequiresElevation) {
			return errLegacyMonitorCleanupRequiresElevation
		}
	case "linux":
		_, err = runner.Run(ctx, "", "systemctl", "--user", "disable", "--now", legacyLinuxMonitorUnit)
		unitPath := filepath.Join(cfg.HomeDir, ".config", "systemd", "user", legacyLinuxMonitorUnit)
		if removeErr := removeIfPresent(unitPath); removeErr != nil {
			return removeErr
		}
		if err == nil || isMissingLegacyMonitorError(err) {
			_, err = runner.Run(ctx, "", "systemctl", "--user", "daemon-reload")
		}
	case "darwin":
		domain, domainErr := legacyLaunchDomain()
		if domainErr != nil {
			return domainErr
		}
		_, err = runner.Run(ctx, "", "launchctl", "bootout", domain+"/"+legacyDarwinMonitorLabel)
		plistPath := filepath.Join(cfg.HomeDir, "Library", "LaunchAgents", legacyDarwinMonitorLabel+".plist")
		if removeErr := removeIfPresent(plistPath); removeErr != nil {
			return removeErr
		}
	default:
		return fmt.Errorf("unsupported legacy monitor cleanup platform %q", platform)
	}
	if err != nil && !isMissingLegacyMonitorError(err) {
		return fmt.Errorf("remove legacy monitor registration: %w", err)
	}
	target := filepath.Join(cfg.InstallDir, legacyMonitorBinaryName(platform))
	return removeLegacyMonitorBinary(cfg.InstallDir, target)
}

func legacyMonitorBinaryName(platform string) string {
	if platform == "windows" {
		return "wheelmaker-monitor.exe"
	}
	return "wheelmaker-monitor"
}

func removeLegacyMonitorBinary(installDir string, target string) error {
	root, err := filepath.Abs(installDir)
	if err != nil {
		return fmt.Errorf("resolve install directory: %w", err)
	}
	resolved, err := filepath.Abs(target)
	if err != nil {
		return fmt.Errorf("resolve legacy monitor binary: %w", err)
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == "." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("legacy monitor binary is outside install directory: %s", resolved)
	}
	if filepath.Dir(resolved) != filepath.Clean(root) || filepath.Base(resolved) != filepath.Base(target) {
		return fmt.Errorf("legacy monitor binary path is not a direct install child: %s", resolved)
	}
	return removeIfPresent(resolved)
}

func removeIfPresent(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove %s: %w", path, err)
	}
	return nil
}

func legacyLaunchDomain() (string, error) {
	current, err := user.Current()
	if err != nil {
		return "", fmt.Errorf("resolve current user for legacy launch agent: %w", err)
	}
	if current.Uid == "" {
		return "", errors.New("current user has no uid")
	}
	return "gui/" + current.Uid, nil
}

func isMissingLegacyMonitorError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	for _, marker := range []string{"not found", "not-found", "does not exist", "no such", "not loaded", "1060"} {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

func retireLegacyMonitor(ctx context.Context, cfg deployConfig, deps deployDeps) error {
	path := filepath.Join(wheelMakerHome(cfg), "config.json")
	if _, err := migrateLegacyMonitorConfig(path); err != nil {
		return err
	}
	return cleanupLegacyMonitor(ctx, cfg, deps.Runner, runtime.GOOS)
}

func migrateRegistryToken(path string) (bool, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return false, fmt.Errorf("read config for token migration: %w", err)
	}
	var config map[string]any
	if err := json.Unmarshal(raw, &config); err != nil {
		// Preserve invalid user-authored config for diagnostics. Runtime loading
		// remains fail-closed, while deployment may still publish artifacts.
		return false, nil
	}
	registryValue, ok := config["registry"]
	if !ok {
		registryValue = map[string]any{}
		config["registry"] = registryValue
	}
	registryConfig, ok := registryValue.(map[string]any)
	if !ok {
		return false, errors.New("parse config for token migration: registry must be an object")
	}
	token, ok := registryConfig["token"].(string)
	if !ok && registryConfig["token"] != nil {
		return false, errors.New("parse config for token migration: registry.token must be a string")
	}
	if security.ValidateRegistryToken(token) == nil {
		return false, nil
	}
	token, err = security.NewRegistryToken(rand.Reader)
	if err != nil {
		return false, err
	}
	registryConfig["token"] = token
	encoded, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return false, fmt.Errorf("encode migrated config: %w", err)
	}
	if err := shared.WriteConfigFile(path, append(encoded, '\n')); err != nil {
		return false, fmt.Errorf("write migrated config: %w", err)
	}
	return true, nil
}
