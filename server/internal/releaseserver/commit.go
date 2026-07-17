package releaseserver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"time"
)

var errVersionConflict = errors.New("release version conflicts with stable")
var errInvalidTransaction = errors.New("release transaction is invalid")
var errInsufficientStorage = errors.New("release server has insufficient storage")

type validatedTransaction struct {
	manifest releaseManifest
	android  *androidReleaseManifest
}

func (s *Server) handleCommit(w http.ResponseWriter, sessionID string) {
	lock := s.sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	session, err := s.loadSession(sessionID)
	if errors.Is(err, os.ErrNotExist) {
		writeError(w, http.StatusNotFound, "session_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "session_read_failed")
		return
	}
	stable, err := s.commitSession(session)
	if err != nil {
		switch {
		case errors.Is(err, errVersionConflict):
			writeError(w, http.StatusConflict, "version_conflict")
		case errors.Is(err, errInvalidTransaction):
			writeError(w, http.StatusUnprocessableEntity, "invalid_transaction")
		case errors.Is(err, errInsufficientStorage):
			writeError(w, http.StatusInsufficientStorage, "insufficient_storage")
		default:
			writeError(w, http.StatusInternalServerError, "commit_failed")
		}
		return
	}
	s.removeSessionLock(sessionID, lock)
	writeJSON(w, http.StatusOK, stable)
}

func (s *Server) commitSession(session publishSession) (stableDocument, error) {
	validated, err := s.validateTransaction(session)
	if err != nil {
		return stableDocument{}, fmt.Errorf("%w: %v", errInvalidTransaction, err)
	}
	freeBytes, err := s.diskFree(s.config.DataRoot)
	if err != nil {
		return stableDocument{}, fmt.Errorf("check release storage: %w", err)
	}
	if freeBytes < 1<<30+uint64(maxControlFileSize*4) {
		return stableDocument{}, errInsufficientStorage
	}

	s.commitMu.Lock()
	defer s.commitMu.Unlock()
	previous, err := s.readStable()
	if err != nil {
		return stableDocument{}, fmt.Errorf("read stable: %w", err)
	}
	if !isNextReleaseVersion(previous, session.Version) {
		return stableDocument{}, errVersionConflict
	}
	history, err := s.readHistory()
	if err != nil {
		return stableDocument{}, fmt.Errorf("read release history: %w", err)
	}
	for _, entry := range history.Releases {
		if entry.Version == session.Version {
			return stableDocument{}, errVersionConflict
		}
	}
	stable := buildStableDocument(previous, session, validated)
	history.Releases = append(history.Releases, historyEntry(session))

	filesDirectory := filepath.Join(s.config.DataRoot, "staging", session.SessionID, "files")
	releasesRoot := filepath.Join(s.config.DataRoot, "public", "releases")
	if err := os.MkdirAll(releasesRoot, 0o750); err != nil {
		return stableDocument{}, err
	}
	versionDirectory := filepath.Join(releasesRoot, session.Version)
	if _, err := os.Stat(versionDirectory); err == nil {
		return stableDocument{}, errVersionConflict
	} else if !errors.Is(err, os.ErrNotExist) {
		return stableDocument{}, err
	}
	if err := makePublicTree(filesDirectory); err != nil {
		return stableDocument{}, err
	}
	session.UpdatedAt = s.now().UTC().Format(time.RFC3339)
	if err := s.writePublicStatus(session.SessionID, publishStatusForSession(session, "running", "updating-stable", "")); err != nil {
		return stableDocument{}, err
	}
	if err := os.Rename(filesDirectory, versionDirectory); err != nil {
		return stableDocument{}, fmt.Errorf("publish version directory: %w", err)
	}
	rollback := func() {
		if err := os.Rename(versionDirectory, filesDirectory); err != nil {
			log.Printf("release server: restore failed transaction version=%s: %v", session.Version, err)
		}
	}
	stablePath := filepath.Join(s.config.DataRoot, "public", "stable.json")
	if err := s.writeJSON(stablePath, stable, 0o640); err != nil {
		rollback()
		return stableDocument{}, fmt.Errorf("write stable: %w", err)
	}

	derivedErrors := make([]error, 0, 4)
	for _, name := range []string{"deploy.mjs", "deploy-core.mjs"} {
		if err := copyFileAtomic(filepath.Join(versionDirectory, name), filepath.Join(s.config.DataRoot, "public", name), 0o640); err != nil {
			derivedErrors = append(derivedErrors, err)
		}
	}
	if err := s.writeJSON(filepath.Join(s.config.DataRoot, "public", "releases.json"), history, 0o640); err != nil {
		derivedErrors = append(derivedErrors, err)
	}
	if err := s.writePublicStatus(session.SessionID, publishStatusForSession(session, "succeeded", "updating-stable", "")); err != nil {
		derivedErrors = append(derivedErrors, err)
	}
	if err := os.RemoveAll(filepath.Join(s.config.DataRoot, "staging", session.SessionID)); err != nil {
		derivedErrors = append(derivedErrors, err)
	}
	for _, derivedErr := range derivedErrors {
		log.Printf("release server: repairable post-stable error version=%s: %v", session.Version, derivedErr)
	}
	return stable, nil
}

func (s *Server) validateTransaction(session publishSession) (validatedTransaction, error) {
	if len(session.Files) != len(session.AllowedFiles) {
		return validatedTransaction{}, errors.New("uploaded file set is incomplete")
	}
	filesDirectory := filepath.Join(s.config.DataRoot, "staging", session.SessionID, "files")
	for name := range session.AllowedFiles {
		declared, ok := session.Files[name]
		if !ok || declared.Size <= 0 || !validLowerHex(declared.SHA256, sha256.Size) {
			return validatedTransaction{}, fmt.Errorf("invalid file record %s", name)
		}
		actual, err := inspectFile(filepath.Join(filesDirectory, name))
		if err != nil {
			return validatedTransaction{}, err
		}
		if actual != declared {
			return validatedTransaction{}, fmt.Errorf("file identity mismatch %s", name)
		}
	}

	manifestRaw, err := os.ReadFile(filepath.Join(filesDirectory, "release-manifest.json"))
	if err != nil {
		return validatedTransaction{}, err
	}
	var manifest releaseManifest
	if err := decodeStrictJSON(bytesReader(manifestRaw), maxControlFileSize, &manifest); err != nil {
		return validatedTransaction{}, errors.New("release manifest is invalid")
	}
	if manifest.Schema != 2 || manifest.Version != session.Version || manifest.PublishedAt != session.PublishedAt || manifest.SourceSHA != session.SourceSHA || len(manifest.Artifacts) != 3 {
		return validatedTransaction{}, errors.New("release manifest identity does not match session")
	}
	for _, platform := range []string{"windows-amd64", "linux-amd64", "darwin-arm64"} {
		name := "wheelmaker-" + session.Version + "-" + platform + ".tar.gz"
		want := session.Files[name]
		got, ok := manifest.Artifacts[platform]
		if !ok || got.Path != releasePath(session.Version, name) || got.SHA256 != want.SHA256 || got.Size != want.Size {
			return validatedTransaction{}, fmt.Errorf("manifest artifact mismatch %s", platform)
		}
	}

	validated := validatedTransaction{manifest: manifest}
	if session.WithAndroid {
		raw, err := os.ReadFile(filepath.Join(filesDirectory, "android-release.json"))
		if err != nil {
			return validatedTransaction{}, err
		}
		var android androidReleaseManifest
		if err := json.Unmarshal(raw, &android); err != nil {
			return validatedTransaction{}, errors.New("Android manifest is invalid")
		}
		apk := session.Files["WheelMakerAndroid.apk"]
		versionCode, _ := releaseVersionNumber(session.Version)
		if android.Schema != 1 || android.Platform != "android" || android.Version != session.Version || android.VersionName != session.Version[1:] || android.VersionCode != versionCode || android.SourceSHA != session.SourceSHA || android.APK.FileName != "WheelMakerAndroid.apk" || android.APK.SHA256 != apk.SHA256 || android.APK.Size != apk.Size || len(android.Signing.CertificateSHA256) == 0 {
			return validatedTransaction{}, errors.New("Android manifest identity does not match session")
		}
		for _, digest := range android.Signing.CertificateSHA256 {
			if !validLowerHex(digest, sha256.Size) {
				return validatedTransaction{}, errors.New("Android signing digest is invalid")
			}
		}
		validated.android = &android
	}
	return validated, nil
}

func buildStableDocument(previous *stableDocument, session publishSession, validated validatedTransaction) stableDocument {
	stable := stableDocument{
		Schema:      2,
		Version:     session.Version,
		PublishedAt: session.PublishedAt,
		SourceSHA:   session.SourceSHA,
		Deploy: deployPointer{
			MJSPath:    releasePath(session.Version, "deploy.mjs"),
			MJSSHA256:  session.Files["deploy.mjs"].SHA256,
			CorePath:   releasePath(session.Version, "deploy-core.mjs"),
			CoreSHA256: session.Files["deploy-core.mjs"].SHA256,
		},
		Release: manifestPointer{
			ManifestPath:   releasePath(session.Version, "release-manifest.json"),
			ManifestSHA256: session.Files["release-manifest.json"].SHA256,
		},
	}
	if previous != nil {
		stable.Desktop = previous.Desktop
		stable.Android = previous.Android
	}
	if session.WithDesktop {
		stable.Desktop = &desktopPointer{
			Version: session.Version,
			Path:    releasePath(session.Version, "WheelMakerDesktop.exe"),
			SHA256:  session.Files["WheelMakerDesktop.exe"].SHA256,
		}
	}
	if session.WithAndroid && validated.android != nil {
		android := validated.android
		stable.Android = &androidPointer{
			Version:     session.Version,
			VersionName: android.VersionName,
			VersionCode: android.VersionCode,
			PublishedAt: session.PublishedAt,
			SourceSHA:   session.SourceSHA,
			Path:        releasePath(session.Version, "WheelMakerAndroid.apk"),
			SHA256:      session.Files["WheelMakerAndroid.apk"].SHA256,
			Size:        session.Files["WheelMakerAndroid.apk"].Size,
		}
	}
	return stable
}

func historyEntry(session publishSession) releaseHistoryEntry {
	assets := make([]releaseAsset, 0, len(session.Files))
	for name, file := range session.Files {
		assets = append(assets, releaseAsset{
			Name:   name,
			Path:   releasePath(session.Version, name),
			Size:   file.Size,
			SHA256: file.SHA256,
		})
	}
	sort.Slice(assets, func(left, right int) bool { return assets[left].Name < assets[right].Name })
	return releaseHistoryEntry{
		Version:        session.Version,
		PublishedAt:    session.PublishedAt,
		SourceSHA:      session.SourceSHA,
		ManifestSHA256: session.Files["release-manifest.json"].SHA256,
		Assets:         assets,
	}
}

func (s *Server) readStable() (*stableDocument, error) {
	raw, err := os.ReadFile(filepath.Join(s.config.DataRoot, "public", "stable.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var stable stableDocument
	if err := decodeStrictJSON(bytesReader(raw), maxControlFileSize, &stable); err != nil {
		return nil, err
	}
	if err := validateStableDocument(stable); err != nil {
		return nil, err
	}
	return &stable, nil
}

func (s *Server) readHistory() (releaseHistory, error) {
	raw, err := os.ReadFile(filepath.Join(s.config.DataRoot, "public", "releases.json"))
	if errors.Is(err, os.ErrNotExist) {
		return releaseHistory{Schema: 1, Releases: []releaseHistoryEntry{}}, nil
	}
	if err != nil {
		return releaseHistory{}, err
	}
	var history releaseHistory
	if err := decodeStrictJSON(bytesReader(raw), maxControlFileSize, &history); err != nil {
		return releaseHistory{}, err
	}
	if history.Schema != 1 || history.Releases == nil {
		return releaseHistory{}, errors.New("release history schema is invalid")
	}
	return history, nil
}

func validateStableDocument(stable stableDocument) error {
	if stable.Schema != 2 || !versionPattern.MatchString(stable.Version) || !validLowerHex(stable.SourceSHA, 20) {
		return errors.New("stable identity is invalid")
	}
	if _, err := time.Parse(time.RFC3339, stable.PublishedAt); err != nil {
		return errors.New("stable publishedAt is invalid")
	}
	if stable.Deploy.MJSPath != releasePath(stable.Version, "deploy.mjs") || !validLowerHex(stable.Deploy.MJSSHA256, sha256.Size) || stable.Deploy.CorePath != releasePath(stable.Version, "deploy-core.mjs") || !validLowerHex(stable.Deploy.CoreSHA256, sha256.Size) || stable.Release.ManifestPath != releasePath(stable.Version, "release-manifest.json") || !validLowerHex(stable.Release.ManifestSHA256, sha256.Size) {
		return errors.New("stable release pointers are invalid")
	}
	if stable.Desktop != nil && (stable.Desktop.Path != releasePath(stable.Desktop.Version, "WheelMakerDesktop.exe") || !validLowerHex(stable.Desktop.SHA256, sha256.Size)) {
		return errors.New("stable Desktop pointer is invalid")
	}
	if stable.Android != nil {
		versionCode, ok := releaseVersionNumber(stable.Android.Version)
		if !ok || stable.Android.VersionName != stable.Android.Version[1:] || stable.Android.VersionCode != versionCode || stable.Android.Path != releasePath(stable.Android.Version, "WheelMakerAndroid.apk") || !validLowerHex(stable.Android.SourceSHA, 20) || !validLowerHex(stable.Android.SHA256, sha256.Size) || stable.Android.Size <= 0 {
			return errors.New("stable Android pointer is invalid")
		}
	}
	return nil
}

func isNextReleaseVersion(previous *stableDocument, candidate string) bool {
	candidateNumber, ok := releaseVersionNumber(candidate)
	if !ok {
		return false
	}
	if previous == nil {
		return candidateNumber == 1
	}
	previousNumber, ok := releaseVersionNumber(previous.Version)
	return ok && candidateNumber == previousNumber+1
}

func releaseVersionNumber(version string) (int, bool) {
	if !versionPattern.MatchString(version) {
		return 0, false
	}
	number, err := strconv.Atoi(version[3:])
	return number, err == nil
}

func releasePath(version string, name string) string {
	return "/releases/" + version + "/" + name
}

func inspectFile(path string) (fileInfo, error) {
	file, err := os.Open(path)
	if err != nil {
		return fileInfo{}, err
	}
	defer file.Close()
	hasher := sha256.New()
	size, err := io.Copy(hasher, file)
	if err != nil {
		return fileInfo{}, err
	}
	return fileInfo{Size: size, SHA256: hex.EncodeToString(hasher.Sum(nil))}, nil
}

func makePublicTree(root string) error {
	return filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return os.Chmod(path, 0o755)
		}
		if !info.Mode().IsRegular() {
			return errors.New("release tree contains a non-regular file")
		}
		return os.Chmod(path, 0o644)
	})
}

