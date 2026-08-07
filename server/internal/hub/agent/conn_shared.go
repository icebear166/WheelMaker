package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/swm8023/wheelmaker/internal/protocol"
)

// SharedConnPool multiplexes multiple instance conns over one shared raw conn.
type SharedConnPool struct {
	mu        sync.RWMutex
	unboundMu sync.Mutex
	connect   func() (Conn, error)

	closed   atomic.Bool
	routeSeq atomic.Uint64
	bindSeq  atomic.Uint64

	routes       map[string]*sharedConn
	sharedRaw    Conn
	sharedRefCnt int
	defaultRoute string

	routeState *routeState
}

func NewSharedConnPool(connect func() (Conn, error)) *SharedConnPool {
	return &SharedConnPool{
		connect:    connect,
		routes:     make(map[string]*sharedConn),
		routeState: newRouteState(),
	}
}

func (p *SharedConnPool) Open() (Conn, error) {
	if p == nil {
		return nil, errors.New("agent shared conn pool: nil pool")
	}
	if p.connect == nil {
		return nil, errors.New("agent shared conn pool: connect func is nil")
	}
	if p.closed.Load() {
		return nil, errors.New("agent shared conn pool: pool is closed")
	}

	routeKey := fmt.Sprintf("route-%d", p.routeSeq.Add(1))

	p.mu.Lock()
	defer p.mu.Unlock()

	if p.closed.Load() {
		return nil, errors.New("agent shared conn pool: pool is closed")
	}
	if p.sharedRaw == nil {
		raw, err := p.connect()
		if err != nil {
			return nil, err
		}
		p.sharedRaw = raw
		p.sharedRaw.OnACPRequest(p.dispatchInboundRequest)
		p.sharedRaw.OnACPResponse(p.dispatchInboundResponse)
	}

	route := &sharedConn{pool: p, routeKey: routeKey, raw: p.sharedRaw}
	p.routes[routeKey] = route
	p.sharedRefCnt++
	if p.defaultRoute == "" {
		p.defaultRoute = routeKey
	}

	return route, nil
}

func (p *SharedConnPool) Close() error {
	if p == nil {
		return nil
	}
	if !p.closed.CompareAndSwap(false, true) {
		return nil
	}

	p.mu.Lock()
	raw := p.sharedRaw
	for _, route := range p.routes {
		route.mu.Lock()
		route.closed = true
		route.reqHandler = nil
		route.respHandler = nil
		route.mu.Unlock()
	}
	p.routes = map[string]*sharedConn{}
	p.sharedRaw = nil
	p.sharedRefCnt = 0
	p.defaultRoute = ""
	p.routeState = newRouteState()
	p.mu.Unlock()

	if raw != nil {
		return raw.Close()
	}
	return nil
}

// Alive reports whether this pool currently owns a usable raw connection.
// A dead generation is never replaced in place because existing routes must
// remain attached to the generation on which their ACP sessions were created.
func (p *SharedConnPool) Alive() bool {
	if p == nil || p.closed.Load() {
		return false
	}
	p.mu.RLock()
	raw := p.sharedRaw
	p.mu.RUnlock()
	if raw == nil {
		return false
	}
	if probe, ok := raw.(interface{ Alive() bool }); ok {
		return probe.Alive()
	}
	return true
}

func (p *SharedConnPool) dispatchInboundRequest(ctx context.Context, requestID int64, method string, params json.RawMessage) (any, error) {
	target := p.resolveRoute(params)
	if target == nil {
		return nil, fmt.Errorf("agent shared conn: no route for inbound method %q", method)
	}
	return target.invokeInboundRequest(ctx, requestID, method, params)
}

func (p *SharedConnPool) dispatchInboundResponse(ctx context.Context, method string, params json.RawMessage) {
	target := p.resolveRoute(params)
	if target == nil {
		return
	}
	target.invokeInboundResponse(ctx, method, params)
}

