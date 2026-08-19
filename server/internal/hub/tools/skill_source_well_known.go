package tools

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	wellKnownDiscoverySchemaV2 = "https://schemas.agentskills.io/discovery/0.2.0/schema.json"
	wellKnownIndexMaxBytes     = 4 << 20
	wellKnownEntryMaxCount     = 1000
	wellKnownFileMaxBytes      = 32 << 20
	wellKnownArtifactMaxBytes  = 64 << 20
	wellKnownArchiveMaxBytes   = 50 << 20
	wellKnownArchiveMaxFiles   = 1000
	wellKnownCatalogMaxBytes   = 512 << 20
	wellKnownCatalogMaxFiles   = 10000
)

var (
	wellKnownSkillNamePattern  = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`)
	wellKnownDigestPattern     = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
	errWellKnownRedirectLimit  = errors.New("well-known request exceeded redirect limit")
	errWellKnownDowngrade      = errors.New("well-known HTTPS redirect downgrade is forbidden")
	errWellKnownRedirectAuth   = errors.New("well-known redirect must not contain credentials")
	errWellKnownRedirectScheme = errors.New("well-known redirect scheme is unsupported")
)

type wellKnownSkillSourceProvider struct {
	client *http.Client
	limits wellKnownLimits
}

type wellKnownLimits struct {
	operationTimeout      time.Duration
	responseHeaderTimeout time.Duration
	maxRedirects          int
	downloadConcurrency   int
	indexMaxBytes         int64
	entryMaxCount         int
	fileMaxBytes          int64
	artifactMaxBytes      int64
	archiveMaxBytes       int64
	archiveMaxFiles       int
	catalogMaxBytes       int64
	catalogMaxFiles       int
}

type wellKnownCatalogBudget struct {
	mu       sync.Mutex
	bytes    int64
	files    int
	maxBytes int64
	maxFiles int
}

type wellKnownIndexCandidate struct {
	indexURL string
}

type wellKnownLegacyIndex struct {
	Skills []wellKnownLegacyEntry `json:"skills"`
}

type wellKnownLegacyEntry struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Files       []string `json:"files"`
}

type wellKnownDiscoveryEntry struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Description string `json:"description"`
	URL         string `json:"url"`
	Digest      string `json:"digest"`
}

type wellKnownNormalizedEntry struct {
	version     string
	name        string
	description string
	files       []string
	artifactURL string
	artifact    string
	digest      string
}

func newWellKnownSkillSourceProvider(client *http.Client) *wellKnownSkillSourceProvider {
	if client == nil {
		client = http.DefaultClient
	}
	return &wellKnownSkillSourceProvider{client: client, limits: defaultWellKnownLimits()}
}

func defaultWellKnownLimits() wellKnownLimits {
	return wellKnownLimits{
		operationTimeout: 10 * time.Minute, responseHeaderTimeout: 30 * time.Second,
		maxRedirects: 5, downloadConcurrency: 8,
		indexMaxBytes: wellKnownIndexMaxBytes, entryMaxCount: wellKnownEntryMaxCount,
		fileMaxBytes: wellKnownFileMaxBytes, artifactMaxBytes: wellKnownArtifactMaxBytes,
		archiveMaxBytes: wellKnownArchiveMaxBytes, archiveMaxFiles: wellKnownArchiveMaxFiles,
		catalogMaxBytes: wellKnownCatalogMaxBytes, catalogMaxFiles: wellKnownCatalogMaxFiles,
	}
}

func (budget *wellKnownCatalogBudget) add(size int64) error {
	budget.mu.Lock()
	defer budget.mu.Unlock()
	if size < 0 || budget.bytes+size > budget.maxBytes {
		return errors.New("well-known catalog exceeds maximum size")
	}
	if budget.files+1 > budget.maxFiles {
		return errors.New("well-known catalog contains too many files")
	}
	budget.bytes += size
	budget.files++
	return nil
}

func (p *wellKnownSkillSourceProvider) materialize(ctx context.Context, rawSource, destination string) (skillSourceCheckout, error) {
	if p.limits.operationTimeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, p.limits.operationTimeout)
		defer cancel()
	}
	identity, err := normalizeSkillSourceInput(rawSource)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	if identity.Kind != skillSourceKindWellKnown {
		return skillSourceCheckout{}, errors.New("skill source is not a well-known source")
	}
	if strings.TrimSpace(destination) == "" {
		return skillSourceCheckout{}, errors.New("well-known snapshot destination is required")
	}
	if _, err := os.Lstat(destination); err == nil {
		return skillSourceCheckout{}, errors.New("well-known snapshot destination already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return skillSourceCheckout{}, fmt.Errorf("inspect well-known snapshot destination: %w", err)
	}

	candidates, err := wellKnownIndexCandidates(identity)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	var lastErr error
	for _, candidate := range candidates {
		checkout, candidateErr := p.materializeCandidate(ctx, candidate, destination)
		if candidateErr == nil {
			return checkout, nil
		}
		lastErr = candidateErr
		if identity.SourceKey != "" {
			break
		}
	}
	if lastErr == nil {
		lastErr = errors.New("no index candidates were available")
	}
	return skillSourceCheckout{}, fmt.Errorf("well-known skill source was not materialized: %w", lastErr)
}

func (p *wellKnownSkillSourceProvider) httpClient() *http.Client {
	client := *p.client
	if transport, ok := p.client.Transport.(*http.Transport); ok {
		cloned := transport.Clone()
		cloned.ResponseHeaderTimeout = p.limits.responseHeaderTimeout
		client.Transport = cloned
	} else if p.client.Transport == nil {
		if transport, ok := http.DefaultTransport.(*http.Transport); ok {
			cloned := transport.Clone()
			cloned.ResponseHeaderTimeout = p.limits.responseHeaderTimeout
			client.Transport = cloned
		}
	}
	previousRedirectPolicy := p.client.CheckRedirect
	client.CheckRedirect = func(request *http.Request, via []*http.Request) error {
		if p.limits.maxRedirects >= 0 && len(via) > p.limits.maxRedirects {
			return errWellKnownRedirectLimit
		}
		if request.URL.User != nil {
			return errWellKnownRedirectAuth
		}
		if len(via) > 0 {
			previous := via[len(via)-1]
			if strings.EqualFold(previous.URL.Scheme, "https") && strings.EqualFold(request.URL.Scheme, "http") {
				return errWellKnownDowngrade
			}
			if !strings.EqualFold(previous.URL.Host, request.URL.Host) {
				request.Header.Del("Authorization")
				request.Header.Del("Proxy-Authorization")
				request.Header.Del("Cookie")
			}
		}
		if request.URL.Scheme != "http" && request.URL.Scheme != "https" {
			return errWellKnownRedirectScheme
		}
		if previousRedirectPolicy != nil {
			return previousRedirectPolicy(request, via)
		}
		return nil
	}
	return &client
}

func wellKnownIndexCandidates(identity skillSourceIdentity) ([]wellKnownIndexCandidate, error) {
	if identity.Kind != skillSourceKindWellKnown {
		return nil, errors.New("skill source is not a well-known source")
	}
	if identity.SourceKey != "" {
		return []wellKnownIndexCandidate{{indexURL: identity.Source}}, nil
	}
	parsed, err := url.Parse(identity.Source)
	if err != nil || parsed.Host == "" {
		return nil, errors.New("well-known skill source URL is invalid")
	}
	basePath := strings.TrimSuffix(parsed.EscapedPath(), "/")
	if basePath == "/" {
		basePath = ""
	}
	baseURL := parsed.Scheme + "://" + parsed.Host
	variants := []string{".well-known/agent-skills", ".well-known/skills"}
	seen := map[string]struct{}{}
	var candidates []wellKnownIndexCandidate
	for _, variant := range variants {
		for _, indexURL := range []string{
			baseURL + basePath + "/" + variant + "/index.json",
			baseURL + "/" + variant + "/index.json",
		} {
			if _, exists := seen[indexURL]; exists {
				continue
			}
			seen[indexURL] = struct{}{}
			candidates = append(candidates, wellKnownIndexCandidate{indexURL: indexURL})
		}
	}
	return candidates, nil
}

func (p *wellKnownSkillSourceProvider) materializeCandidate(ctx context.Context, candidate wellKnownIndexCandidate, destination string) (skillSourceCheckout, error) {
	indexRaw, err := p.fetchBytes(ctx, candidate.indexURL, p.limits.indexMaxBytes)
	if err != nil {
		return skillSourceCheckout{}, fmt.Errorf("fetch well-known index: %w", err)
	}
	entries, err := parseWellKnownIndex(indexRaw, candidate.indexURL, p.limits.entryMaxCount)
	if err != nil {
		return skillSourceCheckout{}, fmt.Errorf("parse well-known index: %w", err)
	}
	canonical, canonicalIndex, err := normalizeWellKnownSkillSource(candidate.indexURL)
	if err != nil || !canonicalIndex {
		return skillSourceCheckout{}, errors.New("resolved well-known index URL is invalid")
	}

	parent := filepath.Dir(destination)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return skillSourceCheckout{}, fmt.Errorf("create well-known snapshot parent: %w", err)
	}
	staging, err := os.MkdirTemp(parent, ".well-known-candidate-*")
	if err != nil {
		return skillSourceCheckout{}, fmt.Errorf("create well-known candidate staging: %w", err)
	}
	published := false
	defer func() {
		if !published {
			_ = os.RemoveAll(staging)
		}
	}()

	skills, err := p.materializeEntries(ctx, canonical, entries, staging)
	if err != nil {
		return skillSourceCheckout{}, err
	}
	revision := wellKnownContentRevision(canonical, indexRaw, skills)
	if err := os.Rename(staging, destination); err != nil {
		return skillSourceCheckout{}, fmt.Errorf("publish well-known snapshot: %w", err)
	}
	published = true
	return skillSourceCheckout{
		Source: canonical, SourceKey: canonical, Path: destination,
		Commit: revision, RemoteCommit: revision, Skills: skills,
	}, nil
}

func parseWellKnownIndex(raw []byte, indexURL string, maximumEntries int) ([]wellKnownNormalizedEntry, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, err
	}
	skillsRaw, exists := envelope["skills"]
	if !exists {
		return nil, errors.New("well-known index skills are required")
	}
	var rawEntries []json.RawMessage
	if err := json.Unmarshal(skillsRaw, &rawEntries); err != nil {
		return nil, errors.New("well-known index skills are invalid")
	}
	if len(rawEntries) > maximumEntries {
		return nil, errors.New("well-known index contains too many skills")
	}
	if schemaRaw, hasSchema := envelope["$schema"]; hasSchema {
		var schema string
		if err := json.Unmarshal(schemaRaw, &schema); err != nil || schema != wellKnownDiscoverySchemaV2 {
			return nil, errors.New("unsupported well-known discovery schema")
		}
		return parseWellKnownDiscoveryEntries(rawEntries, indexURL)
	}
	return parseWellKnownLegacyEntries(rawEntries)
}

func parseWellKnownLegacyEntries(rawEntries []json.RawMessage) ([]wellKnownNormalizedEntry, error) {
	var entries []wellKnownLegacyEntry
	for _, rawEntry := range rawEntries {
		var entry wellKnownLegacyEntry
		if err := json.Unmarshal(rawEntry, &entry); err != nil {
			return nil, errors.New("well-known index skill entry is invalid")
		}
		entries = append(entries, entry)
	}
	if len(entries) == 0 {
		return nil, errors.New("well-known index contains no skills")
	}
	seen := map[string]struct{}{}
	normalized := make([]wellKnownNormalizedEntry, 0, len(entries))
	for _, entry := range entries {
		if !validWellKnownSkillName(entry.Name) {
			return nil, fmt.Errorf("well-known index has invalid skill name %q", entry.Name)
		}
		if strings.TrimSpace(entry.Description) == "" {
			return nil, fmt.Errorf("well-known skill %q description is required", entry.Name)
		}
		if len(entry.Files) == 0 {
			return nil, fmt.Errorf("well-known skill %q files are required", entry.Name)
		}
		key := strings.ToLower(entry.Name)
		if _, exists := seen[key]; exists {
			return nil, fmt.Errorf("duplicate well-known skill name %q", entry.Name)
		}
		seen[key] = struct{}{}
		hasSkillMarkdown := false
		seenFiles := map[string]struct{}{}
		for _, file := range entry.Files {
			if !validWellKnownLegacyFilePath(file) {
				return nil, fmt.Errorf("well-known skill %q has invalid file path", entry.Name)
			}
			fileKey := strings.ToLower(filepath.ToSlash(file))
			if _, exists := seenFiles[fileKey]; exists {
				return nil, fmt.Errorf("well-known skill %q has duplicate file path", entry.Name)
			}
			seenFiles[fileKey] = struct{}{}
			if strings.EqualFold(file, "SKILL.md") {
				hasSkillMarkdown = true
			}
		}
		if !hasSkillMarkdown {
			return nil, fmt.Errorf("well-known skill %q does not declare SKILL.md", entry.Name)
		}
		normalized = append(normalized, wellKnownNormalizedEntry{
			version: "0.1.0", name: entry.Name, description: entry.Description, files: append([]string(nil), entry.Files...),
		})
	}
	return normalized, nil
}

func parseWellKnownDiscoveryEntries(rawEntries []json.RawMessage, indexURL string) ([]wellKnownNormalizedEntry, error) {
	seen := map[string]struct{}{}
	var normalized []wellKnownNormalizedEntry
	for _, rawEntry := range rawEntries {
		var entry wellKnownDiscoveryEntry
		if err := json.Unmarshal(rawEntry, &entry); err != nil || !validWellKnownDiscoveryEntry(entry) {
			continue
		}
		resolved, err := url.Parse(entry.URL)
		if err != nil {
			continue
		}
		base, err := url.Parse(indexURL)
		if err != nil {
			return nil, errors.New("well-known index URL is invalid")
		}
		resolved = base.ResolveReference(resolved)
		if (resolved.Scheme != "http" && resolved.Scheme != "https") || resolved.Host == "" || resolved.User != nil {
			continue
		}
		key := strings.ToLower(entry.Name)
		if _, exists := seen[key]; exists {
			return nil, fmt.Errorf("duplicate well-known skill name %q", entry.Name)
		}
		seen[key] = struct{}{}
		normalized = append(normalized, wellKnownNormalizedEntry{
			version: "0.2.0", name: entry.Name, description: entry.Description,
			artifactURL: resolved.String(), artifact: entry.Type, digest: entry.Digest,
		})
	}
	if len(normalized) == 0 {
		return nil, errors.New("well-known discovery index contains no valid skills")
	}
	return normalized, nil
}

func validWellKnownDiscoveryEntry(entry wellKnownDiscoveryEntry) bool {
	return validWellKnownSkillName(entry.Name) && strings.TrimSpace(entry.Description) != "" && len(entry.Description) <= 1024 &&
		(entry.Type == "skill-md" || entry.Type == "archive") && strings.TrimSpace(entry.URL) != "" && wellKnownDigestPattern.MatchString(entry.Digest)
}

func validWellKnownSkillName(name string) bool {
	return len(name) >= 1 && len(name) <= 64 && wellKnownSkillNamePattern.MatchString(name) && !strings.Contains(name, "--")
}

func validWellKnownLegacyFilePath(value string) bool {
	if value == "" || strings.ContainsRune(value, '\x00') || strings.Contains(value, "..") {
		return false
	}
	if strings.HasPrefix(value, "/") || strings.HasPrefix(value, "\\") || strings.Contains(value, "\\") {
		return false
	}
	return !filepath.IsAbs(value) && filepath.VolumeName(value) == ""
}

func (p *wellKnownSkillSourceProvider) materializeEntries(ctx context.Context, canonical string, entries []wellKnownNormalizedEntry, staging string) ([]skillSourceSkillSnapshot, error) {
	baseURL := strings.TrimSuffix(canonical, "/index.json")
	budget := &wellKnownCatalogBudget{maxBytes: p.limits.catalogMaxBytes, maxFiles: p.limits.catalogMaxFiles}
	skills := make([]skillSourceSkillSnapshot, len(entries))
	workerCount := p.limits.downloadConcurrency
	if workerCount < 1 {
		workerCount = 1
	}
	semaphore := make(chan struct{}, workerCount)
	workerContext, cancel := context.WithCancel(ctx)
	defer cancel()
	var waitGroup sync.WaitGroup
	var errorMu sync.Mutex
	var firstErr error
	for index, entry := range entries {
		index, entry := index, entry
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-workerContext.Done():
				return
			}
			skillRoot := filepath.Join(staging, "skills", entry.name)
			var err error
			if entry.version == "0.1.0" {
				err = p.materializeLegacyEntry(workerContext, baseURL, entry, skillRoot, budget)
			} else {
				err = p.materializeDiscoveryEntry(workerContext, entry, skillRoot, staging, budget)
			}
			if err == nil {
				var contentHash string
				contentHash, err = hashSkillDirectory(skillRoot)
				if err != nil {
					err = fmt.Errorf("hash well-known skill %q: %w", entry.name, err)
				} else {
					skills[index] = skillSourceSkillSnapshot{
						Name: entry.name, SkillPath: filepath.ToSlash(filepath.Join("skills", entry.name, "SKILL.md")), ContentSHA256: contentHash,
					}
				}
			}
			if err != nil {
				errorMu.Lock()
				if firstErr == nil {
					firstErr = err
					cancel()
				}
				errorMu.Unlock()
			}
		}()
	}
	waitGroup.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	sort.Slice(skills, func(i, j int) bool { return strings.ToLower(skills[i].Name) < strings.ToLower(skills[j].Name) })
	return skills, nil
}

func (p *wellKnownSkillSourceProvider) materializeLegacyEntry(ctx context.Context, baseURL string, entry wellKnownNormalizedEntry, skillRoot string, budget *wellKnownCatalogBudget) error {
	for _, declaredPath := range entry.files {
		requestPath := declaredPath
		if strings.EqualFold(requestPath, "SKILL.md") {
			requestPath = "SKILL.md"
		}
		fileURL, err := url.JoinPath(baseURL, entry.name, requestPath)
		if err != nil {
			return fmt.Errorf("resolve well-known skill %q file: %w", entry.name, err)
		}
		raw, err := p.fetchBytes(ctx, fileURL, p.limits.fileMaxBytes)
		if err != nil {
			return fmt.Errorf("fetch well-known skill %q file %q: %w", entry.name, declaredPath, err)
		}
		destination, err := safeWellKnownDestination(skillRoot, declaredPath)
		if err != nil {
			return fmt.Errorf("materialize well-known skill %q: %w", entry.name, err)
		}
		if strings.EqualFold(declaredPath, "SKILL.md") {
			destination = filepath.Join(skillRoot, "SKILL.md")
			if err := validateWellKnownSkillMarkdown(raw); err != nil {
				return fmt.Errorf("validate well-known skill %q SKILL.md: %w", entry.name, err)
			}
		}
		if err := budget.add(int64(len(raw))); err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			return fmt.Errorf("create well-known skill directory: %w", err)
		}
		if err := os.WriteFile(destination, raw, 0o600); err != nil {
			return fmt.Errorf("write well-known skill file: %w", err)
		}
	}
	return nil
}

func (p *wellKnownSkillSourceProvider) materializeDiscoveryEntry(ctx context.Context, entry wellKnownNormalizedEntry, skillRoot, staging string, budget *wellKnownCatalogBudget) error {
	if entry.artifact == "skill-md" {
		raw, err := p.fetchBytes(ctx, entry.artifactURL, p.limits.fileMaxBytes)
		if err != nil {
			return fmt.Errorf("fetch well-known skill %q artifact: %w", entry.name, err)
		}
		if wellKnownDigest(raw) != entry.digest {
			return fmt.Errorf("well-known skill %q artifact digest mismatch", entry.name)
		}
		if err := validateWellKnownSkillMarkdown(raw); err != nil {
			return fmt.Errorf("validate well-known skill %q SKILL.md: %w", entry.name, err)
		}
		if err := budget.add(int64(len(raw))); err != nil {
			return err
		}
		if err := os.MkdirAll(skillRoot, 0o755); err != nil {
			return fmt.Errorf("create well-known skill directory: %w", err)
		}
		if err := os.WriteFile(filepath.Join(skillRoot, "SKILL.md"), raw, 0o600); err != nil {
			return fmt.Errorf("write well-known skill file: %w", err)
		}
		return nil
	}

	artifactFile, err := os.CreateTemp(staging, ".well-known-artifact-*")
	if err != nil {
		return fmt.Errorf("create well-known artifact staging: %w", err)
	}
	artifactPath := artifactFile.Name()
	if err := artifactFile.Close(); err != nil {
		_ = os.Remove(artifactPath)
		return fmt.Errorf("close well-known artifact staging: %w", err)
	}
	defer os.Remove(artifactPath)
	contentType, digest, err := p.fetchFile(ctx, entry.artifactURL, artifactPath, p.limits.artifactMaxBytes)
	if err != nil {
		return fmt.Errorf("fetch well-known skill %q artifact: %w", entry.name, err)
	}
	if digest != entry.digest {
		return fmt.Errorf("well-known skill %q artifact digest mismatch", entry.name)
	}
	if err := extractWellKnownArchive(ctx, artifactPath, entry.artifactURL, contentType, skillRoot, p.limits, budget); err != nil {
		return fmt.Errorf("extract well-known skill %q archive: %w", entry.name, err)
	}
	raw, err := os.ReadFile(filepath.Join(skillRoot, "SKILL.md"))
	if err != nil {
		return fmt.Errorf("read well-known skill %q SKILL.md: %w", entry.name, err)
	}
	if err := validateWellKnownSkillMarkdown(raw); err != nil {
		return fmt.Errorf("validate well-known skill %q SKILL.md: %w", entry.name, err)
	}
	return nil
}

func wellKnownDigest(raw []byte) string {
	digest := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(digest[:])
}

func safeWellKnownDestination(root, relative string) (string, error) {
	if !validWellKnownLegacyFilePath(relative) {
		return "", errors.New("well-known file path is unsafe")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}
	destination := filepath.Join(root, filepath.FromSlash(relative))
	inside, err := filepath.Rel(root, destination)
	if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) || filepath.IsAbs(inside) {
		return "", errors.New("well-known file path escapes its skill root")
	}
	return destination, nil
}

func validateWellKnownSkillMarkdown(raw []byte) error {
	normalized := bytes.ReplaceAll(raw, []byte("\r\n"), []byte("\n"))
	lines := bytes.Split(normalized, []byte("\n"))
	if len(lines) == 0 || !bytes.Equal(lines[0], []byte("---")) {
		return errors.New("frontmatter is required")
	}
	end := -1
	for index := 1; index < len(lines); index++ {
		if bytes.Equal(lines[index], []byte("---")) {
			end = index
			break
		}
	}
	if end < 0 {
		return errors.New("frontmatter closing delimiter is required")
	}
	var fields map[string]any
	if err := yaml.Unmarshal(bytes.Join(lines[1:end], []byte("\n")), &fields); err != nil {
		return errors.New("frontmatter is invalid")
	}
	name, nameOK := fields["name"].(string)
	description, descriptionOK := fields["description"].(string)
	if !nameOK || strings.TrimSpace(name) == "" || !descriptionOK || strings.TrimSpace(description) == "" {
		return errors.New("frontmatter name and description are required")
	}
	return nil
}

func (p *wellKnownSkillSourceProvider) fetchBytes(ctx context.Context, address string, maximum int64) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, errors.New("well-known request URL is invalid")
	}
	response, err := p.httpClient().Do(request)
	if err != nil {
		return nil, wellKnownRequestError(ctx, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("request returned HTTP %d", response.StatusCode)
	}
	limited := io.LimitReader(response.Body, maximum+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if int64(len(raw)) > maximum {
		return nil, errors.New("response exceeds size limit")
	}
	return raw, nil
}

func (p *wellKnownSkillSourceProvider) fetchFile(ctx context.Context, address, destination string, maximum int64) (string, string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return "", "", errors.New("well-known request URL is invalid")
	}
	response, err := p.httpClient().Do(request)
	if err != nil {
		return "", "", wellKnownRequestError(ctx, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", "", fmt.Errorf("request returned HTTP %d", response.StatusCode)
	}
	file, err := os.OpenFile(destination, os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", "", fmt.Errorf("open artifact staging: %w", err)
	}
	hasher := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hasher), io.LimitReader(response.Body, maximum+1))
	closeErr := file.Close()
	if copyErr != nil {
		return "", "", fmt.Errorf("read response: %w", copyErr)
	}
	if closeErr != nil {
		return "", "", fmt.Errorf("close artifact staging: %w", closeErr)
	}
	if written > maximum {
		return "", "", errors.New("response exceeds size limit")
	}
	return response.Header.Get("Content-Type"), "sha256:" + hex.EncodeToString(hasher.Sum(nil)), nil
}

func wellKnownRequestError(ctx context.Context, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return fmt.Errorf("request failed: %w", contextErr)
	}
	for _, safe := range []error{
		errWellKnownRedirectLimit,
		errWellKnownDowngrade,
		errWellKnownRedirectAuth,
		errWellKnownRedirectScheme,
	} {
		if errors.Is(err, safe) {
			return fmt.Errorf("request failed: %w", safe)
		}
	}
	var networkError net.Error
	if errors.As(err, &networkError) && networkError.Timeout() {
		return errors.New("request failed: response timeout")
	}
	return errors.New("request failed")
}

func extractWellKnownArchive(ctx context.Context, artifactPath, artifactURL, contentType, destination string, limits wellKnownLimits, budget *wellKnownCatalogBudget) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	format, err := detectWellKnownArchiveFormat(artifactPath, artifactURL, contentType)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(destination, 0o755); err != nil {
		return fmt.Errorf("create archive destination: %w", err)
	}
	if format == "zip" {
		err = extractWellKnownZip(ctx, artifactPath, destination, limits, budget)
	} else {
		err = extractWellKnownTarGz(ctx, artifactPath, destination, limits, budget)
	}
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if info, err := os.Lstat(filepath.Join(destination, "SKILL.md")); err != nil || !info.Mode().IsRegular() {
		return errors.New("archive is missing root SKILL.md")
	}
	return nil
}

func detectWellKnownArchiveFormat(artifactPath, artifactURL, contentType string) (string, error) {
	lowerType := strings.ToLower(contentType)
	lowerURL := strings.ToLower(artifactURL)
	if strings.Contains(lowerType, "application/zip") || strings.HasSuffix(lowerURL, ".zip") {
		return "zip", nil
	}
	if strings.Contains(lowerType, "application/gzip") || strings.Contains(lowerType, "application/x-gzip") ||
		strings.HasSuffix(lowerURL, ".tar.gz") || strings.HasSuffix(lowerURL, ".tgz") {
		return "tar.gz", nil
	}
	file, err := os.Open(artifactPath)
	if err != nil {
		return "", fmt.Errorf("open archive: %w", err)
	}
	defer file.Close()
	var signature [4]byte
	count, err := io.ReadFull(file, signature[:])
	if err != nil && err != io.ErrUnexpectedEOF {
		return "", fmt.Errorf("read archive signature: %w", err)
	}
	if count >= 2 && signature[0] == 0x50 && signature[1] == 0x4b {
		return "zip", nil
	}
	if count >= 2 && signature[0] == 0x1f && signature[1] == 0x8b {
		return "tar.gz", nil
	}
	return "", errors.New("unsupported archive format")
}

func extractWellKnownZip(ctx context.Context, artifactPath, destination string, limits wellKnownLimits, budget *wellKnownCatalogBudget) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	reader, err := zip.OpenReader(artifactPath)
	if err != nil {
		return errors.New("invalid ZIP archive")
	}
	defer reader.Close()
	var totalBytes int64
	fileCount := 0
	seen := map[string]struct{}{}
	for _, entry := range reader.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.Flags&0x1 != 0 {
			return errors.New("encrypted ZIP entries are unsupported")
		}
		mode := entry.Mode()
		entryPath := entry.Name
		if entry.FileInfo().IsDir() {
			entryPath = strings.TrimSuffix(entryPath, "/")
		}
		normalized, err := normalizeWellKnownArchivePath(entryPath)
		if err != nil {
			return err
		}
		if entry.FileInfo().IsDir() {
			if entry.UncompressedSize64 != 0 {
				return errors.New("archive directory contains unexpected data")
			}
			continue
		}
		if mode&os.ModeSymlink != 0 || !mode.IsRegular() {
			return errors.New("archive links and special files are unsupported")
		}
		key := strings.ToLower(normalized)
		if _, exists := seen[key]; exists {
			return errors.New("archive contains duplicate file paths")
		}
		seen[key] = struct{}{}
		fileCount++
		if fileCount > limits.archiveMaxFiles {
			return errors.New("archive contains too many files")
		}
		if entry.UncompressedSize64 > uint64(limits.archiveMaxBytes-totalBytes) {
			return errors.New("archive exceeds maximum unpacked size")
		}
		target, err := safeWellKnownArchiveDestination(destination, normalized)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("create archive directory: %w", err)
		}
		source, err := entry.Open()
		if err != nil {
			return errors.New("open ZIP entry")
		}
		written, writeErr := writeBoundedWellKnownArchiveFile(ctx, target, source, limits.archiveMaxBytes-totalBytes)
		closeErr := source.Close()
		if writeErr != nil {
			return writeErr
		}
		if closeErr != nil {
			return errors.New("close ZIP entry")
		}
		if err := budget.add(written); err != nil {
			return err
		}
		totalBytes += written
	}
	return nil
}

func extractWellKnownTarGz(ctx context.Context, artifactPath, destination string, limits wellKnownLimits, budget *wellKnownCatalogBudget) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	file, err := os.Open(artifactPath)
	if err != nil {
		return fmt.Errorf("open TAR.GZ archive: %w", err)
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(&wellKnownContextReader{ctx: ctx, reader: file})
	if err != nil {
		return errors.New("invalid TAR.GZ archive")
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	var totalBytes int64
	fileCount := 0
	seen := map[string]struct{}{}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return errors.New("invalid TAR archive")
		}
		entryPath := header.Name
		if header.Typeflag == tar.TypeDir {
			entryPath = strings.TrimSuffix(entryPath, "/")
		}
		normalized, err := normalizeWellKnownArchivePath(entryPath)
		if err != nil {
			return err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if header.Size != 0 {
				return errors.New("archive directory contains unexpected data")
			}
			continue
		case tar.TypeSymlink, tar.TypeLink:
			return errors.New("archive links are unsupported")
		case tar.TypeReg, tar.TypeRegA:
		default:
			return errors.New("archive special files are unsupported")
		}
		key := strings.ToLower(normalized)
		if _, exists := seen[key]; exists {
			return errors.New("archive contains duplicate file paths")
		}
		seen[key] = struct{}{}
		fileCount++
		if fileCount > limits.archiveMaxFiles {
			return errors.New("archive contains too many files")
		}
		if header.Size < 0 || header.Size > limits.archiveMaxBytes-totalBytes {
			return errors.New("archive exceeds maximum unpacked size")
		}
		target, err := safeWellKnownArchiveDestination(destination, normalized)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return fmt.Errorf("create archive directory: %w", err)
		}
		written, err := writeBoundedWellKnownArchiveFile(ctx, target, tarReader, limits.archiveMaxBytes-totalBytes)
		if err != nil {
			return err
		}
		if written != header.Size {
			return errors.New("TAR entry size mismatch")
		}
		if err := budget.add(written); err != nil {
			return err
		}
		totalBytes += written
	}
	return nil
}

func normalizeWellKnownArchivePath(raw string) (string, error) {
	if raw == "" || strings.ContainsRune(raw, '\x00') || strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "\\") ||
		strings.Contains(raw, "\\") || filepath.VolumeName(raw) != "" {
		return "", errors.New("unsafe archive path")
	}
	parts := strings.Split(raw, "/")
	if len(parts) == 0 {
		return "", errors.New("unsafe archive path")
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("unsafe archive path")
		}
	}
	return strings.Join(parts, "/"), nil
}

func safeWellKnownArchiveDestination(root, relative string) (string, error) {
	normalized, err := normalizeWellKnownArchivePath(relative)
	if err != nil {
		return "", err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return "", err
	}
	destination := filepath.Join(root, filepath.FromSlash(normalized))
	inside, err := filepath.Rel(root, destination)
	if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(filepath.Separator)) || filepath.IsAbs(inside) {
		return "", errors.New("unsafe archive path")
	}
	return destination, nil
}

type wellKnownContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (reader *wellKnownContextReader) Read(destination []byte) (int, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	count, err := reader.reader.Read(destination)
	if contextErr := reader.ctx.Err(); contextErr != nil {
		return count, contextErr
	}
	return count, err
}

func writeBoundedWellKnownArchiveFile(ctx context.Context, destination string, source io.Reader, maximum int64) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, fmt.Errorf("create archive file: %w", err)
	}
	written, copyErr := io.Copy(file, io.LimitReader(&wellKnownContextReader{ctx: ctx, reader: source}, maximum+1))
	closeErr := file.Close()
	if copyErr != nil {
		return 0, fmt.Errorf("write archive file: %w", copyErr)
	}
	if closeErr != nil {
		return 0, fmt.Errorf("close archive file: %w", closeErr)
	}
	if written > maximum {
		return 0, errors.New("archive exceeds maximum unpacked size")
	}
	return written, nil
}

func wellKnownContentRevision(canonical string, indexRaw []byte, skills []skillSourceSkillSnapshot) string {
	hasher := sha256.New()
	var length [8]byte
	write := func(raw []byte) {
		binary.BigEndian.PutUint64(length[:], uint64(len(raw)))
		_, _ = hasher.Write(length[:])
		_, _ = hasher.Write(raw)
	}
	write([]byte(canonical))
	write(indexRaw)
	for _, skill := range skills {
		write([]byte(skill.Name))
		write([]byte(skill.SkillPath))
		write([]byte(skill.ContentSHA256))
	}
	return hex.EncodeToString(hasher.Sum(nil))
}
