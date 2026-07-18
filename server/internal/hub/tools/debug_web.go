package tools

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const maxDebugWebArchiveBytes = int64(512 << 20)

type debugWebMetadata struct {
	Schema      int    `json:"schema"`
	ArchivePath string `json:"archivePath"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
	PublishedAt string `json:"publishedAt"`
}

func ApplyDebugWeb(ctx context.Context, stateDir, rawBaseURL string, client *http.Client) error {
	base, err := debugWebOrigin(rawBaseURL)
	if err != nil {
		return err
	}
	if client == nil {
		client = http.DefaultClient
	}
	metadata, err := readDebugWebMetadata(ctx, client, base)
	if err != nil {
		return err
	}
	archiveURL, err := debugWebArchiveURL(base, metadata)
	if err != nil {
		return err
	}
	stagingRoot := filepath.Join(stateDir, "staging")
	if err := os.MkdirAll(stagingRoot, 0o700); err != nil {
		return err
	}
	staging, err := os.MkdirTemp(stagingRoot, "debug-web-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	archivePath := filepath.Join(staging, "archive.zip")
	if err := downloadDebugWebArchive(ctx, client, archiveURL, archivePath, metadata); err != nil {
		return err
	}
	temporaryWeb := filepath.Join(stateDir, ".web-debug.tmp")
	if err := os.RemoveAll(temporaryWeb); err != nil {
		return err
	}
	defer os.RemoveAll(temporaryWeb)
	if err := extractDebugWebZip(archivePath, temporaryWeb); err != nil {
		return err
	}
	return replaceDebugWeb(filepath.Join(stateDir, "web"), temporaryWeb)
}

func debugWebOrigin(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("debug web base URL must be a clean HTTPS origin")
	}
	return u, nil
}

func readDebugWebMetadata(ctx context.Context, client *http.Client, base *url.URL) (debugWebMetadata, error) {
	u := base.ResolveReference(&url.URL{Path: "/debug-web/current.json"})
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return debugWebMetadata{}, err
	}
	response, err := client.Do(request)
	if err != nil {
		return debugWebMetadata{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return debugWebMetadata{}, fmt.Errorf("debug web metadata status %d", response.StatusCode)
	}
	var metadata debugWebMetadata
	decoder := json.NewDecoder(io.LimitReader(response.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&metadata); err != nil {
		return debugWebMetadata{}, errors.New("invalid debug web metadata")
	}
	if metadata.Schema != 1 || metadata.Size <= 0 || metadata.Size > maxDebugWebArchiveBytes || !validHexDigest(metadata.SHA256, 64) || metadata.ArchivePath != "/debug-web/archives/"+metadata.SHA256+".zip" {
		return debugWebMetadata{}, errors.New("invalid debug web metadata")
	}
	return metadata, nil
}

func debugWebArchiveURL(base *url.URL, metadata debugWebMetadata) (*url.URL, error) {
	u := base.ResolveReference(&url.URL{Path: metadata.ArchivePath})
	if u.Scheme != base.Scheme || u.Host != base.Host || u.Scheme != "https" {
		return nil, errors.New("debug web archive must stay on the release origin")
	}
	return u, nil
}

func downloadDebugWebArchive(ctx context.Context, client *http.Client, archiveURL *url.URL, destination string, metadata debugWebMetadata) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, archiveURL.String(), nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.ContentLength != metadata.Size {
		return errors.New("debug web archive size mismatch")
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, metadata.Size+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || written != metadata.Size || hex.EncodeToString(hash.Sum(nil)) != metadata.SHA256 {
		return errors.New("debug web archive digest mismatch")
	}
	return nil
}

func extractDebugWebZip(archivePath, destination string) error {
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return err
	}
	defer reader.Close()
	if len(reader.File) == 0 || len(reader.File) > 10000 {
		return errors.New("invalid debug web zip")
	}
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return err
	}
	for _, entry := range reader.File {
		name := path.Clean(entry.Name)
		if name == "." || strings.HasPrefix(name, "../") || strings.HasPrefix(name, "/") || strings.Contains(entry.Name, "\\") || entry.FileInfo().Mode()&os.ModeSymlink != 0 {
			return errors.New("unsafe debug web zip entry")
		}
		target := filepath.Join(destination, filepath.FromSlash(name))
		if target != destination && !strings.HasPrefix(target, destination+string(filepath.Separator)) {
			return errors.New("unsafe debug web zip entry")
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if !entry.FileInfo().Mode().IsRegular() {
			return errors.New("unsafe debug web zip entry")
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		input, err := entry.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err != nil {
			input.Close()
			return err
		}
		_, copyErr := io.Copy(output, io.LimitReader(input, maxDebugWebArchiveBytes+1))
		closeErr := output.Close()
		input.Close()
		if copyErr != nil || closeErr != nil {
			return errors.New("extract debug web zip")
		}
	}
	return nil
}

func replaceDebugWeb(current, temporary string) error {
	backup := current + ".previous"
	_ = os.RemoveAll(backup)
	if err := os.Rename(current, backup); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(temporary, current); err != nil {
		_ = os.Rename(backup, current)
		return err
	}
	return os.RemoveAll(backup)
}