func (p *SharedConnPool) resolveRoute(params json.RawMessage) *sharedConn {
	sid := parseInboundSessionID(params)

	p.mu.RLock()
	defer p.mu.RUnlock()

	routeKey := ""
	if sid != "" {
		if bound := p.routeState.lookupPending(sid); bound != nil {
			routeKey = bound.instanceKey
		} else if bound := p.routeState.lookupActive(sid); bound != nil {
			routeKey = bound.instanceKey
		}
	}
	if routeKey == "" {
		routeKey = p.defaultRoute
	}
	if routeKey == "" {
		return nil
	}
	return p.routes[routeKey]
}

func (p *SharedConnPool) closeRoute(routeKey string) error {
	if p == nil {
		return nil
	}

	p.mu.Lock()
	route, ok := p.routes[routeKey]
	if !ok {
		p.mu.Unlock()
		return nil
	}
	delete(p.routes, routeKey)
	p.routeState.removeInstance(routeKey)

	var closeRaw Conn
	p.sharedRefCnt--
	if p.sharedRefCnt <= 0 {
		closeRaw = p.sharedRaw
		p.sharedRaw = nil
		p.sharedRefCnt = 0
		p.defaultRoute = ""
	} else if p.defaultRoute == routeKey {
		p.defaultRoute = ""
		for k := range p.routes {
			p.defaultRoute = k
			break
		}
	}

	route.mu.Lock()
	route.closed = true
	route.reqHandler = nil
	route.respHandler = nil
	route.mu.Unlock()
	p.mu.Unlock()

	if closeRaw != nil {
		return closeRaw.Close()
	}
	return nil
}

// sharedConn is a per-instance routed Conn handle backed by a shared raw conn.
type sharedConn struct {
	pool     *SharedConnPool
	routeKey string
	raw      Conn

	mu          sync.RWMutex
	reqHandler  ACPRequestHandler
	respHandler ACPResponseHandler
	closed      bool
}

var _ Conn = (*sharedConn)(nil)

func (c *sharedConn) BindSessionID(acpSessionID string) {
	if c == nil || c.pool == nil {
		return
	}
	sid := strings.TrimSpace(acpSessionID)
	if sid == "" {
		return
	}
	epoch := c.pool.bindSeq.Add(1)
	token := c.pool.routeState.beginLoad(sid, c.routeKey, epoch)
	_ = c.pool.routeState.commitLoad(token)
}

func (c *sharedConn) BeginSessionLoad(acpSessionID string) sessionLoadBinding {
	if c == nil || c.pool == nil {
		return nil
	}
	sid := strings.TrimSpace(acpSessionID)
	if sid == "" {
		return nil
	}
	epoch := c.pool.bindSeq.Add(1)
	token := c.pool.routeState.beginLoad(sid, c.routeKey, epoch)
	return &sharedSessionLoadBinding{state: c.pool.routeState, token: token}
}

type sharedSessionLoadBinding struct {
	state *routeState
	token string
	once  sync.Once
	ok    bool
}

func (binding *sharedSessionLoadBinding) Commit() bool {
	if binding == nil || binding.state == nil {
		return false
	}
	binding.once.Do(func() {
		binding.ok = binding.state.commitLoad(binding.token)
	})
	return binding.ok
}

func (binding *sharedSessionLoadBinding) Rollback() {
	if binding == nil || binding.state == nil {
		return
	}
	binding.once.Do(func() {
		binding.state.rollbackLoad(binding.token)
	})
}

func (c *sharedConn) Send(ctx context.Context, method string, params any, result any) error {
	raw, err := c.rawConn()
	if err != nil {
		return err
	}
	if method == protocol.MethodInitialize || method == protocol.MethodSessionNew {
		return c.pool.sendWithProvisionalDefault(c.routeKey, func() error {
			return raw.Send(ctx, method, params, result)
		})
	}
	return raw.Send(ctx, method, params, result)
}

