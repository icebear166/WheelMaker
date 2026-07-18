package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"
)

func TestParseParentPIDAcceptsOnlyTheFixedFlagAndPositiveInteger(t *testing.T) {
	pid, err := parseParentPID([]string{"--parent-pid", "42"})
	if err != nil || pid != 42 {
		t.Fatalf("pid=%d error=%v", pid, err)
	}
	for _, args := range [][]string{
		nil,
		{"--parent-pid"},
		{"--pid", "42"},
		{"--parent-pid", "0"},
		{"--parent-pid", "-1"},
		{"--parent-pid", "abc"},
		{"--parent-pid", "42", "extra"},
	} {
		if _, err := parseParentPID(args); err == nil {
			t.Fatalf("parseParentPID(%v) succeeded", args)
		}
	}
}

func TestUpdaterPathsAndDeployCommandAreFixedUnderUserHome(t *testing.T) {
	home := t.TempDir()
	paths := resolveUpdaterPaths(home)
	wantRoot := filepath.Join(home, ".wheelmaker")
	if paths.root != wantRoot ||
		paths.deploy != filepath.Join(wantRoot, "deploy.mjs") ||
		paths.desktop != filepath.Join(wantRoot, "desktop", "WheelMakerDesktop.exe") {
		t.Fatalf("paths=%+v", paths)
	}

	node := filepath.Join(home, "node.exe")
	cmd := newDesktopDeployCommand(node, paths)
	wantArgs := []string{node, paths.deploy, "desktop-update"}
	if cmd.Dir != wantRoot || !reflect.DeepEqual(cmd.Args, wantArgs) {
		t.Fatalf("dir=%q args=%v wantDir=%q wantArgs=%v", cmd.Dir, cmd.Args, wantRoot, wantArgs)
	}
}

func TestRunUpdaterWaitsUpdatesAndRestarts(t *testing.T) {
	var events []string
	err := runUpdater(42, updaterDependencies{
		waitForParent: func(pid uint32) error {
			events = append(events, fmt.Sprintf("wait:%d", pid))
			return nil
		},
		runUpdate: func() error {
			events = append(events, "update")
			return nil
		},
		showError: func(error) {
			events = append(events, "message")
		},
		restart: func() error {
			events = append(events, "restart")
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"wait:42", "update", "restart"}
	if !reflect.DeepEqual(events, want) {
		t.Fatalf("events=%v want=%v", events, want)
	}
}

func TestRunUpdaterShowsFailureAndRestartsOldDesktop(t *testing.T) {
	updateErr := errors.New("download failed")
	var events []string
	err := runUpdater(42, updaterDependencies{
		waitForParent: func(uint32) error {
			events = append(events, "wait")
			return nil
		},
		runUpdate: func() error {
			events = append(events, "update")
			return updateErr
		},
		showError: func(err error) {
			events = append(events, "message:"+err.Error())
		},
		restart: func() error {
			events = append(events, "restart")
			return nil
		},
	})
	if !errors.Is(err, updateErr) {
		t.Fatalf("error=%v", err)
	}
	want := []string{"wait", "update", "message:download failed", "restart"}
	if !reflect.DeepEqual(events, want) {
		t.Fatalf("events=%v want=%v", events, want)
	}
}

func TestRunUpdaterRejectsZeroPID(t *testing.T) {
	if err := runUpdater(0, updaterDependencies{}); err == nil {
		t.Fatal("expected a parent PID error")
	}
}

func TestRunUpdaterStopsAndReportsWhenWaitFails(t *testing.T) {
	waitErr := errors.New("wait failed")
	var events []string
	err := runUpdater(42, updaterDependencies{
		waitForParent: func(uint32) error { return waitErr },
		runUpdate: func() error {
			events = append(events, "update")
			return nil
		},
		showError: func(err error) {
			events = append(events, "message:"+err.Error())
		},
		restart: func() error {
			events = append(events, "restart")
			return nil
		},
	})
	if !errors.Is(err, waitErr) {
		t.Fatalf("error=%v", err)
	}
	want := []string{"message:wait for Desktop: wait failed"}
	if !reflect.DeepEqual(events, want) {
		t.Fatalf("events=%v want=%v", events, want)
	}
}

func TestRunUpdaterReportsRestartFailure(t *testing.T) {
	restartErr := errors.New("restart failed")
	var events []string
	err := runUpdater(42, updaterDependencies{
		waitForParent: func(uint32) error { return nil },
		runUpdate:     func() error { return nil },
		showError: func(err error) {
			events = append(events, "message:"+err.Error())
		},
		restart: func() error {
			events = append(events, "restart")
			return restartErr
		},
	})
	if !errors.Is(err, restartErr) {
		t.Fatalf("error=%v", err)
	}
	want := []string{"restart", "message:restart failed"}
	if !reflect.DeepEqual(events, want) {
		t.Fatalf("events=%v want=%v", events, want)
	}
}
