// Command wheelmaker runs hub/registry workers and guardian mode.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

	"github.com/swm8023/wheelmaker/internal/flickerbridge"
	"github.com/swm8023/wheelmaker/internal/hub"
	"github.com/swm8023/wheelmaker/internal/registry"
	"github.com/swm8023/wheelmaker/internal/security"
	"github.com/swm8023/wheelmaker/internal/serverdata"
	logger "github.com/swm8023/wheelmaker/internal/shared"
	"github.com/swm8023/wheelmaker/internal/shared/agentpath"
	"github.com/swm8023/wheelmaker/internal/shared/winsvc"
)

const daemonWorkerArg = "--daemon-worker"
const hubWorkerArg = "--hub-worker"
const registryWorkerArg = "--registry-worker"
const localDevArg = "--local-dev"
const flickerBridgeArg = "--flicker-bridge"
const flickerBridgeV2Arg = "--flicker-bridge-v2"
const wheelmakerWindowsServiceName = "WheelMaker"
const defaultRegistryAddr = "127.0.0.1:9630"

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "wheelmaker: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case flickerBridgeArg:
			return flickerbridge.Run(os.Args[2:])
		case flickerBridgeV2Arg:
			return flickerbridge.RunV2(os.Args[2:])
		}
	}
	fs := flag.NewFlagSet("wheelmaker", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	daemonMode := fs.Bool("d", false, "run guardian mode (checks service every 30 seconds)")
	daemonWorker := fs.Bool("daemon-worker", false, "internal: worker mode for guardian")
	hubWorker := fs.Bool("hub-worker", false, "internal: hub worker mode for guardian")
	registryWorker := fs.Bool("registry-worker", false, "internal: registry worker mode for guardian")
	registryServer := fs.Bool("registry-server", false, "run registry websocket server mode")
	registryAddr := fs.String("registry-addr", defaultRegistryAddr, "registry websocket listen address")
	wmDir := fs.String("dir", "", "WheelMaker home directory (default: ~/.wheelmaker)")
	localDev := fs.Bool("local-dev", false, "internal: run the Windows Local Dev Hub and Registry stack")
	if err := fs.Parse(os.Args[1:]); err != nil {
		return err
	}
	if *localDev && runtime.GOOS != "windows" {
		return fmt.Errorf("%s is supported only on Windows", localDevArg)
	}

	if !*localDev && !*registryServer && !*registryWorker && !*hubWorker && !*daemonWorker {
		ranAsService, err := runAsWindowsServiceIfNeeded(fs.Args(), *wmDir)
		if err != nil {
			return err
		}
		if ranAsService {
			return nil
		}
	}

	switch {
	case *registryServer:
		return runRegistryServer(*registryAddr, *wmDir)
	case *registryWorker:
		return runRegistryWorker(*wmDir, *localDev)
	case *hubWorker:
		return runHubWorker(*wmDir, *localDev)
	case *daemonWorker:
		return runHubWorker(*wmDir, *localDev)
	case *daemonMode:
		restoreStdio, err := redirectProcessStdioToDevNull()
		if err != nil {
			return err
		}
		defer restoreStdio()
		return runGuardian(fs.Args(), *wmDir, *localDev)
	default:
		return runHubWorker(*wmDir, *localDev)
	}
}

func runRegistryServer(addr, stateDir string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("home dir: %w", err)
	}
	baseDir := wheelMakerStateDir(home, stateDir)
	cfg, err := loadValidatedRuntimeConfig(baseDir)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	s := registry.New(registryServerConfig(addr, cfg.Registry.Token, baseDir))
	return s.Run(ctx)
}

func loadValidatedRuntimeConfig(baseDir string) (*logger.AppConfig, error) {
	cfgPath := filepath.Join(baseDir, "config.json")
	cfg, err := logger.LoadConfig(cfgPath)
	if err != nil {
		return nil, fmt.Errorf("cannot load config.json at %s: %w", cfgPath, err)
	}
	if err := security.ValidateRegistryToken(cfg.Registry.Token); err != nil {
		return nil, fmt.Errorf("invalid config.json at %s: %w", cfgPath, err)
	}
	return cfg, nil
}

