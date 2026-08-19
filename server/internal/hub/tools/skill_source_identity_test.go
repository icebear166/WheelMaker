package tools

import (
	"fmt"
	"strings"
	"testing"
)

func TestNativeSkillSourceKeepsWellKnownEntryUnresolvedUntilDiscovery(t *testing.T) {
	input := "https://open.feishu.cn/.well-known/skills/lark-approval/SKILL.md"
	source, sourceKey, cmdErr := normalizeNativeSkillSource(input)
	if cmdErr != nil {
		t.Fatalf("normalizeNativeSkillSource() error=%v", cmdErr)
	}
	if source != input {
		t.Fatalf("source=%q, want %q", source, input)
	}
	if sourceKey != "" {
		t.Fatalf("sourceKey=%q, want unresolved identity", sourceKey)
	}
}

func TestNativeSkillSourceNormalizesCanonicalWellKnownIndexIdentity(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantSource string
		wantKey    string
	}{
		{
			name:       "legacy root index",
			input:      "https://EXAMPLE.com/.well-known/skills/index.json",
			wantSource: "https://example.com/.well-known/skills/index.json",
			wantKey:    "https://example.com/.well-known/skills/index.json",
		},
		{
			name:       "path relative agent skills index with port",
			input:      "http://EXAMPLE.com:8080/docs/.well-known/agent-skills/index.json",
			wantSource: "http://example.com:8080/docs/.well-known/agent-skills/index.json",
			wantKey:    "http://example.com:8080/docs/.well-known/agent-skills/index.json",
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			source, sourceKey, cmdErr := normalizeNativeSkillSource(testCase.input)
			if cmdErr != nil {
				t.Fatalf("normalizeNativeSkillSource() error=%v", cmdErr)
			}
			if source != testCase.wantSource || sourceKey != testCase.wantKey {
				t.Fatalf("normalizeNativeSkillSource()=(%q, %q), want (%q, %q)", source, sourceKey, testCase.wantSource, testCase.wantKey)
			}
		})
	}
}

func TestNativeSkillSourceWellKnownIdentityIncludesSchemePortPathAndVariant(t *testing.T) {
	inputs := []string{
		"http://example.com/.well-known/skills/index.json",
		"https://example.com/.well-known/skills/index.json",
		"https://example.com:8443/.well-known/skills/index.json",
		"https://example.com/docs/.well-known/skills/index.json",
		"https://example.com/.well-known/agent-skills/index.json",
	}
	seen := map[string]string{}
	for _, input := range inputs {
		_, sourceKey, cmdErr := normalizeNativeSkillSource(input)
		if cmdErr != nil {
			t.Fatalf("normalizeNativeSkillSource(%q) error=%v", input, cmdErr)
		}
		if previous, exists := seen[sourceKey]; exists {
			t.Fatalf("inputs %q and %q share sourceKey %q", previous, input, sourceKey)
		}
		seen[sourceKey] = input
	}
}

func TestNativeSkillSourceClassifiesOnlyExplicitHTTPGitRepositoriesAsGit(t *testing.T) {
	gitCases := map[string]string{
		"owner/repo":                              "https://github.com/owner/repo.git",
		"https://github.com/owner/repo":           "https://github.com/owner/repo.git",
		"https://gitlab.com/owner/repo":           "https://gitlab.com/owner/repo.git",
		"https://code.example.com/owner/repo.git": "https://code.example.com/owner/repo.git",
		"git@github.com:owner/repo.git":           "git@github.com:owner/repo.git",
	}
	for input, wantSource := range gitCases {
		t.Run(input, func(t *testing.T) {
			source, sourceKey, cmdErr := normalizeNativeSkillSource(input)
			if cmdErr != nil {
				t.Fatalf("normalizeNativeSkillSource() error=%v", cmdErr)
			}
			if source != wantSource || sourceKey == "" || strings.HasPrefix(sourceKey, "http://") || strings.HasPrefix(sourceKey, "https://") {
				t.Fatalf("normalizeNativeSkillSource()=(%q, %q), want Git source %q", source, sourceKey, wantSource)
			}
		})
	}

	input := "https://code.example.com/owner/repo"
	source, sourceKey, cmdErr := normalizeNativeSkillSource(input)
	if cmdErr != nil {
		t.Fatalf("normalizeNativeSkillSource() error=%v", cmdErr)
	}
	if source != input || sourceKey != "" {
		t.Fatalf("normalizeNativeSkillSource()=(%q, %q), want unresolved well-known input", source, sourceKey)
	}
}

func TestNativeSkillSourceRejectsUnsupportedOrSecretWellKnownInputs(t *testing.T) {
	for _, input := range []string{
		"https://raw.githubusercontent.com/owner/repo/main/SKILL.md",
		"https://token@example.com/.well-known/skills/index.json",
		"https://example.com/.well-known/skills/index.json?token=secret",
		"https://example.com/.well-known/skills/index.json#fragment",
	} {
		t.Run(input, func(t *testing.T) {
			if _, _, cmdErr := normalizeNativeSkillSource(input); cmdErr == nil {
				t.Fatalf("normalizeNativeSkillSource(%q) succeeded, want rejection", input)
			}
		})
	}
}

func TestSkillSourceLockAcceptsCanonicalWellKnownIdentityOffline(t *testing.T) {
	source := "https://example.com/.well-known/skills/index.json"
	raw := []byte(fmt.Sprintf(`{"version":3,"sources":[{"source":%q,"sourceKey":%q,"branch":"","commit":%q,"updatedAt":"2026-08-19T12:00:00Z","managedSkills":[]}]}`,
		source, source, strings.Repeat("a", 64)))
	lock, err := decodeSkillSourceLock(raw)
	if err != nil {
		t.Fatalf("decodeSkillSourceLock() error=%v", err)
	}
	if len(lock.Sources) != 1 || lock.Sources[0].Source != source || lock.Sources[0].SourceKey != source {
		t.Fatalf("decoded source=%#v, want canonical well-known source", lock.Sources)
	}
}

func TestSkillSourceLockKeepsCaseSensitiveWellKnownIdentitiesDistinct(t *testing.T) {
	upper := "https://example.com/Docs/.well-known/skills/index.json"
	lower := "https://example.com/docs/.well-known/skills/index.json"
	lock := skillSourceLock{
		Version: skillSourceLockVersion,
		Sources: []skillSourceSnapshot{
			{Source: upper, SourceKey: upper, ManagedSkills: []string{}},
			{Source: lower, SourceKey: lower, ManagedSkills: []string{}},
		},
	}

	if err := validateSkillSourceLock(lock); err != nil {
		t.Fatalf("validateSkillSourceLock() error=%v, want distinct well-known identities", err)
	}
	if got := nativeSourceIndex(lock, lower); got != 1 {
		t.Fatalf("nativeSourceIndex(lower)=%d, want 1", got)
	}
}