func (p *SharedConnPool) sendWithProvisionalDefault(routeKey string, send func() error) error {
	if p == nil || send == nil {
		return errors.New("agent shared conn: provisional send is unavailable")
	}
	p.unboundMu.Lock()
	defer p.unboundMu.Unlock()

	p.mu.Lock()
	previous := p.defaultRoute
	if _, ok := p.routes[routeKey]; ok {
		p.defaultRoute = routeKey
	}
	p.mu.Unlock()

	defer func() {
		p.mu.Lock()
		if _, ok := p.routes[previous]; ok {
			p.defaultRoute = previous
		} else if _, ok := p.routes[p.defaultRoute]; !ok {
			p.defaultRoute = ""
			for key := range p.routes {
				p.defaultRoute = key
				break
			}
		}
		p.mu.Unlock()
	}()
	return send()
}

func (c *sharedConn) Notify(method string, params any) error {
	raw, err := c.rawConn()
	if err != nil {
		return err
	}
	return raw.Notify(method, params)
}

func (c *sharedConn) OnACPRequest(h ACPRequestHandler) {
	c.mu.Lock()
	c.reqHandler = h
	c.mu.Unlock()
}

func (c *sharedConn) OnACPResponse(h ACPResponseHandler) {
	c.mu.Lock()
	c.respHandler = h
	c.mu.Unlock()
}

func (c *sharedConn) Close() error {
	if c == nil || c.pool == nil {
		return nil
	}
	return c.pool.closeRoute(c.routeKey)
}

func (c *sharedConn) Alive() bool {
	if c == nil {
		return false
	}
	c.mu.RLock()
	closed := c.closed
	raw := c.raw
	c.mu.RUnlock()
	if closed || raw == nil {
		return false
	}
	if probe, ok := raw.(interface{ Alive() bool }); ok {
		return probe.Alive()
	}
	return true
}

func (c *sharedConn) rawConn() (Conn, error) {
	c.mu.RLock()
	closed := c.closed
	raw := c.raw
	c.mu.RUnlock()
	if closed {
		return nil, errors.New("agent shared conn: route is closed")
	}
	if raw == nil {
		return nil, errors.New("agent shared conn: raw conn is nil")
	}
	return raw, nil
}

func (c *sharedConn) invokeInboundRequest(ctx context.Context, requestID int64, method string, params json.RawMessage) (any, error) {
	c.mu.RLock()
	closed := c.closed
	h := c.reqHandler
	c.mu.RUnlock()

	if closed {
		return nil, errors.New("agent shared conn: route is closed")
	}
	if h == nil {
		return nil, fmt.Errorf("agent shared conn: no request handler for route %s", c.routeKey)
	}
	return h(ctx, requestID, method, params)
}

func (c *sharedConn) invokeInboundResponse(ctx context.Context, method string, params json.RawMessage) {
	c.mu.RLock()
	closed := c.closed
	h := c.respHandler
	c.mu.RUnlock()

	if closed || h == nil {
		return
	}
	h(ctx, method, params)
}

func parseInboundSessionID(params json.RawMessage) string {
	if len(params) == 0 {
		return ""
	}
	var p struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return ""
	}
	return strings.TrimSpace(p.SessionID)
}

const defaultOrphanTTL = 5 * time.Second

type activeBinding struct {
	instanceKey string
	epoch       uint64
}

type pendingBinding struct {
	token              string
	targetACPSessionID string
	instanceKey        string
	epoch              uint64
}

type orphanUpdate struct {
	update     protocol.SessionUpdateParams
	receivedAt time.Time
}

// routeState keeps session-to-instance routing state for shared conn.
type routeState struct {
	mu       sync.RWMutex
	tokenSeq atomic.Uint64

	active  map[string]activeBinding
	pending map[string]pendingBinding
	orphan  map[string][]orphanUpdate

	orphanTTL time.Duration
	clock     func() time.Time
}

func newRouteState() *routeState {
	return &routeState{
		active:    make(map[string]activeBinding),
		pending:   make(map[string]pendingBinding),
		orphan:    make(map[string][]orphanUpdate),
		orphanTTL: defaultOrphanTTL,
		clock:     time.Now,
	}
}