func runHubWorker(stateDir string, localDev bool) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("home dir: %w", err)
	}

	baseDir := wheelMakerStateDir(home, stateDir)
	dbPath := filepath.Join(baseDir, "db", "client.sqlite3")

	cfg, err := loadValidatedRuntimeConfig(baseDir)
	if err != nil {
		return err
	}
	if localDev {
		cfg = localDevRuntimeConfig(cfg)
	}
	cfgPath := filepath.Join(baseDir, "config.json")
	hubLogPath := filepath.Join(baseDir, "log", "hub.log")

	if err := logger.Setup(logger.LoggerConfig{
		Level:   logger.ParseLevel(cfg.Log.Level),
		LogFile: hubLogPath,
	}); err != nil {
		return fmt.Errorf("logger setup: %w", err)
	}
	defer logger.Close()
	hubScopedLogger.Info("worker start cfg=%s db=%s", cfgPath, dbPath)

	// Augment PATH with npm's global bin (and common install locations) before
	// any agent provider is constructed. DefaultACPFactory probes availability
	// via exec.LookPath at first use, and the hub may have been (re)started by
	// the updater from a service context whose PATH lacks npm's global bin —
	// without this, globally-installed CLIs like codex vanish after an update.
	// Must run before hub.New/Start so the factory sees the augmented PATH.
	if extra := agentpath.DiscoverExtraDirs(); len(extra) > 0 {
		agentpath.AppendToPath(extra)
		hubScopedLogger.Info("agent path augmented dirs=%v", extra)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	h := hub.New(cfg, dbPath)
	if err := h.Start(ctx); err != nil {
		hubScopedLogger.Error("start failed err=%v", err)
		return err
	}
	hubScopedLogger.Info("started")
	defer h.Close()

	if err := h.Run(ctx); err != nil {
		hubScopedLogger.Error("run failed err=%v", err)
		return err
	}
	hubScopedLogger.Info("run exited")
	return nil
}

func runRegistryWorker(stateDir string, localDev bool) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("home dir: %w", err)
	}
	baseDir := wheelMakerStateDir(home, stateDir)
	cfg, err := loadValidatedRuntimeConfig(baseDir)
	if err != nil {
		return err
	}
	if localDev {
		cfg = localDevRuntimeConfig(cfg)
	}
	regLog := filepath.Join(baseDir, "log", "registry.log")

	if err := logger.Setup(logger.LoggerConfig{
		Level:   logger.ParseLevel(cfg.Log.Level),
		LogFile: regLog,
	}); err != nil {
		return fmt.Errorf("logger setup: %w", err)
	}
	defer logger.Close()

	host := cfg.Registry.Server
	if host == "" {
		host = "127.0.0.1"
	}
	port := cfg.Registry.Port
	if port == 0 {
		port = 9630
	}
	addr := fmt.Sprintf("%s:%d", host, port)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	registryScopedLogger.Info("worker start addr=%s", addr)
	s := registry.New(registryServerConfig(addr, cfg.Registry.Token, baseDir))
	if err := s.Run(ctx); err != nil {
		registryScopedLogger.Error("worker run failed err=%v", err)
		return err
	}
	registryScopedLogger.Info("worker exited")
	return nil
}

func registryServerConfig(addr, token, stateDir string) registry.Config {
	return registry.Config{
		Addr:               addr,
		Token:              token,
		LogDir:             filepath.Join(stateDir, "log"),
		StateDir:           stateDir,
		ServerData:         serverdata.New(filepath.Join(stateDir, "db", "server-data.json")),
		IPLocationResolver: registry.NewIPWhoisLocationResolver(),
	}
}

func localDevRuntimeConfig(cfg *logger.AppConfig) *logger.AppConfig {
	local := *cfg
	local.Registry.Listen = true
	local.Registry.Server = "127.0.0.1"
	local.Registry.Port = 9630
	return &local
}

func wheelmakerLogDir(home string) string {
	return filepath.Join(home, ".wheelmaker", "log")
}

func runAsWindowsServiceIfNeeded(workerArgs []string, stateDir string) (bool, error) {
	sanitizedArgs := sanitizeWorkerArgs(workerArgs)
	return winsvc.RunIfWindowsService(
		wheelmakerWindowsServiceName,
		func(ctx context.Context) error {
			return runGuardianWithContext(ctx, sanitizedArgs, stateDir, false)
		},
		nil,
	)
}

func wheelMakerStateDir(home string, override string) string {
	if override != "" {
		return filepath.Clean(override)
	}
	return filepath.Join(home, ".wheelmaker")
}
