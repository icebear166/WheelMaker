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
	manifest        releaseManifest
	android         *androidReleaseManifest
	gatewayManifest *gatewayManifest
	gateway         *gatewayPointer
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
	var gatewayStage string
	if session.WithGateway {
		gatewayStage = filepath.Join(s.config.DataRoot, "staging", session.SessionID, "gateway")
		if err := stageGatewayFiles(filesDirectory, gatewayStage, session.Version); err != nil {
			return stableDocument{}, err
		}
		if err := makePublicTree(gatewayStage); err != nil {
			_ = restoreGatewayStage(gatewayStage, filesDirectory)
			return stableDocument{}, err
		}
	}
	if err := makePublicTree(filesDirectory); err != nil {
		if gatewayStage != "" {
			_ = restoreGatewayStage(gatewayStage, filesDirectory)
		}
		return stableDocument{}, err
	}
	session.UpdatedAt = s.now().UTC().Format(time.RFC3339)
	if err := s.writePublicStatus(session.SessionID, publishStatusForSession(session, "running", "updating-stable", "")); err != nil {
		if gatewayStage != "" {
			_ = restoreGatewayStage(gatewayStage, filesDirectory)
		}
		return stableDocument{}, err
	}
	if err := os.Rename(filesDirectory, versionDirectory); err != nil {
		if gatewayStage != "" {
			_ = restoreGatewayStage(gatewayStage, filesDirectory)
		}
		return stableDocument{}, fmt.Errorf("publish version directory: %w", err)
	}
	rollback := func() {
		if err := os.Rename(versionDirectory, filesDirectory); err != nil {
			log.Printf("release server: restore failed transaction version=%s: %v", session.Version, err)
		}
	}
	var gatewaySwap *gatewaySwapState
	if session.WithGateway {
		gatewaySwap, err = s.swapGateway(gatewayStage, session.SessionID)
		if err != nil {
			rollback()
			_ = restoreGatewayStage(gatewayStage, filesDirectory)
			return stableDocument{}, fmt.Errorf("publish Gateway artifacts: %w", err)
		}
	}
	stablePath := filepath.Join(s.config.DataRoot, "public", "stable.json")
	if err := s.writeJSON(stablePath, stable, 0o640); err != nil {
		rollback()
		if gatewaySwap != nil {
			if restoreErr := gatewaySwap.restore(); restoreErr != nil {
				log.Printf("release server: Gateway restore failed version=%s: %v", session.Version, restoreErr)
			}
		} else if gatewayStage != "" {
			_ = restoreGatewayStage(gatewayStage, filesDirectory)
		}
		return stableDocument{}, fmt.Errorf("write stable: %w", err)
	}
	if gatewaySwap != nil {
		if err := gatewaySwap.finalize(); err != nil {
			log.Printf("release server: Gateway finalize failed version=%s: %v", session.Version, err)
		}
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
	if manifest.Schema != 2 || manifest.Version != session.Version || manifest.PublishedAt != session.PublishedAt || manifest.SourceSHA != session.SourceSHA || len(manifest.Artifacts) != len(releasePlatforms) {
		return validatedTransaction{}, errors.New("release manifest identity does not match session")
	}
	for _, platform := range releasePlatforms {
		name := "wheelmaker-" + session.Version + "-" + platform + ".tar.zst"
		want := session.Files[name]
		got, ok := manifest.Artifacts[platform]
		if !ok || got.Path != releasePath(session.Version, name) || got.SHA256 != want.SHA256 || got.Size != want.Size {
			return validatedTransaction{}, fmt.Errorf("manifest artifact mismatch %s", platform)
		}
	}
	validated := validatedTransaction{manifest: manifest}
	if session.WithGateway {
		if manifest.Gateway == nil {
			return validatedTransaction{}, errors.New("release manifest Gateway pointer is missing")
		}
		gatewayManifestRaw, err := os.ReadFile(filepath.Join(filesDirectory, "gateway-manifest.json"))
		if err != nil {
			return validatedTransaction{}, err
		}
		var gateway gatewayManifest
		if err := decodeStrictJSON(bytesReader(gatewayManifestRaw), maxControlFileSize, &gateway); err != nil {
			return validatedTransaction{}, errors.New("Gateway manifest is invalid")
		}
		if gateway.Schema != 1 || gateway.Version != session.Version || gateway.PublishedAt != session.PublishedAt || gateway.SourceSHA != session.SourceSHA || gateway.Path != "/gateway/current/gateway-manifest.json" || len(gateway.Artifacts) != len(releasePlatforms) {
			return validatedTransaction{}, errors.New("Gateway manifest identity does not match session")
		}
		gatewayManifestInfo := session.Files["gateway-manifest.json"]
		if manifest.Gateway.ManifestPath != gateway.Path || manifest.Gateway.ManifestSHA256 != gatewayManifestInfo.SHA256 || manifest.Gateway.Version != session.Version || manifest.Gateway.SourceSHA != session.SourceSHA {
			return validatedTransaction{}, errors.New("release manifest Gateway pointer does not match Gateway manifest")
		}
		for _, platform := range releasePlatforms {
			name := "wheelmaker-gateway-" + session.Version + "-" + platform + ".tar.zst"
			want := session.Files[name]
			got, ok := gateway.Artifacts[platform]
			if !ok || got.Path != "/gateway/current/"+name || got.SHA256 != want.SHA256 || got.Size != want.Size {
				return validatedTransaction{}, fmt.Errorf("Gateway manifest artifact mismatch %s", platform)
			}
		}
		validated.gatewayManifest = &gateway
		validated.gateway = manifest.Gateway
	} else if manifest.Gateway != nil {
		return validatedTransaction{}, errors.New("release manifest contains an unexpected Gateway pointer")
	}

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
		stable.Gateway = previous.Gateway
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
	if session.WithGateway && validated.gateway != nil {
		stable.Gateway = &gatewayPointer{
			Version:        validated.gateway.Version,
			SourceSHA:      validated.gateway.SourceSHA,
			ManifestPath:   validated.gateway.ManifestPath,
			ManifestSHA256: validated.gateway.ManifestSHA256,
		}
	}
	return stable
}

