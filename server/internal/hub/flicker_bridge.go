package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/swm8023/wheelmaker/internal/flickerbridge"
	"github.com/swm8023/wheelmaker/internal/hubconfig"
	shared "github.com/swm8023/wheelmaker/internal/shared"
)

const (
	flickerBridgeHost     = "127.0.0.1"
	flickerBridgePort     = 17999
	flickerBridgeEndpoint = "http://127.0.0.1:17999"
)

type flickerBridgeStatus struct {
	Configured     bool                         `json:"configured"`
	Supported      bool                         `json:"supported"`
	State          string                       `json:"state"`
	Mode           flickerBridgeMode            `json:"mode"`
	RunningMode    flickerBridgeMode            `json:"runningMode,omitempty"`
	AvailableModes []flickerBridgeMode          `json:"availableModes"`
	ModeErrors     map[flickerBridgeMode]string `json:"modeErrors,omitempty"`
	Endpoint       string                       `json:"endpoint"`
	Port           int                          `json:"port"`
	PID            int                          `json:"pid,omitempty"`
	Error          string                       `json:"error,omitempty"`
}

type flickerBridgeMode string

const (
	flickerBridgeModeV1 flickerBridgeMode = "v1"
	flickerBridgeModeV2 flickerBridgeMode = "v2"
)

type flickerBridgeModeStore interface {
	FlickerBridgeMode() (hubconfig.FlickerBridgeMode, error)
	UpdateFlickerBridgeMode(hubconfig.FlickerBridgeMode) error
}

type flickerBridgeProcess interface {
	PID() int
	Kill() error
	Wait() error
}

type execFlickerBridgeProcess struct {
	cmd *exec.Cmd
}

func (p *execFlickerBridgeProcess) PID() int {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return 0
	}
	return p.cmd.Process.Pid
}

func (p *execFlickerBridgeProcess) Kill() error {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return os.ErrProcessDone
	}
	return p.cmd.Process.Kill()
}

func (p *execFlickerBridgeProcess) Wait() error {
	if p == nil || p.cmd == nil {
		return os.ErrProcessDone
	}
	return p.cmd.Wait()
}

type flickerBridgeManager struct {
	mu          sync.Mutex
	operationMu sync.Mutex
	configured  bool
	supported   bool
	state       string
	errMessage  string
	apiKey      string
	stateDir    string
	mode        flickerBridgeMode
	runningMode flickerBridgeMode
	processMode flickerBridgeMode
	modeStore   flickerBridgeModeStore
	configError error

	process             flickerBridgeProcess
	done                chan struct{}
	stopping            bool
	executable          func() (string, error)
	startProcess        func(string, []string, []string, io.Writer) (flickerBridgeProcess, error)
	health              func(context.Context) error
	modeAvailable       func(flickerBridgeMode) error
	availabilityChecked bool
	availableModes      []flickerBridgeMode
	modeErrors          map[flickerBridgeMode]string

	healthInterval       time.Duration
	healthAttemptTimeout time.Duration
	healthTimeout        time.Duration
	stateChange          func(flickerBridgeStatus)
	// onReady fires once each time the bridge transitions into the running
	// state (initial start and every restart), after health checks pass. Used
	// to refresh the shared flicker model catalog from the live /v1/models.
	onReady func()
}

