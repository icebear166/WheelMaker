package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/swm8023/wheelmaker/internal/shared"
)

type localDevConfig struct {
	SourcePath string `json:"sourcePath"`
}

type localDevConfigStore interface {
	Load() (localDevConfig, error)
	Save(localDevConfig) error
}

type fileLocalDevConfigStore struct {
	path string
}

func newFileLocalDevConfigStore(path string) *fileLocalDevConfigStore {
	return &fileLocalDevConfigStore{path: path}
}

func (s *fileLocalDevConfigStore) Load() (localDevConfig, error) {
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return localDevConfig{}, nil
	}
	if err != nil {
		return localDevConfig{}, err
	}
	var config localDevConfig
	if err := json.Unmarshal(raw, &config); err != nil {
		return localDevConfig{}, fmt.Errorf("decode local dev config: %w", err)
	}
	return config, nil
}

func (s *fileLocalDevConfigStore) Save(config localDevConfig) error {
	raw, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("encode local dev config: %w", err)
	}
	return shared.WriteConfigFile(s.path, append(raw, '\n'))
}

type localDevOperation string

const (
	localDevBuild         localDevOperation = "build"
	localDevStart         localDevOperation = "start"
	localDevStop          localDevOperation = "stop"
	localDevRestart       localDevOperation = "restart"
	localDevOpenDirectory localDevOperation = "open-directory"
	localDevExit          localDevOperation = "exit"
)

type localDevState struct {
	SourcePath string `json:"sourcePath"`
	Running    bool   `json:"running"`
	Message    string `json:"message"`
}

type localDevExecutor interface {
	Run(context.Context, string, localDevOperation) error
	OpenDirectory(string) error
}

type localDevController struct {
	store    localDevConfigStore
	executor localDevExecutor
	devRoot  string
}

func newLocalDevController(store localDevConfigStore, executor localDevExecutor, configuredRoot ...string) *localDevController {
	devRoot := ""
	if len(configuredRoot) > 0 {
		devRoot = configuredRoot[0]
	} else if home, err := os.UserHomeDir(); err == nil {
		devRoot = filepath.Join(home, ".wheelmaker", "dev")
	}
	return &localDevController{store: store, executor: executor, devRoot: devRoot}
}

func (c *localDevController) State() (localDevState, error) {
	config, err := c.store.Load()
	if err != nil {
		return localDevState{}, err
	}
	_, runtimeErr := os.Stat(filepath.Join(c.devRoot, "runtime.json"))
	return localDevState{SourcePath: config.SourcePath, Running: runtimeErr == nil}, nil
}

func (c *localDevController) SaveSource(raw string) (localDevState, error) {
	root, err := validateLocalDevSourceRoot(raw)
	if err != nil {
		return localDevState{}, err
	}
	if err := c.store.Save(localDevConfig{SourcePath: root}); err != nil {
		return localDevState{}, err
	}
	state, err := c.State()
	state.Message = "Source directory saved"
	return state, err
}

func (c *localDevController) Run(ctx context.Context, raw string) (localDevState, error) {
	operation, err := parseLocalDevOperation(raw)
	if err != nil {
		return localDevState{}, err
	}
	config, err := c.store.Load()
	if err != nil {
		return localDevState{}, err
	}
	root, err := validateLocalDevSourceRoot(config.SourcePath)
	if err != nil {
		return localDevState{}, err
	}
	if operation == localDevOpenDirectory {
		err = c.executor.OpenDirectory(c.devRoot)
	} else {
		err = c.executor.Run(ctx, root, operation)
	}
	if err != nil {
		return localDevState{}, err
	}
	state, stateErr := c.State()
	state.Message = fmt.Sprintf("Local Dev %s completed", operation)
	return state, stateErr
}

func parseLocalDevOperation(raw string) (localDevOperation, error) {
	operation := localDevOperation(raw)
	switch operation {
	case localDevBuild, localDevStart, localDevStop, localDevRestart, localDevOpenDirectory, localDevExit:
		return operation, nil
	default:
		return "", fmt.Errorf("unsupported local dev operation: %s", raw)
	}
}

func validateLocalDevSourceRoot(raw string) (string, error) {
	if raw == "" {
		return "", errors.New("local dev source directory is required")
	}
	root, err := filepath.Abs(raw)
	if err != nil {
		return "", fmt.Errorf("resolve local dev source directory: %w", err)
	}
	for _, required := range []string{"server/go.mod", "app/package.json", "scripts"} {
		if _, err := os.Stat(filepath.Join(root, required)); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return "", fmt.Errorf("local dev source is missing %s", required)
			}
			return "", fmt.Errorf("inspect local dev source %s: %w", required, err)
		}
	}
	return root, nil
}
