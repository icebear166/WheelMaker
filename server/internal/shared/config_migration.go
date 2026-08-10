package shared

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// MigrationBackupPath returns the private pre-migration copy used by the
// deployment fallback path while a new runtime is being validated.
func MigrationBackupPath(path string) string {
	return path + ".pre-migration"
}

// MigrateConfig upgrades an existing config.json to the canonical schema.
// The operation is non-interactive, idempotent, and preserves the original
// file if validation or writing fails.
func MigrateConfig(path string) error {
	lockPath := path + ".lock"
	release, err := acquireConfigFileLock(lockPath)
	if err != nil {
		return err
	}
	defer release()

	original, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("config file not found at %s", path)
		}
		return fmt.Errorf("read config %s: %w", path, err)
	}

	root, err := decodeConfigObject(original)
	if err != nil {
		return fmt.Errorf("parse config %s: %w", path, err)
	}
	changed, err := canonicalizeConfig(root)
	if err != nil {
		return fmt.Errorf("migrate config %s: %w", path, err)
	}
	if !changed {
		return nil
	}

	backupPath := MigrationBackupPath(path)
	if _, err := os.Stat(backupPath); os.IsNotExist(err) {
		if err := WriteConfigFile(backupPath, original); err != nil {
			return fmt.Errorf("save config migration backup: %w", err)
		}
	} else if err != nil {
		return fmt.Errorf("check config migration backup: %w", err)
	}

	data, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return fmt.Errorf("encode migrated config: %w", err)
	}
	data = append(data, '\n')
	if err := WriteConfigFile(path, data); err != nil {
		return fmt.Errorf("write migrated config: %w", err)
	}
	return nil
}

// FinalizeConfigMigration removes the pre-migration copy after the canonical
// config has been strictly loaded and runtime validation has succeeded.
func FinalizeConfigMigration(path string) error {
	release, err := acquireConfigFileLock(path + ".lock")
	if err != nil {
		return err
	}
	defer release()
	backupPath := MigrationBackupPath(path)
	if err := os.Remove(backupPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove config migration backup: %w", err)
	}
	return nil
}

func decodeConfigObject(data []byte) (map[string]json.RawMessage, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	if root == nil {
		return nil, errors.New("config root must be an object")
	}
	return root, nil
}

func canonicalizeConfig(root map[string]json.RawMessage) (bool, error) {
	changed := false

	publicURL, publicPresent, err := readOptionalString(root, "publicUrl")
	if err != nil {
		return false, err
	}
	if publicPresent && publicURL != "" {
		canonical, _, err := normalizeRegistryOrigin(publicURL, 0)
		if err != nil {
			return false, fmt.Errorf("publicUrl is invalid: %w", err)
		}
		if canonical != publicURL {
			root["publicUrl"] = json.RawMessage(mustJSON(canonical))
			publicURL = canonical
			changed = true
		}
	}

	registry, registryPresent, err := readOptionalObject(root, "registry")
	if err != nil {
		return false, err
	}
	if !registryPresent {
		registry = make(map[string]json.RawMessage)
	}

	legacyShare, legacyShareObject, err := readOptionalObject(root, "share")
	if err != nil {
		return false, err
	}
	_, canonicalShareObject, err := readOptionalObject(registry, "share")
	if err != nil {
		return false, fmt.Errorf("registry.share: %w", err)
	}
	if _, legacyShareKey := root["share"]; legacyShareKey {
		if !canonicalShareObject && legacyShareObject {
			registry["share"] = json.RawMessage(mustJSON(legacyShare))
		}
		delete(root, "share")
		changed = true
	}

	listen, _, err := readOptionalBool(registry, "listen")
	if err != nil {
		return false, err
	}
	legacyServer, serverPresent, err := readOptionalString(registry, "server")
	if err != nil {
		return false, err
	}
	if _, _, err := readOptionalInt(registry, "port"); err != nil {
		return false, err
	}

	if serverPresent {
		if !listen && legacyServer != "" {
			canonical, loopback, err := normalizeRegistryOrigin(legacyServer, 0)
			if err != nil {
				return false, fmt.Errorf("registry.server is invalid: %w", err)
			}
			if !publicPresent || publicURL == "" {
				if !loopback {
					root["publicUrl"] = json.RawMessage(mustJSON(canonical))
					publicURL = canonical
					publicPresent = true
					changed = true
				}
			}
		}
		delete(registry, "server")
		changed = true
	}

	identityChanged, err := migrateIdentity(root, registry)
	if err != nil {
		return false, err
	}
	changed = identityChanged || changed
	if registryPresent {
		if len(registry) == 0 {
			// Keep an explicitly configured empty registry object out of the
			// canonical file; runtime defaults are equivalent and deterministic.
			delete(root, "registry")
			changed = true
		} else {
			encoded := mustJSON(registry)
			if string(root["registry"]) != string(encoded) {
				root["registry"] = json.RawMessage(encoded)
				changed = true
			}
		}
	} else if len(registry) != 0 {
		root["registry"] = json.RawMessage(mustJSON(registry))
		changed = true
	}

	return changed, nil
}

