package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/swm8023/WheelMaker/personal-wiki-kit/server/internal/wiki"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "wiki-server: %v\n", err)
		os.Exit(1)
	}
}

func run(arguments []string) error {
	if len(arguments) == 0 {
		return errors.New("expected serve, hash-password, or verify-root command")
	}
	switch arguments[0] {
	case "serve":
		return serve(arguments[1:])
	case "hash-password":
		return hashPassword()
	case "verify-root":
		return verifyRoot(arguments[1:])
	default:
		return fmt.Errorf("unknown command %q", arguments[0])
	}
}

func serve(arguments []string) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	mode := flags.String("mode", "online", "server mode: local or online")
	listen := flags.String("listen", "127.0.0.1:0", "loopback listen address")
	root := flags.String("root", "", "absolute verified site root")
	hashFile := flags.String("password-hash-file", "", "Argon2id password hash file for online mode")
	sessionTTL := flags.Duration("session-ttl", 12*time.Hour, "absolute login session lifetime")
	secureCookie := flags.Bool("secure-cookie", true, "require HTTPS when sending the session cookie")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if *root == "" {
		return errors.New("serve requires --root")
	}
	if err := wiki.ValidateListenAddress(*listen); err != nil {
		return err
	}
	if *mode != "local" && *mode != "online" {
		return errors.New("mode must be local or online")
	}
	var hash string
	if *mode == "online" {
		if *hashFile == "" {
			return errors.New("online mode requires --password-hash-file")
		}
		var err error
		hash, err = readPasswordHash(*hashFile)
		if err != nil {
			return err
		}
	}
	server, err := wiki.NewServer(wiki.ServerConfig{
		Root:            filepath.Clean(*root),
		PasswordHash:    hash,
		SessionTTL:      *sessionTTL,
		MaximumAttempts: 5,
		AttemptWindow:   15 * time.Minute,
		SecureCookie:    *secureCookie,
		LocalNoAuth:     *mode == "local",
	})
	if err != nil {
		return err
	}
	httpServer := &http.Server{
		Addr:              *listen,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       90 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}
	contextWithSignals, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	result := make(chan error, 1)
	go func() {
		log.Printf("personal wiki listening on %s", *listen)
		result <- httpServer.ListenAndServe()
	}()
	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-contextWithSignals.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdownContext)
	}
}

func hashPassword() error {
	reader := bufio.NewReaderSize(os.Stdin, 2048)
	value, err := reader.ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("read password from standard input: %w", err)
	}
	value = strings.TrimRight(value, "\r\n")
	if len(value) > 1024 {
		return errors.New("password exceeds 1024 characters")
	}
	encoded, err := wiki.HashPassword(value)
	if err != nil {
		return err
	}
	fmt.Println(encoded)
	return nil
}

func verifyRoot(arguments []string) error {
	flags := flag.NewFlagSet("verify-root", flag.ContinueOnError)
	root := flags.String("root", "", "absolute candidate site root")
	if err := flags.Parse(arguments); err != nil {
		return err
	}
	if *root == "" {
		return errors.New("verify-root requires --root")
	}
	return wiki.VerifyRoot(filepath.Clean(*root))
}

func readPasswordHash(filename string) (string, error) {
	info, err := os.Stat(filename)
	if err != nil {
		return "", fmt.Errorf("stat password hash file: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() > 2048 {
		return "", errors.New("password hash file must be a small regular file")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return "", errors.New("password hash file must not be accessible by group or others")
	}
	value, err := os.ReadFile(filename)
	if err != nil {
		return "", fmt.Errorf("read password hash file: %w", err)
	}
	return strings.TrimSpace(string(value)), nil
}
