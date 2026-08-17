package hub

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/swm8023/wheelmaker/internal/hubconfig"
	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

func hubMCPServerConfigs(store *hubconfig.Store) ([]hubconfig.MCPServerConfig, error) {
	if store == nil {
		return []hubconfig.MCPServerConfig{}, nil
	}
	configured, err := store.MCPServers()
	if err != nil {
		return nil, fmt.Errorf("read MCP servers: %w", err)
	}
	enabled := make([]hubconfig.MCPServerConfig, 0, len(configured))
	for _, server := range configured {
		if server.Enabled {
			enabled = append(enabled, server)
		}
	}
	sort.SliceStable(enabled, func(i, j int) bool {
		return strings.ToLower(enabled[i].Name) < strings.ToLower(enabled[j].Name)
	})
	return enabled, nil
}

// hubMCPServers returns the enabled Hub MCP entries in ACP wire form. Raw
// values are intentionally kept on this local runtime path and are never
// returned through the sanitized HubConfig snapshot.
func hubMCPServers(store *hubconfig.Store) ([]rp.MCPServer, error) {
	configured, err := hubMCPServerConfigs(store)
	if err != nil {
		return nil, err
	}
	servers := make([]rp.MCPServer, 0, len(configured))
	for _, server := range configured {
		converted := rp.MCPServer{
			Type:    string(server.Transport),
			Name:    server.Name,
			Command: server.Command,
			Args:    append([]string(nil), server.Args...),
			URL:     server.URL,
		}
		for name, value := range server.Env {
			resolved, ok := resolvedMCPValue(value)
			if !ok {
				continue
			}
			converted.Env = append(converted.Env, rp.EnvVariable{Name: name, Value: resolved})
		}
		for name, value := range server.Headers {
			resolved, ok := resolvedMCPValue(value)
			if !ok {
				continue
			}
			converted.Headers = append(converted.Headers, rp.HttpHeader{Name: name, Value: resolved})
		}
		sort.Slice(converted.Env, func(i, j int) bool {
			return strings.ToLower(converted.Env[i].Name) < strings.ToLower(converted.Env[j].Name)
		})
		sort.Slice(converted.Headers, func(i, j int) bool {
			return strings.ToLower(converted.Headers[i].Name) < strings.ToLower(converted.Headers[j].Name)
		})
		servers = append(servers, converted)
	}
	return servers, nil
}

func resolvedMCPValue(value hubconfig.MCPValue) (string, bool) {
	if value.EnvVar == "" {
		return value.Value, true
	}
	resolved, ok := os.LookupEnv(value.EnvVar)
	return resolved, ok
}
