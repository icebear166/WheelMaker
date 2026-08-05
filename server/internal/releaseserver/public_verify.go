package releaseserver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"time"
)

const publicVerificationTimeout = 30 * time.Second

func verifyPublicRelease(publicURL string, stable stableDocument, session publishSession, client *http.Client) error {
	base, err := url.Parse(publicURL)
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Hostname() == "" {
		return errors.New("public verification origin is invalid")
	}
	if client == nil {
		client = &http.Client{Timeout: publicVerificationTimeout}
	}
	fetchControl := func(path string) ([]byte, error) {
		response, err := publicVerificationRequest(client, base, path, "")
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("public %s returned HTTP %d", path, response.StatusCode)
		}
		raw, err := io.ReadAll(io.LimitReader(response.Body, maxControlFileSize+1))
		if err != nil {
			return nil, fmt.Errorf("read public %s: %w", path, err)
		}
		if int64(len(raw)) > maxControlFileSize {
			return nil, fmt.Errorf("public %s exceeds control-file limit", path)
		}
		return raw, nil
	}

	stableRaw, err := fetchControl("/stable.json")
	if err != nil {
		return err
	}
	var published stableDocument
	if err := json.Unmarshal(stableRaw, &published); err != nil || !reflect.DeepEqual(published, stable) {
		return errors.New("public stable identity does not match committed release")
	}
	for _, control := range []struct {
		path   string
		digest string
	}{
		{path: "/deploy.mjs", digest: stable.Deploy.MJSSHA256},
		{path: "/deploy-core.mjs", digest: stable.Deploy.CoreSHA256},
		{path: stable.Release.ManifestPath, digest: stable.Release.ManifestSHA256},
	} {
		raw, err := fetchControl(control.path)
		if err != nil {
			return err
		}
		if sha256Hex(raw) != control.digest {
			return fmt.Errorf("public %s SHA-256 mismatch", control.path)
		}
	}
	if session.WithGateway && stable.Gateway != nil {
		raw, err := fetchControl(stable.Gateway.ManifestPath)
		if err != nil {
			return err
		}
		if sha256Hex(raw) != stable.Gateway.ManifestSHA256 {
			return fmt.Errorf("public %s SHA-256 mismatch", stable.Gateway.ManifestPath)
		}
	}

	for _, asset := range historyEntry(session).Assets {
		if !isPublicBinaryAsset(asset.Name) {
			continue
		}
		response, err := publicVerificationRequest(client, base, asset.Path, "bytes=0-0")
		if err != nil {
			return err
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, 2))
		response.Body.Close()
		if readErr != nil {
			return fmt.Errorf("read public artifact %s: %w", asset.Path, readErr)
		}
		if response.StatusCode != http.StatusPartialContent || len(body) != 1 || !strings.HasPrefix(response.Header.Get("Content-Range"), "bytes 0-0/") {
			return fmt.Errorf("public artifact %s did not honor one-byte Range", asset.Path)
		}
	}
	return nil
}

func publicVerificationRequest(client *http.Client, base *url.URL, relativePath string, byteRange string) (*http.Response, error) {
	if !strings.HasPrefix(relativePath, "/") || strings.HasPrefix(relativePath, "//") {
		return nil, errors.New("public verification path is invalid")
	}
	target := base.ResolveReference(&url.URL{Path: relativePath})
	if target.Scheme != base.Scheme || target.Host != base.Host {
		return nil, errors.New("public verification path changed origin")
	}
	request, err := http.NewRequest(http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept-Encoding", "identity")
	if byteRange != "" {
		request.Header.Set("Range", byteRange)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("request public %s: %w", relativePath, err)
	}
	if response.Request == nil || response.Request.URL.Scheme != base.Scheme || response.Request.URL.Host != base.Host {
		response.Body.Close()
		return nil, errors.New("public verification redirect changed origin")
	}
	return response, nil
}

func isPublicBinaryAsset(name string) bool {
	return strings.HasSuffix(name, ".tar.zst") || strings.HasSuffix(name, ".exe") || strings.HasSuffix(name, ".apk")
}

func sha256Hex(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func newPublicVerificationClient(publicURL string) (*http.Client, error) {
	base, err := url.Parse(publicURL)
	if err != nil {
		return nil, err
	}
	return &http.Client{
		Timeout: publicVerificationTimeout,
		CheckRedirect: func(request *http.Request, _ []*http.Request) error {
			if request.URL.Scheme != base.Scheme || request.URL.Host != base.Host {
				return errors.New("public verification redirect changed origin")
			}
			return nil
		},
	}, nil
}
