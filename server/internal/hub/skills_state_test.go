package hub

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/swm8023/wheelmaker/internal/hub/tools"
)

func TestCloneSkillsSourceScopeSnapshotPreservesEmptyJSONArrays(t *testing.T) {
	snapshot := tools.SkillsSourceScopeSnapshot{
		Sources: []tools.SkillsSourceCatalogSnapshot{{
			Source:    "https://github.com/acme/skills.git",
			SourceKey: "github.com/acme/skills",
			Status:    "stale",
			Skills:    []tools.SkillsSourceCatalogSkillSnapshot{},
		}},
		UnmanagedSkills: []tools.SkillsSourceCatalogSkillSnapshot{},
	}

	raw, err := json.Marshal(cloneSkillsSourceScopeSnapshot(snapshot))
	if err != nil {
		t.Fatalf("marshal cloned skill source snapshot: %v", err)
	}
	if bytes.Contains(raw, []byte(`"skills":null`)) {
		t.Fatalf("cloned source skills encoded as null: %s", raw)
	}
	if bytes.Contains(raw, []byte(`"unmanagedSkills":null`)) {
		t.Fatalf("cloned unmanaged skills encoded as null: %s", raw)
	}
}
