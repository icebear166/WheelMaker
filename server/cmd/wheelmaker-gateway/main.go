// Command wheelmaker-gateway embeds Caddy and serves the configured Registry,
// Release, and Share routes.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

	"github.com/swm8023/wheelmaker/internal/gateway"
)

var version = "dev"

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "wheelmaker-gateway: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string, stdout, stderr io.Writer) error {
	if len(args) == 0 {
		return errors.New("command is required: serve, validate, render, paths, or version")
	}
	switch args[0] {
	case "version":
		if len(args) != 1 {
			return errors.New("version does not accept arguments")
		}
		_, err := fmt.Fprintf(stdout, "wheelmaker-gateway %s (%s/%s)\n", version, runtime.GOOS, runtime.GOARCH)
		return err
	case "paths":
		flags := flag.NewFlagSet("paths", flag.ContinueOnError)
		flags.SetOutput(stderr)
		home := flags.String("home", "", "absolute Gateway home")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *home == "" || flags.NArg() != 0 {
			return errors.New("paths requires exactly --home")
		}
		if !filepath.IsAbs(*home) {
			return errors.New("--home must be an absolute path")
		}
		return printPaths(*home, stdout)
	case "validate":
		flags := flag.NewFlagSet("validate", flag.ContinueOnError)
		flags.SetOutput(stderr)
		home := flags.String("home", "", "absolute Gateway home")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *home == "" || flags.NArg() != 0 {
			return errors.New("validate requires exactly --home")
		}
		_, err := loadCandidate(*home, false, stderr)
		if err != nil {
			return err
		}
		_, err = fmt.Fprintln(stdout, "valid")
		return err
	case "render":
		flags := flag.NewFlagSet("render", flag.ContinueOnError)
		flags.SetOutput(stderr)
		home := flags.String("home", "", "absolute Gateway home")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *home == "" || flags.NArg() != 0 {
			return errors.New("render requires exactly --home")
		}
		paths := gateway.ResolvePaths(*home)
		bundle, err := loadCandidate(*home, true, stderr)
		if err != nil {
			return err
		}
		if err := gateway.WriteGenerated(paths.GeneratedConfig, bundle.JSON); err != nil {
			return err
		}
		_, err = fmt.Fprintln(stdout, paths.GeneratedConfig)
		return err
	case "serve":
		flags := flag.NewFlagSet("serve", flag.ContinueOnError)
		flags.SetOutput(stderr)
		home := flags.String("home", "", "absolute Gateway home")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *home == "" || flags.NArg() != 0 {
			return errors.New("serve requires exactly --home")
		}
		return serve(*home, stdout, stderr)
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func printPaths(home string, stdout io.Writer) error {
	paths := gateway.ResolvePaths(home)
	return json.NewEncoder(stdout).Encode(map[string]string{
		"home":            paths.Home,
		"configFile":      paths.ConfigFile,
		"registryWebRoot": paths.RegistryWebRoot,
		"releaseDataRoot": paths.ReleaseDataRoot,
		"sharePublicRoot": paths.SharePublicRoot,
		"customSitesRoot": paths.CustomSitesRoot,
		"generatedConfig": paths.GeneratedConfig,
		"stateRelease":    paths.StateRelease,
		"dataDir":         paths.DataDir,
		"logsDir":         paths.LogsDir,
		"downloadsDir":    paths.DownloadsDir,
		"rollbackDir":     paths.RollbackDir,
	})
}

func serve(home string, stdout, stderr io.Writer) error {
	bundle, err := loadCandidate(home, true, stderr)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(stdout, "serving Gateway from %s\n", home); err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return gateway.RunManaged(ctx, home, bundle)
}

func loadCandidate(home string, initialize bool, stderr io.Writer) (gateway.ConfigBundle, error) {
	if initialize {
		if err := gateway.EnsureHome(home); err != nil {
			return gateway.ConfigBundle{}, err
		}
		if err := ensureGlobalConfig(gateway.ResolvePaths(home).ConfigFile); err != nil {
			return gateway.ConfigBundle{}, err
		}
	}
	bundle, err := gateway.LoadBundle(home)
	if err != nil {
		return gateway.ConfigBundle{}, err
	}
	for _, warning := range bundle.Warnings {
		if _, err := fmt.Fprintf(stderr, "warning: %s\n", warning.String()); err != nil {
			return gateway.ConfigBundle{}, err
		}
	}
	return bundle, nil
}

func ensureGlobalConfig(path string) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("create Gateway config %s: %w", path, err)
	}
	defer file.Close()
	config := gateway.DefaultGlobalConfig(filepath.Dir(path))
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("encode default Gateway config: %w", err)
	}
	if _, err := file.Write(append(data, '\n')); err != nil {
		return fmt.Errorf("write default Gateway config: %w", err)
	}
	return nil
}
