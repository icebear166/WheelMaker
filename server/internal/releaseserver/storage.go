package releaseserver

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
)

type storageResponse struct {
	TotalBytes       int64 `json:"totalBytes"`
	ReclaimableBytes int64 `json:"reclaimableBytes"`
	OrphanCount      int   `json:"orphanCount"`
}

type releaseVersionDir struct {
	version string
	size    int64
}

// referencedVersions returns every version that must keep its directory:
// the stable version and the versions pointed to by stable Desktop/Android
// pointers. History entries alone do not protect a version.
func (s *Server) referencedVersions() (map[string]bool, *stableDocument, error) {
	stable, err := s.readStable()
	if err != nil {
		return nil, nil, err
	}
	referenced := map[string]bool{}
	if stable != nil {
		referenced[stable.Version] = true
		if stable.Desktop != nil {
			referenced[stable.Desktop.Version] = true
		}
		if stable.Android != nil {
			referenced[stable.Android.Version] = true
		}
	}
	return referenced, stable, nil
}

func releaseDirectorySize(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(_ string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type().IsRegular() {
			info, infoErr := entry.Info()
			if infoErr != nil {
				return infoErr
			}
			total += info.Size()
		}
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	return total, err
}

func (s *Server) listReleaseVersionDirs() ([]releaseVersionDir, error) {
	root := filepath.Join(s.config.DataRoot, "public", "releases")
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var dirs []releaseVersionDir
	for _, entry := range entries {
		if !entry.IsDir() || !versionPattern.MatchString(entry.Name()) {
			continue
		}
		size, err := releaseDirectorySize(filepath.Join(root, entry.Name()))
		if err != nil {
			return nil, err
		}
		dirs = append(dirs, releaseVersionDir{version: entry.Name(), size: size})
	}
	return dirs, nil
}

func (s *Server) handleStorage(w http.ResponseWriter, _ *http.Request) {
	s.commitMu.Lock()
	defer s.commitMu.Unlock()
	referenced, _, err := s.referencedVersions()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_metadata_invalid")
		return
	}
	dirs, err := s.listReleaseVersionDirs()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_scan_failed")
		return
	}
	response := storageResponse{}
	for _, dir := range dirs {
		response.TotalBytes += dir.size
		if !referenced[dir.version] {
			response.ReclaimableBytes += dir.size
			response.OrphanCount++
		}
	}
	writeJSON(w, http.StatusOK, response)
}

type pruneResponse struct {
	OK           bool `json:"ok"`
	RemovedCount int  `json:"removedCount"`
}

func (s *Server) handlePrune(w http.ResponseWriter, _ *http.Request) {
	s.commitMu.Lock()
	defer s.commitMu.Unlock()
	referenced, stable, err := s.referencedVersions()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_metadata_invalid")
		return
	}
	if stable == nil {
		writeError(w, http.StatusConflict, "stable_missing")
		return
	}
	history, err := s.readHistory()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_metadata_invalid")
		return
	}
	dirs, err := s.listReleaseVersionDirs()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "storage_scan_failed")
		return
	}
	// Trim the history before deleting directories: if anything fails after
	// this point, leftover directories simply become unreferenced orphans that
	// a later prune removes, instead of history pointing at missing files.
	kept := make([]releaseHistoryEntry, 0, len(history.Releases))
	for _, entry := range history.Releases {
		if referenced[entry.Version] {
			kept = append(kept, entry)
		}
	}
	if len(kept) != len(history.Releases) {
		history.Releases = kept
		if err := s.writeJSON(filepath.Join(s.config.DataRoot, "public", "releases.json"), history, 0o640); err != nil {
			writeError(w, http.StatusInternalServerError, "prune_failed")
			return
		}
	}
	removed := 0
	for _, dir := range dirs {
		if referenced[dir.version] {
			continue
		}
		if err := os.RemoveAll(filepath.Join(s.config.DataRoot, "public", "releases", dir.version)); err != nil {
			writeError(w, http.StatusInternalServerError, "prune_failed")
			return
		}
		removed++
	}
	writeJSON(w, http.StatusOK, pruneResponse{OK: true, RemovedCount: removed})
}