func newFlickerBridgeManager(stateDir, apiKey string, stores ...flickerBridgeModeStore) *flickerBridgeManager {
	apiKey = strings.TrimSpace(apiKey)
	var modeStore flickerBridgeModeStore
	if len(stores) > 0 {
		modeStore = stores[0]
	}
	if modeStore == nil {
		modeStore = hubconfig.New(filepath.Join(stateDir, "db", "hub-config.json"))
	}
	manager := &flickerBridgeManager{
		configured:           apiKey != "",
		supported:            runtime.GOOS == "windows" && runtime.GOARCH == "amd64",
		apiKey:               apiKey,
		stateDir:             stateDir,
		executable:           os.Executable,
		healthInterval:       250 * time.Millisecond,
		healthAttemptTimeout: 750 * time.Millisecond,
		healthTimeout:        5 * time.Minute,
		mode:                 flickerBridgeModeV1,
		modeStore:            modeStore,
		modeErrors:           map[flickerBridgeMode]string{},
	}
	manager.startProcess = startFlickerBridgeProcess
	manager.health = flickerBridgeHealth
	manager.modeAvailable = manager.defaultModeAvailable
	if mode, err := modeStore.FlickerBridgeMode(); err != nil {
		manager.configError = err
		manager.errMessage = err.Error()
	} else {
		manager.mode = flickerBridgeMode(mode)
	}
	if !manager.configured {
		manager.state = "notConfigured"
		return manager
	}
	if !manager.supported {
		manager.state = "unsupported"
		return manager
	}
	manager.state = "stopped"
	return manager
}

func (m *flickerBridgeManager) defaultModeAvailable(mode flickerBridgeMode) error {
	if !m.supported {
		return fmt.Errorf("Flicker Bridge is supported only on Windows x64")
	}
	if mode == flickerBridgeModeV1 {
		return nil
	}
	if mode != flickerBridgeModeV2 {
		return fmt.Errorf("unsupported Flicker Bridge mode %q", mode)
	}
	probe := flickerbridge.ProbeV2()
	if !probe.Available {
		if probe.Error == "" {
			return fmt.Errorf("Flicker Bridge V2 is unavailable")
		}
		return fmt.Errorf("%s", probe.Error)
	}
	return nil
}

func (m *flickerBridgeManager) refreshModeAvailabilityLocked() {
	if m.availabilityChecked {
		return
	}
	m.availabilityChecked = true
	m.availableModes = nil
	m.modeErrors = map[flickerBridgeMode]string{}
	for _, mode := range []flickerBridgeMode{flickerBridgeModeV1, flickerBridgeModeV2} {
		if err := m.modeAvailable(mode); err != nil {
			m.modeErrors[mode] = err.Error()
			continue
		}
		m.availableModes = append(m.availableModes, mode)
	}
}

func (m *flickerBridgeManager) requireModeAvailableLocked(mode flickerBridgeMode) error {
	if mode != flickerBridgeModeV1 && mode != flickerBridgeModeV2 {
		return fmt.Errorf("unsupported Flicker Bridge mode %q", mode)
	}
	m.refreshModeAvailabilityLocked()
	for _, available := range m.availableModes {
		if available == mode {
			return nil
		}
	}
	if message := m.modeErrors[mode]; message != "" {
		return fmt.Errorf("%s", message)
	}
	return fmt.Errorf("Flicker Bridge mode %q is unavailable", mode)
}