func historyEntry(session publishSession) releaseHistoryEntry {
	assets := make([]releaseAsset, 0, len(session.Files))
	for name, file := range session.Files {
		assetPath := releasePath(session.Version, name)
		if session.WithGateway && isGatewayAsset(name) {
			assetPath = gatewayAssetPath(name)
		}
		assets = append(assets, releaseAsset{
			Name:   name,
			Path:   assetPath,
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

func isGatewayAsset(name string) bool {
	return name == "gateway-manifest.json" || (len(name) > len("wheelmaker-gateway-") && name[:len("wheelmaker-gateway-")] == "wheelmaker-gateway-")
}

func gatewayAssetPath(name string) string {
	return "/gateway/current/" + name
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
	if stable.Gateway != nil {
		if !versionPattern.MatchString(stable.Gateway.Version) || !validLowerHex(stable.Gateway.SourceSHA, 20) || stable.Gateway.ManifestPath != "/gateway/current/gateway-manifest.json" || !validLowerHex(stable.Gateway.ManifestSHA256, sha256.Size) {
			return errors.New("stable Gateway pointer is invalid")
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

type gatewaySwapState struct {
	root           string
	current        string
	previous       string
	backup         string
	stage          string
	filesDirectory string
	currentBacked  bool
	previousBacked bool
}

func stageGatewayFiles(filesDirectory, stage, version string) error {
	if err := os.MkdirAll(stage, 0o750); err != nil {
		return err
	}
	names := []string{"gateway-manifest.json"}
	for _, platform := range releasePlatforms {
		names = append(names, "wheelmaker-gateway-"+version+"-"+platform+".tar.zst")
	}
	moved := make([]string, 0, len(names))
	for _, name := range names {
		source := filepath.Join(filesDirectory, name)
		destination := filepath.Join(stage, name)
		if err := os.Rename(source, destination); err != nil {
			for _, movedName := range moved {
				_ = os.Rename(filepath.Join(stage, movedName), filepath.Join(filesDirectory, movedName))
			}
			return fmt.Errorf("stage Gateway file %s: %w", name, err)
		}
		moved = append(moved, name)
	}
	return nil
}

func restoreGatewayStage(stage, filesDirectory string) error {
	entries, err := os.ReadDir(stage)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filesDirectory, 0o750); err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			return fmt.Errorf("Gateway stage contains non-file %s", entry.Name())
		}
		if err := os.Rename(filepath.Join(stage, entry.Name()), filepath.Join(filesDirectory, entry.Name())); err != nil {
			return err
		}
	}
	return os.Remove(stage)
}

func (s *Server) swapGateway(stage, sessionID string) (*gatewaySwapState, error) {
	root := filepath.Join(s.config.DataRoot, "public", "gateway")
	state := &gatewaySwapState{
		root:           root,
		current:        filepath.Join(root, "current"),
		previous:       filepath.Join(root, "previous"),
		backup:         filepath.Join(s.config.DataRoot, "staging", sessionID, "gateway-backup"),
		stage:          stage,
		filesDirectory: filepath.Join(s.config.DataRoot, "staging", sessionID, "files"),
	}
	if err := os.MkdirAll(state.root, 0o750); err != nil {
		return state, err
	}
	// Gateway artifacts are anonymous public downloads. Keep the namespace
	// traversable for the separately running Gateway user even when the Release
	// Server data tree itself is private.
	if err := os.Chmod(state.root, 0o755); err != nil {
		return state, err
	}
	if err := os.RemoveAll(state.backup); err != nil {
		return state, err
	}
	if err := os.MkdirAll(state.backup, 0o750); err != nil {
		return state, err
	}
	if present, err := moveIfPresentWithPresence(state.current, filepath.Join(state.backup, "current")); err != nil {
		return state, err
	} else {
		state.currentBacked = present
	}
	if present, err := moveIfPresentWithPresence(state.previous, filepath.Join(state.backup, "previous")); err != nil {
		_ = state.restoreSlots()
		return state, err
	} else {
		state.previousBacked = present
	}
	if err := os.Rename(stage, state.current); err != nil {
		_ = state.restoreSlots()
		return state, err
	}
	return state, nil
}

func moveIfPresent(source, destination string) error {
	_, err := moveIfPresentWithPresence(source, destination)
	return err
}

func moveIfPresentWithPresence(source, destination string) (bool, error) {
	if _, err := os.Stat(source); errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	return true, os.Rename(source, destination)
}

func (state *gatewaySwapState) restoreSlots() error {
	if state.currentBacked {
		if err := os.RemoveAll(state.current); err != nil {
			return err
		}
	}
	if state.previousBacked {
		if err := os.RemoveAll(state.previous); err != nil {
			return err
		}
	}
	if state.currentBacked {
		if err := moveIfPresent(filepath.Join(state.backup, "current"), state.current); err != nil {
			return err
		}
	}
	if state.previousBacked {
		if err := moveIfPresent(filepath.Join(state.backup, "previous"), state.previous); err != nil {
			return err
		}
	}
	return nil
}

func (state *gatewaySwapState) restore() error {
	if _, err := os.Stat(state.current); err == nil {
		if err := os.RemoveAll(state.stage); err != nil {
			return err
		}
		if err := os.Rename(state.current, state.stage); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := state.restoreSlots(); err != nil {
		return err
	}
	return restoreGatewayStage(state.stage, state.filesDirectory)
}

func (state *gatewaySwapState) finalize() error {
	if err := os.RemoveAll(state.previous); err != nil {
		return err
	}
	if err := moveIfPresent(filepath.Join(state.backup, "current"), state.previous); err != nil {
		return err
	}
	return os.RemoveAll(state.backup)
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
	if err := s.recoverGatewayState(*stable); err != nil {
		return err
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

func (s *Server) recoverGatewayState(stable stableDocument) error {
	if stable.Gateway == nil {
		return nil
	}
	namespace := filepath.Join(s.config.DataRoot, "public", "gateway")
	if err := os.Chmod(namespace, 0o755); err != nil {
		return fmt.Errorf("make Gateway namespace traversable: %w", err)
	}
	root := filepath.Join(namespace, "current")
	manifestPath := filepath.Join(root, "gateway-manifest.json")
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("stable Gateway manifest is unavailable: %w", err)
	}
	identity, err := inspectFile(manifestPath)
	if err != nil || identity.SHA256 != stable.Gateway.ManifestSHA256 {
		if err == nil {
			err = errors.New("stable Gateway manifest digest mismatch")
		}
		return err
	}
	var manifest gatewayManifest
	if err := decodeStrictJSON(bytesReader(raw), maxControlFileSize, &manifest); err != nil {
		return errors.New("stable Gateway manifest is invalid")
	}
	if manifest.Schema != 1 || manifest.Version != stable.Gateway.Version || manifest.SourceSHA != stable.Gateway.SourceSHA || manifest.Path != stable.Gateway.ManifestPath || len(manifest.Artifacts) != len(releasePlatforms) {
		return errors.New("stable Gateway manifest identity is invalid")
	}
	for _, platform := range releasePlatforms {
		name := "wheelmaker-gateway-" + manifest.Version + "-" + platform + ".tar.zst"
		artifact, ok := manifest.Artifacts[platform]
		if !ok || artifact.Path != gatewayAssetPath(name) {
			return fmt.Errorf("stable Gateway artifact pointer is invalid: %s", platform)
		}
		actual, err := inspectFile(filepath.Join(root, name))
		if err != nil || actual != (fileInfo{Size: artifact.Size, SHA256: artifact.SHA256}) {
			if err == nil {
				err = fmt.Errorf("stable Gateway artifact digest mismatch: %s", platform)
			}
			return err
		}
	}
	return nil
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
