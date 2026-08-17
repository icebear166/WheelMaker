package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/swm8023/wheelmaker/internal/hubconfig"
)

func cloneMCPServerConfigs(servers []hubconfig.MCPServerConfig) []hubconfig.MCPServerConfig {
	if len(servers) == 0 {
		return nil
	}
	cloned := make([]hubconfig.MCPServerConfig, len(servers))
	for index, server := range servers {
		cloned[index] = server
		cloned[index].Args = append([]string(nil), server.Args...)
		if len(server.Env) > 0 {
			cloned[index].Env = make(map[string]hubconfig.MCPValue, len(server.Env))
			for name, value := range server.Env {
				cloned[index].Env[name] = value
			}
		}
		if len(server.Headers) > 0 {
			cloned[index].Headers = make(map[string]hubconfig.MCPValue, len(server.Headers))
			for name, value := range server.Headers {
				cloned[index].Headers[name] = value
			}
		}
	}
	return cloned
}

func enabledMCPServerNames(servers []hubconfig.MCPServerConfig) []string {
	names := make([]string, 0, len(servers))
	for _, server := range servers {
		if server.Enabled && strings.TrimSpace(server.Name) != "" {
			names = append(names, strings.TrimSpace(server.Name))
		}
	}
	sort.SliceStable(names, func(i, j int) bool {
		return strings.ToLower(names[i]) < strings.ToLower(names[j])
	})
	return names
}

// codexappMCPThreadDisableConfig is used only by the empty-MCP retry. Codex
// materializes Hub MCP at app-server launch, so an empty ACP list alone cannot
// undo that process-level overlay. The app-server's per-thread config layer
// can disable those same entries without touching the user's config.toml.
func codexappMCPThreadDisableConfig(names []string, disable bool) map[string]any {
	if !disable || len(names) == 0 {
		return nil
	}
	config := make(map[string]any, len(names))
	seen := make(map[string]struct{}, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		key := strings.ToLower(name)
		if name == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		config["mcp_servers."+tomlKeySegment(name)+".enabled"] = false
	}
	if len(config) == 0 {
		return nil
	}
	return config
}

// codexappMCPLaunchConfig translates the provider-neutral Hub configuration
// into Codex CLI -c overrides. Secret values are supplied through the child
// process environment and referenced with env_vars/env_http_headers, so they
// do not appear in command-line arguments or Codex's config file.
func codexappMCPLaunchConfig(servers []hubconfig.MCPServerConfig, reservedEnv []string) (args, env []string, err error) {
	ordered := cloneMCPServerConfigs(servers)
	sort.SliceStable(ordered, func(i, j int) bool {
		return strings.ToLower(ordered[i].Name) < strings.ToLower(ordered[j].Name)
	})
	if err := validateCodexAppMCPSecretEnvNames(ordered, reservedEnv); err != nil {
		return nil, nil, err
	}
	for _, server := range ordered {
		if !server.Enabled {
			continue
		}
		prefix := "mcp_servers." + tomlKeySegment(server.Name)
		switch server.Transport {
		case hubconfig.MCPTransportStdio:
			args = appendCodexMCPOverride(args, prefix+".command", tomlQuote(server.Command))
			if len(server.Args) > 0 {
				args = appendCodexMCPOverride(args, prefix+".args", tomlStringArray(server.Args))
			}
			if server.CWD != "" {
				args = appendCodexMCPOverride(args, prefix+".cwd", tomlQuote(server.CWD))
			}
			inline, forwarded, forwardedEnv := codexappMCPEnvConfig(server.Env)
			if len(inline) > 0 {
				args = appendCodexMCPOverride(args, prefix+".env", tomlStringTable(inline))
			}
			if len(forwarded) > 0 {
				args = appendCodexMCPOverride(args, prefix+".env_vars", tomlStringArray(forwarded))
				env = append(env, forwardedEnv...)
			}
		case hubconfig.MCPTransportHTTP:
			args = appendCodexMCPOverride(args, prefix+".url", tomlQuote(server.URL))
			inline, envHeaders, envValues := codexappMCPHeaderConfig(server.Name, server.Headers)
			if len(inline) > 0 {
				args = appendCodexMCPOverride(args, prefix+".http_headers", tomlStringTable(inline))
			}
			if len(envHeaders) > 0 {
				args = appendCodexMCPOverride(args, prefix+".env_http_headers", tomlStringTable(envHeaders))
				env = append(env, envValues...)
			}
		}
	}
	return args, env, nil
}

func appendCodexMCPOverride(args []string, key, value string) []string {
	return append(args, "-c", key+"="+value)
}

func codexappMCPEnvConfig(values map[string]hubconfig.MCPValue) (map[string]string, []string, []string) {
	inline := make(map[string]string)
	forwarded := make([]string, 0)
	env := make([]string, 0)
	for _, name := range sortedMCPValueNames(values) {
		value := values[name]
		if !value.Secret {
			inline[name] = value.Value
			continue
		}
		envName := name
		if value.EnvVar != "" {
			envName = value.EnvVar
		}
		forwarded = append(forwarded, envName)
		if value.Value != "" {
			env = append(env, envName+"="+value.Value)
		}
	}
	return inline, forwarded, env
}

