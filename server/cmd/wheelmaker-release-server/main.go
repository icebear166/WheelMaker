// Command wheelmaker-release-server receives authenticated release uploads.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/swm8023/wheelmaker/internal/releaseserver"
)

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "wheelmaker-release-server: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string, stdout io.Writer, stderr io.Writer) error {
	if len(args) == 0 {
		return errors.New("command is required: serve, validate-config, configure-token, or configure-public-url")
	}
	switch args[0] {
	case "serve":
		flags := flag.NewFlagSet("serve", flag.ContinueOnError)
		flags.SetOutput(stderr)
		configPath := flags.String("config", "", "release server config path")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *configPath == "" || flags.NArg() != 0 {
			return errors.New("serve requires exactly --config")
		}
		return serve(*configPath, stdout)
	case "validate-config":
		flags := flag.NewFlagSet("validate-config", flag.ContinueOnError)
		flags.SetOutput(stderr)
		configPath := flags.String("config", "", "release server config path")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *configPath == "" || flags.NArg() != 0 {
			return errors.New("validate-config requires exactly --config")
		}
		_, err := releaseserver.LoadConfig(*configPath)
		return err
	case "configure-token":
		flags := flag.NewFlagSet("configure-token", flag.ContinueOnError)
		flags.SetOutput(stderr)
		configPath := flags.String("config", "", "release server config path")
		digest := flags.String("sha256", "", "publisher token SHA-256 digest")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *configPath == "" || *digest == "" || flags.NArg() != 0 {
			return errors.New("configure-token requires exactly --config and --sha256")
		}
		return releaseserver.ConfigureTokenHash(*configPath, *digest)
	case "configure-public-url":
		flags := flag.NewFlagSet("configure-public-url", flag.ContinueOnError)
		flags.SetOutput(stderr)
		configPath := flags.String("config", "", "release server config path")
		publicURL := flags.String("public-url", "", "release server public URL")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if *configPath == "" || *publicURL == "" || flags.NArg() != 0 {
			return errors.New("configure-public-url requires exactly --config and --public-url")
		}
		return releaseserver.ConfigurePublicURL(*configPath, *publicURL)
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func serve(configPath string, stdout io.Writer) error {
	cfg, err := releaseserver.LoadConfig(configPath)
	if err != nil {
		return err
	}
	handler, err := releaseserver.New(cfg)
	if err != nil {
		return err
	}
	server := &http.Server{
		Addr:              cfg.Listen,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	handler.StartMaintenance(ctx)
	serveResult := make(chan error, 1)
	go func() {
		fmt.Fprintf(stdout, "listening on %s\n", cfg.Listen)
		serveResult <- server.ListenAndServe()
	}()

	select {
	case err := <-serveResult:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownContext); err != nil {
			return fmt.Errorf("shutdown release server: %w", err)
		}
		err := <-serveResult
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}
