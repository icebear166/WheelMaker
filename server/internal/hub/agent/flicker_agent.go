package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

func flickerInstanceCreator(provider ACPProvider) InstanceCreator {
	return func(_ context.Context, cwd string) (Instance, error) {
		conn, err := NewOwnedProviderConn(provider, cwd)
		if err != nil {
			return nil, fmt.Errorf("connect %q: %w", provider.Name(), err)
		}
		return NewInstance(provider.Name(), newFlickerConn(conn)), nil
	}
}

// flickerConn adapts the myflicker ACP CLI to WheelMaker's expectations.
//
// myflicker speaks standard ACP except for one deviation: setting the active
// model is exposed as session/set_model (unstable_setSessionModel) instead of
// session/set_config_option(id="model"). flickerConn rewrites that single
// method while caching the configOptions snapshot returned by session/new and
// session/load so it can synthesize a refreshed snapshot for the caller after
// a successful set_model round-trip.
type flickerConn struct {
	base Conn

	mu      sync.Mutex
	options []protocol.ConfigOption
}

var _ Conn = (*flickerConn)(nil)

func newFlickerConn(base Conn) *flickerConn {
	return &flickerConn{base: base}
}

func (c *flickerConn) Send(ctx context.Context, method string, params any, result any) error {
	switch method {
	case protocol.MethodSessionNew, protocol.MethodSessionLoad:
		return c.sendSessionStart(ctx, method, params, result)
	case protocol.MethodSetConfigOption:
		return c.sendSetConfigOption(ctx, params, result)
	default:
		return c.base.Send(ctx, method, params, result)
	}
}

func (c *flickerConn) Notify(method string, params any) error {
	return c.base.Notify(method, params)
}

func (c *flickerConn) OnACPRequest(h ACPRequestHandler) {
	c.base.OnACPRequest(h)
}

func (c *flickerConn) OnACPResponse(h ACPResponseHandler) {
	c.base.OnACPResponse(h)
}

func (c *flickerConn) Close() error {
	return c.base.Close()
}

func (c *flickerConn) Alive() bool {
	if probe, ok := c.base.(interface{ Alive() bool }); ok {
		return probe.Alive()
	}
	return true
}

func (c *flickerConn) BindSessionID(acpSessionID string) {
	if binder, ok := c.base.(sessionBinder); ok {
		binder.BindSessionID(acpSessionID)
	}
}

// sendSessionStart forwards session/new and session/load unchanged but
// sniffs the configOptions array out of the response so subsequent
// set_model calls can produce an updated snapshot locally.
func (c *flickerConn) sendSessionStart(ctx context.Context, method string, params any, result any) error {
	var raw json.RawMessage
	if err := c.base.Send(ctx, method, params, &raw); err != nil {
		return err
	}
	c.captureOptionsFromSessionStart(raw)
	return assignResult(result, raw)
}

func (c *flickerConn) sendSetConfigOption(ctx context.Context, params any, result any) error {
	var p protocol.SessionSetConfigOptionParams
	if err := remarshal(params, &p); err != nil {
		return err
	}
	if p.ConfigID != protocol.ConfigOptionIDModel {
		return c.base.Send(ctx, protocol.MethodSetConfigOption, params, result)
	}
	req := flickerSetModelParams{
		SessionID: p.SessionID,
		ModelID:   p.Value,
	}
	var ignored json.RawMessage
	if err := c.base.Send(ctx, "session/set_model", req, &ignored); err != nil {
		return err
	}
	options := c.updateModelOption(p.Value)
	return assignResult(result, flickerSetConfigOptionResult{ConfigOptions: options})
}

func (c *flickerConn) captureOptionsFromSessionStart(raw json.RawMessage) {
	var snapshot struct {
		ConfigOptions []protocol.ConfigOption `json:"configOptions"`
	}
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		return
	}
	c.mu.Lock()
	c.options = cloneConfigOptions(snapshot.ConfigOptions)
	c.mu.Unlock()
}

func (c *flickerConn) updateModelOption(value string) []protocol.ConfigOption {
	c.mu.Lock()
	defer c.mu.Unlock()
	for idx := range c.options {
		if c.options[idx].ID == protocol.ConfigOptionIDModel {
			c.options[idx].CurrentValue = value
			return cloneConfigOptions(c.options)
		}
	}
	c.options = append(c.options, protocol.ConfigOption{
		ID:           protocol.ConfigOptionIDModel,
		Name:         "Model",
		Category:     protocol.ConfigOptionCategoryModel,
		Type:         "select",
		CurrentValue: value,
	})
	return cloneConfigOptions(c.options)
}

type flickerSetModelParams struct {
	SessionID string `json:"sessionId"`
	ModelID   string `json:"modelId"`
}

type flickerSetConfigOptionResult struct {
	ConfigOptions []protocol.ConfigOption `json:"configOptions"`
}

func cloneConfigOptions(in []protocol.ConfigOption) []protocol.ConfigOption {
	if len(in) == 0 {
		return nil
	}
	out := append([]protocol.ConfigOption(nil), in...)
	for idx := range out {
		out[idx].Options = append([]protocol.ConfigOptionValue(nil), out[idx].Options...)
	}
	return out
}