func codexappMCPHeaderConfig(serverName string, values map[string]hubconfig.MCPValue) (map[string]string, map[string]string, []string) {
	inline := make(map[string]string)
	envHeaders := make(map[string]string)
	env := make([]string, 0)
	for _, name := range sortedMCPValueNames(values) {
		value := values[name]
		if !value.Secret {
			inline[name] = value.Value
			continue
		}
		if value.EnvVar != "" {
			envHeaders[name] = value.EnvVar
			if value.Value != "" {
				env = append(env, value.EnvVar+"="+value.Value)
			}
			continue
		}
		envName := codexappMCPHeaderEnvName(serverName, name)
		envHeaders[name] = envName
		if value.Value != "" {
			env = append(env, envName+"="+value.Value)
		}
	}
	return inline, envHeaders, env
}

type codexappMCPSecretBinding struct {
	value     string
	reference string
	source    string
}

func validateCodexAppMCPSecretEnvNames(servers []hubconfig.MCPServerConfig, reservedEnv []string) error {
	reserved := make(map[string]struct{}, len(reservedEnv))
	for _, name := range []string{
		"APPDATA", "CODEX_HOME", "COMSPEC", "DEEPSEEK_API_KEY", "HOME", "LD_LIBRARY_PATH",
		"LOCALAPPDATA", "PATH", "PATHEXT", "PROGRAMDATA", "SYSTEMROOT", "TEMP", "TMP",
		"TMPDIR", "USERPROFILE", "WINDIR", "DYLD_LIBRARY_PATH",
	} {
		reserved[strings.ToLower(name)] = struct{}{}
	}
	for _, assignment := range reservedEnv {
		name, _, ok := strings.Cut(assignment, "=")
		if ok {
			reserved[strings.ToLower(strings.TrimSpace(name))] = struct{}{}
		}
	}
	bindings := make(map[string]codexappMCPSecretBinding)
	for _, server := range servers {
		if !server.Enabled {
			continue
		}
		for _, name := range sortedMCPValueNames(server.Env) {
			value := server.Env[name]
			if !value.Secret {
				continue
			}
			envName := name
			if value.EnvVar != "" {
				envName = value.EnvVar
			}
			if err := recordCodexAppMCPSecretBinding(bindings, reserved, envName, value, server.Name+" env "+name); err != nil {
				return err
			}
		}
		for _, name := range sortedMCPValueNames(server.Headers) {
			value := server.Headers[name]
			if !value.Secret {
				continue
			}
			envName := value.EnvVar
			if envName == "" {
				envName = codexappMCPHeaderEnvName(server.Name, name)
			}
			if err := recordCodexAppMCPSecretBinding(bindings, reserved, envName, value, server.Name+" header "+name); err != nil {
				return err
			}
		}
	}
	return nil
}

func recordCodexAppMCPSecretBinding(bindings map[string]codexappMCPSecretBinding, reserved map[string]struct{}, envName string, value hubconfig.MCPValue, source string) error {
	envName = strings.TrimSpace(envName)
	key := strings.ToLower(envName)
	if value.Value != "" {
		generatedHeader := strings.Contains(source, " header ") && value.EnvVar == ""
		if _, ok := reserved[key]; ok || strings.HasPrefix(key, "wheelmaker_mcp_header_") && !generatedHeader {
			return fmt.Errorf("MCP secret environment name %q from %s conflicts with provider environment", envName, source)
		}
	}
	current, ok := bindings[key]
	if !ok {
		bindings[key] = codexappMCPSecretBinding{value: value.Value, reference: value.EnvVar, source: source}
		return nil
	}
	if current.value != value.Value || current.reference != value.EnvVar {
		return fmt.Errorf("MCP secret environment name %q is configured with conflicting values by %s and %s", envName, current.source, source)
	}
	return nil
}

func sortedMCPValueNames(values map[string]hubconfig.MCPValue) []string {
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		return strings.ToLower(names[i]) < strings.ToLower(names[j])
	})
	return names
}

func codexappMCPHeaderEnvName(serverName, headerName string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(serverName)) + "\x00" + strings.ToLower(strings.TrimSpace(headerName))))
	return "WHEELMAKER_MCP_HEADER_" + strings.ToUpper(hex.EncodeToString(digest[:6]))
}

func tomlStringArray(values []string) string {
	quoted := make([]string, len(values))
	for index, value := range values {
		quoted[index] = tomlQuote(value)
	}
	return "[" + strings.Join(quoted, ",") + "]"
}

func tomlStringTable(values map[string]string) string {
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool {
		return strings.ToLower(names[i]) < strings.ToLower(names[j])
	})
	entries := make([]string, 0, len(names))
	for _, name := range names {
		entries = append(entries, tomlKeySegment(name)+" = "+tomlQuote(values[name]))
	}
	return "{ " + strings.Join(entries, ", ") + " }"
}

func tomlKeySegment(value string) string {
	value = strings.TrimSpace(value)
	if value != "" {
		valid := true
		for _, char := range value {
			if !(char == '_' || char == '-' || char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9') {
				valid = false
				break
			}
		}
		if valid {
			return value
		}
	}
	return tomlQuote(value)
}

func tomlQuote(value string) string {
	var quoted strings.Builder
	quoted.WriteByte('"')
	for _, char := range value {
		switch char {
		case '\\':
			quoted.WriteString(`\\`)
		case '"':
			quoted.WriteString(`\"`)
		case '\b':
			quoted.WriteString(`\b`)
		case '\t':
			quoted.WriteString(`\t`)
		case '\n':
			quoted.WriteString(`\n`)
		case '\f':
			quoted.WriteString(`\f`)
		case '\r':
			quoted.WriteString(`\r`)
		default:
			if char < 0x20 || char == 0x7f {
				_, _ = fmt.Fprintf(&quoted, `\u%04X`, char)
				continue
			}
			quoted.WriteRune(char)
		}
	}
	quoted.WriteByte('"')
	return quoted.String()
}