func (r *routeState) beginLoad(targetACPSessionID, instanceKey string, epoch uint64) string {
	token := fmt.Sprintf("load-%d", r.tokenSeq.Add(1))
	r.mu.Lock()
	r.pending[token] = pendingBinding{
		token:              token,
		targetACPSessionID: targetACPSessionID,
		instanceKey:        instanceKey,
		epoch:              epoch,
	}
	r.mu.Unlock()
	return token
}

func (r *routeState) commitLoad(token string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	pending, ok := r.pending[token]
	if !ok {
		return false
	}
	delete(r.pending, token)

	if current, exists := r.active[pending.targetACPSessionID]; exists && current.epoch > pending.epoch {
		return false
	}

	r.active[pending.targetACPSessionID] = activeBinding{instanceKey: pending.instanceKey, epoch: pending.epoch}
	return true
}

func (r *routeState) rollbackLoad(token string) {
	r.mu.Lock()
	delete(r.pending, token)
	r.mu.Unlock()
}

func (r *routeState) lookupActive(acpSessionID string) *activeBinding {
	r.mu.RLock()
	binding, ok := r.active[acpSessionID]
	r.mu.RUnlock()
	if !ok {
		return nil
	}
	copy := binding
	return &copy
}

func (r *routeState) lookupPending(acpSessionID string) *activeBinding {
	r.mu.RLock()
	var selected *activeBinding
	for _, binding := range r.pending {
		if binding.targetACPSessionID != acpSessionID {
			continue
		}
		if selected == nil || binding.epoch > selected.epoch {
			selected = &activeBinding{instanceKey: binding.instanceKey, epoch: binding.epoch}
		}
	}
	r.mu.RUnlock()
	return selected
}

func (r *routeState) lookupActiveForEpoch(acpSessionID string, epoch uint64) *activeBinding {
	r.mu.RLock()
	binding, ok := r.active[acpSessionID]
	r.mu.RUnlock()
	if !ok || binding.epoch != epoch {
		return nil
	}
	copy := binding
	return &copy
}

func (r *routeState) removeInstance(instanceKey string) {
	r.mu.Lock()
	for sid, binding := range r.active {
		if binding.instanceKey == instanceKey {
			delete(r.active, sid)
		}
	}
	for token, pending := range r.pending {
		if pending.instanceKey == instanceKey {
			delete(r.pending, token)
		}
	}
	r.mu.Unlock()
}

func (r *routeState) bufferOrphan(acpSessionID string, update protocol.SessionUpdateParams, now time.Time) {
	r.mu.Lock()
	r.orphan[acpSessionID] = append(r.orphan[acpSessionID], orphanUpdate{update: update, receivedAt: now})
	r.pruneOrphansLocked(now)
	r.mu.Unlock()
}

func (r *routeState) replayOrphans(acpSessionID string) []protocol.SessionUpdateParams {
	now := r.now()
	if r.clock == nil {
		now = time.Now()
	}

	r.mu.Lock()
	r.pruneOrphansLocked(now)
	buffered := r.orphan[acpSessionID]
	delete(r.orphan, acpSessionID)
	r.mu.Unlock()

	out := make([]protocol.SessionUpdateParams, 0, len(buffered))
	for _, item := range buffered {
		out = append(out, item.update)
	}
	return out
}

func (r *routeState) pruneOrphans(now time.Time) {
	r.mu.Lock()
	r.pruneOrphansLocked(now)
	r.mu.Unlock()
}

func (r *routeState) pruneOrphansLocked(now time.Time) {
	if r.orphanTTL <= 0 {
		for key := range r.orphan {
			delete(r.orphan, key)
		}
		return
	}

	for acpSessionID, updates := range r.orphan {
		kept := updates[:0]
		for _, item := range updates {
			if now.Sub(item.receivedAt) <= r.orphanTTL {
				kept = append(kept, item)
			}
		}
		if len(kept) == 0 {
			delete(r.orphan, acpSessionID)
			continue
		}
		r.orphan[acpSessionID] = kept
	}
}

func (r *routeState) now() time.Time {
	if r.clock == nil {
		return time.Now()
	}
	return r.clock()
}
