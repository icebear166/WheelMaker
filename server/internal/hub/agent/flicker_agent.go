package agent

import (
	"context"
	"fmt"
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

// flickerConn is intentionally transport-only. MyFlicker-specific ACP behavior
// is patched into the CLI bundle by flicker_loader.go.
type flickerConn struct {
	base Conn
}

var _ Conn = (*flickerConn)(nil)

func newFlickerConn(base Conn) *flickerConn {
	return &flickerConn{base: base}
}

func (c *flickerConn) Send(ctx context.Context, method string, params any, result any) error {
	return c.base.Send(ctx, method, params, result)
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