func migrateIdentity(root, registry map[string]json.RawMessage) (bool, error) {
	changed := false
	for _, field := range []string{"token", "hubId"} {
		top, _, err := readOptionalString(root, field)
		if err != nil {
			return false, err
		}
		nested, nestedPresent, err := readOptionalString(registry, field)
		if err != nil {
			return false, fmt.Errorf("registry.%s: %w", field, err)
		}
		chosen := top
		if chosen == "" && nestedPresent && nested != "" {
			chosen = nested
			root[field] = json.RawMessage(mustJSON(chosen))
			changed = true
		}
		if nestedPresent {
			delete(registry, field)
			changed = true
		}
	}
	return changed, nil
}

func readOptionalString(object map[string]json.RawMessage, field string) (string, bool, error) {
	raw, ok := object[field]
	if !ok {
		return "", false, nil
	}
	if string(raw) == "null" {
		return "", true, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false, fmt.Errorf("%s must be a string", field)
	}
	return value, true, nil
}

func readOptionalBool(object map[string]json.RawMessage, field string) (bool, bool, error) {
	raw, ok := object[field]
	if !ok {
		return false, false, nil
	}
	if string(raw) == "null" {
		return false, true, nil
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, false, fmt.Errorf("%s must be a boolean", field)
	}
	return value, true, nil
}

func readOptionalInt(object map[string]json.RawMessage, field string) (int, bool, error) {
	raw, ok := object[field]
	if !ok {
		return 0, false, nil
	}
	if string(raw) == "null" {
		return 0, true, nil
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, false, fmt.Errorf("%s must be an integer", field)
	}
	return value, true, nil
}

func readOptionalObject(object map[string]json.RawMessage, field string) (map[string]json.RawMessage, bool, error) {
	raw, ok := object[field]
	if !ok || string(raw) == "null" {
		return nil, false, nil
	}
	var value map[string]json.RawMessage
	if err := json.Unmarshal(raw, &value); err != nil || value == nil {
		return nil, false, fmt.Errorf("%s must be an object", field)
	}
	return value, true, nil
}

func normalizeRegistryOrigin(value string, fallbackPort int) (string, bool, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", false, errors.New("origin is empty")
	}
	hasScheme := strings.Contains(value, "://")
	parseValue := value
	if !hasScheme {
		if _, err := netip.ParseAddr(strings.Trim(value, "[]")); err == nil && strings.Contains(value, ":") {
			parseValue = "https://[" + strings.Trim(value, "[]") + "]"
		} else {
			parseValue = "https://" + value
		}
	}
	u, err := url.Parse(parseValue)
	if err != nil || u.Scheme == "" || u.Host == "" || u.User != nil || u.Opaque != "" {
		return "", false, errors.New("origin must contain a valid host")
	}
	if strings.HasSuffix(u.Host, ":") {
		return "", false, errors.New("origin port is invalid")
	}
	switch strings.ToLower(u.Scheme) {
	case "ws", "wss", "http", "https":
	default:
		return "", false, errors.New("origin scheme is unsupported")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return "", false, errors.New("origin cannot contain query or fragment")
	}
	if u.Path != "" && u.Path != "/" && u.Path != "/ws" {
		return "", false, errors.New("origin path must be /ws or /")
	}
	hostname := u.Hostname()
	if hostname == "" {
		return "", false, errors.New("origin host is empty")
	}
	portText := u.Port()
	if portText == "" && fallbackPort > 0 {
		portText = strconv.Itoa(fallbackPort)
	}
	if portText != "" {
		port, err := strconv.Atoi(portText)
		if err != nil || port < 1 || port > 65535 {
			return "", false, errors.New("origin port is invalid")
		}
	}
	loopback := isLoopbackHost(hostname)
	scheme := "https"
	if loopback {
		scheme = "http"
	}
	host := strings.ToLower(hostname)
	if strings.Contains(host, ":") {
		if portText != "" {
			host = net.JoinHostPort(host, portText)
		} else {
			host = "[" + host + "]"
		}
	} else if portText != "" {
		host = net.JoinHostPort(host, portText)
	}
	return (&url.URL{Scheme: scheme, Host: host}).String(), loopback, nil
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	addr, err := netip.ParseAddr(host)
	return err == nil && addr.IsLoopback()
}

func mustJSON(value any) []byte {
	data, _ := json.Marshal(value)
	return data
}
