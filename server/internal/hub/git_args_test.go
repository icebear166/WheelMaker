package hub

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGitRevisionValidation(t *testing.T) {
	for _, testCase := range []struct {
		name  string
		value string
		want  string
		valid bool
	}{
		{name: "head", value: "HEAD", want: "HEAD", valid: true},
		{name: "sha", value: strings.Repeat("a", 40), want: strings.Repeat("a", 40), valid: true},
		{name: "remote", value: "origin/main", want: "origin/main", valid: true},
		{name: "tag", value: "v1.0.0", want: "v1.0.0", valid: true},
		{name: "trim", value: "  HEAD  ", want: "HEAD", valid: true},
		{name: "empty"},
		{name: "spaces", value: "   "},
		{name: "option", value: "--help"},
		{name: "config option", value: "-cprotocol.file.allow=always"},
		{name: "nul", value: "HEAD\x00evil"},
		{name: "carriage return", value: "HEAD\revil"},
		{name: "line feed", value: "HEAD\nevil"},
		{name: "too long", value: strings.Repeat("a", maxGitRevisionBytes+1)},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			got, err := validateGitRevision(testCase.value)
			if testCase.valid {
				if err != nil || got != testCase.want {
					t.Fatalf("validateGitRevision(%q)=(%q, %v), want %q", testCase.value, got, err, testCase.want)
				}
				return
			}
			if !errors.Is(err, errInvalidGitRevision) {
				t.Fatalf("validateGitRevision(%q) err=%v", testCase.value, err)
			}
		})
	}
}

func TestGitRevisionArgumentsTerminateOptions(t *testing.T) {
	args, err := gitRevisionArgs(" HEAD ", "origin/main")
	if err != nil {
		t.Fatalf("gitRevisionArgs(): %v", err)
	}
	want := []string{"--end-of-options", "HEAD", "origin/main"}
	if strings.Join(args, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("gitRevisionArgs()=%q, want %q", args, want)
	}

	rangeArg, err := gitRevisionRangeArg(" main ", " feature ")
	if err != nil {
		t.Fatalf("gitRevisionRangeArg(): %v", err)
	}
	if rangeArg != "main..feature" {
		t.Fatalf("gitRevisionRangeArg()=%q", rangeArg)
	}
}

func TestReporterGitRevisionOptionsHaveNoSideEffects(t *testing.T) {
	root := t.TempDir()
	initGitRepo(t, root)
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("content\n"), 0o644); err != nil {
		t.Fatalf("write tracked file: %v", err)
	}
	runGitCmd(t, root, "add", "tracked.txt")
	runGitCmd(t, root, "commit", "-m", "initial")

	outputPath := filepath.Join(root, "injected-output.txt")
	for _, malicious := range []string{"--output=" + outputPath, "--help", "-cprotocol.file.allow=always"} {
		if _, err := gitRevisionArgs(malicious); !errors.Is(err, errInvalidGitRevision) {
			t.Fatalf("gitRevisionArgs(%q) err=%v", malicious, err)
		}
	}
	if _, err := os.Stat(outputPath); !os.IsNotExist(err) {
		t.Fatalf("malicious revision created %s: %v", outputPath, err)
	}
}

func TestReporterGitValidRevisionsRemainUsable(t *testing.T) {
	root := t.TempDir()
	initGitRepo(t, root)
	if err := os.WriteFile(filepath.Join(root, "tracked.txt"), []byte("content\n"), 0o644); err != nil {
		t.Fatalf("write tracked file: %v", err)
	}
	runGitCmd(t, root, "add", "tracked.txt")
	runGitCmd(t, root, "commit", "-m", "initial")
	runGitCmd(t, root, "tag", "v1.0.0")
	runGitCmd(t, root, "update-ref", "refs/remotes/origin/main", "HEAD")
	shaRaw, err := runGit(root, "rev-parse", "HEAD")
	if err != nil {
		t.Fatalf("git rev-parse HEAD: %v", err)
	}
	sha := strings.TrimSpace(shaRaw)

	for _, revision := range []string{"HEAD", sha, "origin/main", "v1.0.0"} {
		args, err := gitRevisionArgs(revision)
		if err != nil {
			t.Fatalf("gitRevisionArgs(%q): %v", revision, err)
		}
		if _, err := runGit(root, append([]string{"rev-parse"}, args...)...); err != nil {
			t.Fatalf("git rev-parse %q: %v", revision, err)
		}
	}
	rangeArg, err := gitRevisionRangeArg("HEAD", "origin/main")
	if err != nil {
		t.Fatalf("gitRevisionRangeArg(): %v", err)
	}
	args, err := gitRevisionArgs(rangeArg)
	if err != nil {
		t.Fatalf("gitRevisionArgs(range): %v", err)
	}
	if _, err := runGit(root, append([]string{"log", "--oneline"}, args...)...); err != nil {
		t.Fatalf("git log range: %v", err)
	}
}
