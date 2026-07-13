//go:build windows

package shared

import (
	"os"
	"path/filepath"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestSecureConfigFileRestrictsWindowsDACL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte("{}"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}
	if err := SecureConfigFile(path); err != nil {
		t.Fatalf("SecureConfigFile(): %v", err)
	}

	descriptor, err := windows.GetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION,
	)
	if err != nil {
		t.Fatalf("GetNamedSecurityInfo(): %v", err)
	}
	control, _, err := descriptor.Control()
	if err != nil {
		t.Fatalf("descriptor.Control(): %v", err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		t.Fatal("config DACL inherits permissions")
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		t.Fatalf("descriptor.DACL(): %v", err)
	}
	if dacl == nil || dacl.AceCount != 2 {
		t.Fatalf("DACL ACE count=%v, want current user and SYSTEM only", dacl)
	}

	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatalf("GetTokenUser(): %v", err)
	}
	systemSID, err := windows.StringToSid("S-1-5-18")
	if err != nil {
		t.Fatalf("StringToSid(SYSTEM): %v", err)
	}
	want := []*windows.SID{user.User.Sid, systemSID}
	for index := uint32(0); index < uint32(dacl.AceCount); index++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if err := windows.GetAce(dacl, index, &ace); err != nil {
			t.Fatalf("GetAce(%d): %v", index, err)
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		matched := false
		for expectedIndex, expectedSID := range want {
			if expectedSID != nil && sid.Equals(expectedSID) {
				want[expectedIndex] = nil
				matched = true
				break
			}
		}
		if !matched {
			t.Fatalf("DACL contains unexpected SID %s", sid.String())
		}
	}
}
