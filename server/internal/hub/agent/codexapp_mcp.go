package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strconv"
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

// codexappMCPLaunchConfig translates the provider-neutral Hub configuration
// into Codex CLI -c overrides. Secret values are supplied through the child
// process environment and referenced with env_vars/env_http_headers, so they
// do not appear in command-line arguments or Codex's config file.
func codexappMCPLaunchConfig(servers []hubconfig.MCPServerConfig) (args, env []string) {
	ordered := cloneMCPServerConfigs(servers)
	sort.SliceStable(ordered, func(i, j int) bool {
		return strings.ToLower(ordered[i].Name) < strings.ToLower(ordered[j].Name)
	})
	for _, server := range ordered {
		if !server.Enabled {
			continue
		}
		prefix := "mcp_servers." + tomlKeySegment(server.Name)
		switch server.Transport {
		case hubconfig.MCPTransportStdio:
			args = appendCodexMCPOverride(args, prefix+".command", strconv.Quote(server.Command))
			if len(server.Args) > 0 {
				args = appendCodexMCPOverride(args, prefix+".args", tomlStringArray(server.Args))
			}
			if server.CWD != "" {
				args = appendCodexMCPOverride(args, prefix+".cwd", strconv.Quote(server.CWD))
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
			args = appendCodexMCPOverride(args, prefix+".url", strconv.Quote(server.URL))
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
	return args, env
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
		forwarded = append(forwarded, name)
		if value.Value != "" {
			env = append(env, name+"="+value.Value)
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
		envName := codexappMCPHeaderEnvName(serverName, name)
		envHeaders[name] = envName
		if value.Value != "" {
			env = append(env, envName+"="+value.Value)
		}
	}
	return inline, envHeaders, env
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
		quoted[index] = strconv.Quote(value)
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
		entries = append(entries, tomlKeySegment(name)+" = "+strconv.Quote(values[name]))
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
	return strconv.Quote(value)
}