func (m *flickerBridgeManager) localAPIKey() string {
	if m == nil {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.apiKey
}

func (m *flickerBridgeManager) setStateChangeHandler(handler func(flickerBridgeStatus)) {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.stateChange = handler
	m.mu.Unlock()
}

func (m *flickerBridgeManager) setReadyHandler(handler func()) {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.onReady = handler
	m.mu.Unlock()
}

func notifyFlickerBridgeState(handler func(flickerBridgeStatus), status flickerBridgeStatus) {
	if handler != nil {
		handler(status)
	}
}

func (m *flickerBridgeManager) Start(ctx context.Context) (flickerBridgeStatus, error) {
	if m == nil {
		return flickerBridgeStatus{}, fmt.Errorf("Flicker Bridge manager is unavailable")
	}
	m.operationMu.Lock()
	defer m.operationMu.Unlock()
	m.mu.Lock()
	mode := m.mode
	m.mu.Unlock()
	return m.start(ctx, mode)
}

func (m *flickerBridgeManager) StartWithV2Fallback(ctx context.Context) (flickerBridgeStatus, error) {
	if m == nil {
		return flickerBridgeStatus{}, fmt.Errorf("Flicker Bridge manager is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	m.operationMu.Lock()
	defer m.operationMu.Unlock()

	m.mu.Lock()
	mode := m.mode
	m.mu.Unlock()
	status, startErr := m.start(ctx, mode)
	if mode != flickerBridgeModeV2 {
		return status, startErr
	}
	if startErr == nil {
		startErr = m.waitUntilRunning(ctx, flickerBridgeModeV2)
	}
	if startErr == nil {
		return m.Status(ctx), nil
	}

	_, _ = m.stop(ctx)
	if _, rollbackErr := m.start(ctx, flickerBridgeModeV1); rollbackErr != nil {
		return m.Status(ctx), fmt.Errorf("start V2: %v; rollback to V1: %w", startErr, rollbackErr)
	}
	if rollbackErr := m.waitUntilRunning(ctx, flickerBridgeModeV1); rollbackErr != nil {
		return m.Status(ctx), fmt.Errorf("start V2: %v; rollback to V1: %w", startErr, rollbackErr)
	}
	if persistErr := m.modeStore.UpdateFlickerBridgeMode(hubconfig.FlickerBridgeModeV1); persistErr != nil {
		return m.Status(ctx), fmt.Errorf("start V2: %v; persist V1 rollback: %w", startErr, persistErr)
	}

	m.mu.Lock()
	m.mode = flickerBridgeModeV1
	m.errMessage = startErr.Error()
	status = m.statusLocked()
	stateChange := m.stateChange
	m.mu.Unlock()
	notifyFlickerBridgeState(stateChange, status)
	return status, startErr
}

func (m *flickerBridgeManager) start(ctx context.Context, mode flickerBridgeMode) (flickerBridgeStatus, error) {
	if m == nil {
		return flickerBridgeStatus{}, fmt.Errorf("Flicker Bridge manager is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return m.Status(ctx), err
	}
	m.mu.Lock()
	if !m.configured {
		status := m.statusLocked()
		m.mu.Unlock()
		return status, fmt.Errorf("Flicker Bridge is not configured")
	}
	if !m.supported {
		status := m.statusLocked()
		m.mu.Unlock()
		return status, fmt.Errorf("Flicker Bridge is supported only on Windows x64")
	}
	if err := m.requireModeAvailableLocked(mode); err != nil {
		m.state = "failed"
		m.errMessage = err.Error()
		status := m.statusLocked()
		stateChange := m.stateChange
		m.mu.Unlock()
		notifyFlickerBridgeState(stateChange, status)
		return status, err
	}
	if m.process != nil {
		status := m.statusLocked()
		if m.state == "failed" {
			m.mu.Unlock()
			return status, fmt.Errorf("Flicker Bridge process is failed but still shutting down; use restart or stop")
		}
		m.mu.Unlock()
		return status, nil
	}
	if m.apiKey == "" {
		m.state = "failed"
		m.errMessage = "local bridge credential is unavailable"
		status := m.statusLocked()
		m.mu.Unlock()
		return status, fmt.Errorf("%s", m.errMessage)
	}
	executable := m.executable
	starter := m.startProcess
	apiKey := m.apiKey
	stateDir := m.stateDir
	m.state = "starting"
	m.errMessage = ""

	executablePath, err := executable()
	if err != nil {
		return m.failStartLocked(err)
	}
	args, environ := m.launchSpecLocked(mode, apiKey, stateDir)
	process, err := starter(executablePath, args, environ, io.Discard)
	if err != nil {
		return m.failStartLocked(err)
	}

	m.process = process
	m.processMode = mode
	m.runningMode = ""
	m.done = make(chan struct{})
	m.stopping = false
	m.state = "starting"
	m.errMessage = ""
	done := m.done
	status := m.statusLocked()
	stateChange := m.stateChange
	m.mu.Unlock()
	notifyFlickerBridgeState(stateChange, status)
	go m.watch(process, done)
	go m.waitForHealth(process, done)
	return status, nil
}

func (m *flickerBridgeManager) failStartLocked(err error) (flickerBridgeStatus, error) {
	m.state = "failed"
	m.errMessage = err.Error()
	status := m.statusLocked()
	stateChange := m.stateChange
	m.mu.Unlock()
	notifyFlickerBridgeState(stateChange, status)
	return status, err
}

func (m *flickerBridgeManager) launchSpecLocked(mode flickerBridgeMode, apiKey, stateDir string) ([]string, []string) {
	baseArgs := []string{"--host", flickerBridgeHost, "--port", fmt.Sprint(flickerBridgePort)}
	switch mode {
	case flickerBridgeModeV2:
		return append([]string{"--flicker-bridge-v2"}, baseArgs...), append(os.Environ(),
			"MYFLICKER_WANQING_PROXY_KEY="+apiKey,
		)
	default:
		logPath := filepath.Join(stateDir, "log", "flicker-bridge.log")
		return append([]string{"--flicker-bridge"}, baseArgs...), append(os.Environ(),
			"MYFLICKER_BRIDGE_API_KEY="+apiKey,
			"MYFLICKER_BRIDGE_CACHE="+filepath.Join(stateDir, "flicker-bridge.json"),
			"MYFLICKER_BRIDGE_LOG="+logPath,
		)
	}
}

func (m *flickerBridgeManager) Stop(ctx context.Context) (flickerBridgeStatus, error) {
	if m == nil {
		return flickerBridgeStatus{}, fmt.Errorf("Flicker Bridge manager is unavailable")
	}
	m.operationMu.Lock()
	defer m.operationMu.Unlock()
	return m.stop(ctx)
}

func (m *flickerBridgeManager) stop(ctx context.Context) (flickerBridgeStatus, error) {
	if m == nil {
		return flickerBridgeStatus{}, fmt.Errorf("Flicker Bridge manager is unavailable")
	}
	m.mu.Lock()
	if !m.configured || !m.supported {
		status := m.statusLocked()
		m.mu.Unlock()
		return status, nil
	}
	process := m.process
	done := m.done
	if process == nil {
		m.state = "stopped"
		m.errMessage = ""
		status := m.statusLocked()
		stateChange := m.stateChange
		m.mu.Unlock()
		notifyFlickerBridgeState(stateChange, status)
		return status, nil
	}
	m.stopping = true
	m.mu.Unlock()
	if err := process.Kill(); err != nil && err != os.ErrProcessDone {
		return m.failStop(err)
	}
	select {
	case <-done:
	case <-ctx.Done():
		return m.Status(ctx), ctx.Err()
	}
	return m.Status(ctx), nil
}

func (m *flickerBridgeManager) failStop(err error) (flickerBridgeStatus, error) {
	m.mu.Lock()
	m.stopping = false
	m.state = "failed"
	m.errMessage = err.Error()
	status := m.statusLocked()
	stateChange := m.stateChange
	m.mu.Unlock()
	notifyFlickerBridgeState(stateChange, status)
	return status, err
}

func (m *flickerBridgeManager) Restart(ctx context.Context) (flickerBridgeStatus, error) {
	if m == nil {
		return flickerBridgeStatus{}, fmt.Errorf("Flicker Bridge manager is unavailable")
	}
	m.operationMu.Lock()
	defer m.operationMu.Unlock()
	if _, err := m.stop(ctx); err != nil {
		return m.Status(ctx), err
	}
	m.mu.Lock()
	mode := m.mode
	m.mu.Unlock()
	return m.start(ctx, mode)
}

func (m *flickerBridgeManager) SwitchMode(ctx context.Context, target flickerBridgeMode) (flickerBridgeStatus, error) {
	if m == nil {
		return flickerBridgeStatus{}, fmt.Errorf("Flicker Bridge manager is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	m.operationMu.Lock()
	defer m.operationMu.Unlock()

	m.mu.Lock()
	if err := m.requireModeAvailableLocked(target); err != nil {
		status := m.statusLocked()
		m.mu.Unlock()
		return status, err
	}
	original := m.mode
	running := m.process != nil
	if target == original {
		status := m.statusLocked()
		m.mu.Unlock()
		return status, nil
	}
	m.mu.Unlock()

	if !running {
		if err := m.modeStore.UpdateFlickerBridgeMode(hubconfig.FlickerBridgeMode(target)); err != nil {
			return m.Status(ctx), err
		}
		m.mu.Lock()
		m.mode = target
		m.configError = nil
		m.errMessage = ""
		if m.configured && m.supported {
			m.state = "stopped"
		}
		status := m.statusLocked()
		stateChange := m.stateChange
		m.mu.Unlock()
		notifyFlickerBridgeState(stateChange, status)
		return status, nil
	}

	if _, err := m.stop(ctx); err != nil {
		return m.Status(ctx), err
	}
	if _, err := m.start(ctx, target); err != nil {
		return m.rollbackModeSwitch(ctx, original, err)
	}
	if err := m.waitUntilRunning(ctx, target); err != nil {
		return m.rollbackModeSwitch(ctx, original, err)
	}
	if err := m.modeStore.UpdateFlickerBridgeMode(hubconfig.FlickerBridgeMode(target)); err != nil {
		return m.rollbackModeSwitch(ctx, original, fmt.Errorf("persist Flicker Bridge mode: %w", err))
	}

	m.mu.Lock()
	m.mode = target
	m.configError = nil
	status := m.statusLocked()
	stateChange := m.stateChange
	m.mu.Unlock()
	notifyFlickerBridgeState(stateChange, status)
	return status, nil
}

func (m *flickerBridgeManager) rollbackModeSwitch(ctx context.Context, original flickerBridgeMode, switchErr error) (flickerBridgeStatus, error) {
	_, _ = m.stop(ctx)
	m.mu.Lock()
	m.mode = original
	m.mu.Unlock()

	if _, rollbackErr := m.start(ctx, original); rollbackErr != nil {
		return m.Status(ctx), fmt.Errorf("switch mode: %v; rollback to %s: %w", switchErr, original, rollbackErr)
	}
	if rollbackErr := m.waitUntilRunning(ctx, original); rollbackErr != nil {
		return m.Status(ctx), fmt.Errorf("switch mode: %v; rollback to %s: %w", switchErr, original, rollbackErr)
	}

	m.mu.Lock()
	m.errMessage = switchErr.Error()
	status := m.statusLocked()
	stateChange := m.stateChange
	m.mu.Unlock()
	notifyFlickerBridgeState(stateChange, status)
	return status, switchErr
}

func (m *flickerBridgeManager) waitUntilRunning(ctx context.Context, expectedMode flickerBridgeMode) error {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		m.mu.Lock()
		state := m.state
		runningMode := m.runningMode
		errMessage := m.errMessage
		process := m.process
		m.mu.Unlock()

		if state == "running" && runningMode == expectedMode {
			return nil
		}
		if state == "failed" || process == nil {
			if errMessage == "" {
				errMessage = "Flicker Bridge stopped before becoming healthy"
			}
			return fmt.Errorf("%s", errMessage)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

func (m *flickerBridgeManager) Status(_ context.Context) flickerBridgeStatus {
	if m == nil {
		return flickerBridgeStatus{
			State:          "unavailable",
			Mode:           flickerBridgeModeV1,
			AvailableModes: []flickerBridgeMode{},
			Endpoint:       flickerBridgeEndpoint,
			Port:           flickerBridgePort,
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.statusLocked()
}

func (m *flickerBridgeManager) statusLocked() flickerBridgeStatus {
	m.refreshModeAvailabilityLocked()
	modeErrors := make(map[flickerBridgeMode]string, len(m.modeErrors))
	for mode, message := range m.modeErrors {
		modeErrors[mode] = message
	}
	status := flickerBridgeStatus{
		Configured:     m.configured,
		Supported:      m.supported,
		State:          m.state,
		Mode:           m.mode,
		RunningMode:    m.runningMode,
		AvailableModes: append([]flickerBridgeMode(nil), m.availableModes...),
		ModeErrors:     modeErrors,
		Endpoint:       flickerBridgeEndpoint,
		Port:           flickerBridgePort,
		Error:          m.errMessage,
	}
	if m.process != nil {
		status.PID = m.process.PID()
	}
	return status
}

func (m *flickerBridgeManager) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := m.Stop(ctx)
	return err
}

func (m *flickerBridgeManager) watch(process flickerBridgeProcess, done chan struct{}) {
	err := process.Wait()
	m.mu.Lock()
	if m.process != process {
		m.mu.Unlock()
		return
	}
	m.process = nil
	m.done = nil
	m.processMode = ""
	m.runningMode = ""
	if m.stopping {
		m.state = "stopped"
		m.errMessage = ""
	} else if m.state != "failed" || m.errMessage == "" {
		m.state = "failed"
		if err != nil {
			m.errMessage = err.Error()
		} else {
			m.errMessage = "Flicker Bridge exited unexpectedly"
		}
	}
	m.stopping = false
	close(done)
	status := m.statusLocked()
	stateChange := m.stateChange
	m.mu.Unlock()
	notifyFlickerBridgeState(stateChange, status)
}

func (m *flickerBridgeManager) waitForHealth(process flickerBridgeProcess, done <-chan struct{}) {
	ticker := time.NewTicker(m.healthInterval)
	defer ticker.Stop()
	timeout := time.NewTimer(m.healthTimeout)
	defer timeout.Stop()
	for {
		select {
		case <-done:
			return
		case <-timeout.C:
			kill := false
			var status flickerBridgeStatus
			var stateChange func(flickerBridgeStatus)
			m.mu.Lock()
			if m.process == process && m.state == "starting" {
				m.state = "failed"
				m.errMessage = "Flicker Bridge health check timed out"
				kill = true
				status = m.statusLocked()
				stateChange = m.stateChange
			}
			m.mu.Unlock()
			if kill {
				notifyFlickerBridgeState(stateChange, status)
			}
			if kill {
				_ = process.Kill()
			}
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), m.healthAttemptTimeout)
			err := m.health(ctx)
			cancel()
			if err != nil {
				continue
			}
			var status flickerBridgeStatus
			var stateChange func(flickerBridgeStatus)
			var onReady func()
			m.mu.Lock()
			if m.process == process && m.state == "starting" {
				m.state = "running"
				m.errMessage = ""
				m.runningMode = m.processMode
				status = m.statusLocked()
				stateChange = m.stateChange
				onReady = m.onReady
			}
			m.mu.Unlock()
			if status.State != "" {
				notifyFlickerBridgeState(stateChange, status)
				if onReady != nil {
					go onReady()
				}
			}
			return
		}
	}
}

func startFlickerBridgeProcess(executable string, args []string, environ []string, output io.Writer) (flickerBridgeProcess, error) {
	cmd := exec.Command(executable, args...)
	cmd.Env = environ
	cmd.Stdout = output
	cmd.Stderr = output
	shared.ConfigureBackgroundCommand(cmd)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start Flicker Bridge: %w", err)
	}
	return &execFlickerBridgeProcess{cmd: cmd}, nil
}

func flickerBridgeHealth(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, flickerBridgeEndpoint+"/_myflicker/health", nil)
	if err != nil {
		return err
	}
	response, err := (&http.Client{Timeout: time.Second}).Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("bridge health returned %s", response.Status)
	}
	var payload struct {
		OK bool `json:"ok"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&payload); err != nil {
		return fmt.Errorf("decode bridge health: %w", err)
	}
	if !payload.OK {
		return fmt.Errorf("bridge health reported not ready")
	}
	return nil
}