func publishStatusForSession(session publishSession, state string, phase string, errorCode string) publishStatus {
	return publishStatus{
		Schema:    1,
		State:     state,
		Phase:     phase,
		Version:   session.Version,
		SourceSHA: session.SourceSHA,
		Publisher: session.Publisher,
		StartedAt: session.PublishedAt,
		UpdatedAt: session.UpdatedAt,
		ErrorCode: errorCode,
	}
}

func copyFileAtomic(source string, destination string, mode os.FileMode) error {
	raw, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	return writeBytesFileAtomic(destination, raw, mode)
}

func writeBytesFileAtomic(path string, raw []byte, mode os.FileMode) (retErr error) {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".file-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if retErr != nil {
			_ = os.Remove(temporaryPath)
		}
	}()
	if err := temporary.Chmod(mode); err != nil {
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		return err
	}
	if err := temporary.Sync(); err != nil {
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func bytesReader(raw []byte) io.Reader {
	return &byteReader{raw: raw}
}

func (s *Server) recoverPublishedState() error {
	s.commitMu.Lock()
	defer s.commitMu.Unlock()
	stable, err := s.readStable()
	if err != nil {
		return err
	}
	releasesRoot := filepath.Join(s.config.DataRoot, "public", "releases")
	if err := os.MkdirAll(releasesRoot, 0o750); err != nil {
		return err
	}
	entries, err := os.ReadDir(releasesRoot)
	if err != nil {
		return err
	}
	stableNumber := -1
	if stable != nil {
		stableNumber, _ = releaseVersionNumber(stable.Version)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		number, ok := releaseVersionNumber(entry.Name())
		if !ok || number <= stableNumber {
			continue
		}
		if err := s.quarantineVersionDirectory(entry.Name()); err != nil {
			return err
		}
	}
	if stable == nil {
		return nil
	}
	versionDirectory := filepath.Join(releasesRoot, stable.Version)
	if info, err := os.Stat(versionDirectory); err != nil || !info.IsDir() {
		if err == nil {
			err = errors.New("stable version path is not a directory")
		}
		return fmt.Errorf("stable version directory is unavailable: %w", err)
	}
	for name, digest := range map[string]string{
		"deploy.mjs":      stable.Deploy.MJSSHA256,
		"deploy-core.mjs": stable.Deploy.CoreSHA256,
	} {
		source := filepath.Join(versionDirectory, name)
		actual, err := inspectFile(source)
		if err != nil {
			return err
		}
		if actual.SHA256 != digest {
			return fmt.Errorf("stable deployment script digest mismatch: %s", name)
		}
		if err := copyFileAtomic(source, filepath.Join(s.config.DataRoot, "public", name), 0o640); err != nil {
			return err
		}
	}
	history, err := s.readHistory()
	if err != nil {
		return err
	}
	found := false
	for _, entry := range history.Releases {
		if entry.Version == stable.Version {
			found = true
			break
		}
	}
	if !found {
		entry, err := historyEntryFromDirectory(versionDirectory, *stable)
		if err != nil {
			return err
		}
		history.Releases = append(history.Releases, entry)
	}
	return s.writeJSON(filepath.Join(s.config.DataRoot, "public", "releases.json"), history, 0o640)
}

func (s *Server) quarantineVersionDirectory(version string) error {
	source := filepath.Join(s.config.DataRoot, "public", "releases", version)
	for attempt := 0; attempt < 8; attempt++ {
		name := fmt.Sprintf("recovery-%s-%d-%d", version, s.now().UTC().UnixNano(), attempt)
		destination := filepath.Join(s.config.DataRoot, "staging", name)
		if _, err := os.Stat(destination); err == nil {
			continue
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return os.Rename(source, destination)
	}
	return errors.New("allocate recovery staging directory")
}

func historyEntryFromDirectory(directory string, stable stableDocument) (releaseHistoryEntry, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return releaseHistoryEntry{}, err
	}
	assets := make([]releaseAsset, 0, len(entries))
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			return releaseHistoryEntry{}, fmt.Errorf("version directory contains non-file %s", entry.Name())
		}
		info, err := inspectFile(filepath.Join(directory, entry.Name()))
		if err != nil {
			return releaseHistoryEntry{}, err
		}
		assets = append(assets, releaseAsset{
			Name:   entry.Name(),
			Path:   releasePath(stable.Version, entry.Name()),
			Size:   info.Size,
			SHA256: info.SHA256,
		})
	}
	sort.Slice(assets, func(left, right int) bool { return assets[left].Name < assets[right].Name })
	return releaseHistoryEntry{
		Version:        stable.Version,
		PublishedAt:    stable.PublishedAt,
		SourceSHA:      stable.SourceSHA,
		ManifestSHA256: stable.Release.ManifestSHA256,
		Assets:         assets,
	}, nil
}

type byteReader struct {
	raw []byte
}

func (r *byteReader) Read(target []byte) (int, error) {
	if len(r.raw) == 0 {
		return 0, io.EOF
	}
	n := copy(target, r.raw)
	r.raw = r.raw[n:]
	return n, nil
}
