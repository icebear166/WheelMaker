package wiki

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

type releaseManifest struct {
	Schema      int            `json:"schema"`
	ReleaseID   string         `json:"releaseId"`
	GeneratedAt string         `json:"generatedAt,omitempty"`
	Files       []manifestFile `json:"files"`
}

type manifestFile struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

func VerifyRoot(root string) error {
	if !filepath.IsAbs(root) {
		return errors.New("site root must be absolute")
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("resolve site root: %w", err)
	}
	root = resolvedRoot
	manifestPath := filepath.Join(root, "release-manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("read release manifest: %w", err)
	}
	var manifest releaseManifest
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return fmt.Errorf("decode release manifest: %w", err)
	}
	if manifest.Schema != 1 || manifest.ReleaseID == "" || len(manifest.Files) == 0 {
		return errors.New("release manifest has an invalid header")
	}
	listed := map[string]bool{"release-manifest.json": true}
	for _, item := range manifest.Files {
		if err := verifyManifestFile(root, item); err != nil {
			return err
		}
		if listed[item.Path] {
			return fmt.Errorf("release manifest contains duplicate path %q", item.Path)
		}
		listed[item.Path] = true
	}
	for _, required := range []string{"index.html", "data/catalog.json", "data/search.json", "release-metadata.json"} {
		if !listed[required] {
			return fmt.Errorf("release manifest is missing required file %q", required)
		}
	}
	if err := filepath.WalkDir(root, func(filename string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("site contains non-regular file %q", filename)
		}
		relative, err := filepath.Rel(root, filename)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		if !listed[relative] {
			return fmt.Errorf("site contains unlisted file %q", relative)
		}
		return nil
	}); err != nil {
		return fmt.Errorf("verify site tree: %w", err)
	}
	return nil
}

func verifyManifestFile(root string, item manifestFile) error {
	if item.Path == "" || item.Path != filepath.ToSlash(filepath.Clean(item.Path)) || strings.HasPrefix(item.Path, "/") || strings.HasPrefix(item.Path, "../") {
		return fmt.Errorf("release manifest contains unsafe path %q", item.Path)
	}
	if len(item.SHA256) != 64 {
		return fmt.Errorf("release manifest contains invalid checksum for %q", item.Path)
	}
	if _, err := hex.DecodeString(item.SHA256); err != nil {
		return fmt.Errorf("release manifest contains invalid checksum for %q", item.Path)
	}
	filename := filepath.Join(root, filepath.FromSlash(item.Path))
	info, err := os.Stat(filename)
	if err != nil {
		return fmt.Errorf("stat manifest file %q: %w", item.Path, err)
	}
	if !info.Mode().IsRegular() || info.Size() != item.Bytes {
		return fmt.Errorf("manifest file %q has an unexpected size or type", item.Path)
	}
	file, err := os.Open(filename)
	if err != nil {
		return fmt.Errorf("open manifest file %q: %w", item.Path, err)
	}
	hash := sha256.New()
	_, copyErr := io.Copy(hash, file)
	closeErr := file.Close()
	if copyErr != nil {
		return fmt.Errorf("hash manifest file %q: %w", item.Path, copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close manifest file %q: %w", item.Path, closeErr)
	}
	if subtleChecksumCompare(hex.EncodeToString(hash.Sum(nil)), strings.ToLower(item.SHA256)) == false {
		return fmt.Errorf("manifest checksum mismatch for %q", item.Path)
	}
	return nil
}

func subtleChecksumCompare(actual, expected string) bool {
	if len(actual) != len(expected) {
		return false
	}
	var difference byte
	for index := range actual {
		difference |= actual[index] ^ expected[index]
	}
	return difference == 0
}
