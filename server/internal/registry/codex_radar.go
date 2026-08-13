package registry

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"sync"
	"time"
)

const (
	codexRadarEfficiencyEndpoint = "https://api.codexradar.com/api/v1/intelligence-efficiency?benchmark=deep-swe"
	maxCodexRadarResponseBytes   = 8 * 1024 * 1024
	codexRadarEfficiencyCacheTTL = 10 * time.Minute
)

type codexRadarEfficiencyFetcher struct {
	client   *http.Client
	endpoint string
}

func newCodexRadarEfficiencyFetcher() *codexRadarEfficiencyFetcher {
	return &codexRadarEfficiencyFetcher{
		client:   &http.Client{Timeout: 15 * time.Second},
		endpoint: codexRadarEfficiencyEndpoint,
	}
}

func (f *codexRadarEfficiencyFetcher) load(ctx context.Context) (json.RawMessage, error) {
	if f == nil || f.client == nil || f.endpoint == "" {
		return nil, errors.New("CodexRadar fetcher is not configured")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, f.endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("create CodexRadar request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Cache-Control", "no-cache")
	response, err := f.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("request CodexRadar efficiency: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("CodexRadar efficiency request failed (%d)", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxCodexRadarResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read CodexRadar efficiency response: %w", err)
	}
	if len(body) > maxCodexRadarResponseBytes {
		return nil, errors.New("CodexRadar efficiency response is too large")
	}
	return json.RawMessage(body), nil
}

type codexRadarEfficiencyCache struct {
	mu sync.Mutex

	snapshot      codexRadarEfficiencySnapshot
	hasSnapshot   bool
	cachedAt      time.Time
	lastAttemptAt time.Time
	lastError     error

	fetching bool
	wait     chan struct{}
}

func (c *codexRadarEfficiencyCache) get(
	ctx context.Context,
	loader func(context.Context) (json.RawMessage, error),
) (codexRadarEfficiencySnapshot, error) {
	if c == nil {
		return codexRadarEfficiencySnapshot{}, errors.New("CodexRadar efficiency cache is not configured")
	}
	if loader == nil {
		return codexRadarEfficiencySnapshot{}, errors.New("CodexRadar efficiency loader is not configured")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	for {
		now := time.Now()
		c.mu.Lock()
		if c.hasSnapshot && now.Sub(c.cachedAt) < codexRadarEfficiencyCacheTTL {
			snapshot := c.snapshot
			c.mu.Unlock()
			return snapshot, nil
		}
		if c.fetching {
			wait := c.wait
			c.mu.Unlock()
			select {
			case <-wait:
				continue
			case <-ctx.Done():
				return codexRadarEfficiencySnapshot{}, ctx.Err()
			}
		}
		if !c.lastAttemptAt.IsZero() && now.Sub(c.lastAttemptAt) < codexRadarEfficiencyCacheTTL {
			snapshot, hasSnapshot := c.snapshot, c.hasSnapshot
			err := c.lastError
			c.mu.Unlock()
			if hasSnapshot {
				return snapshot, nil
			}
			if err != nil {
				return codexRadarEfficiencySnapshot{}, err
			}
			return codexRadarEfficiencySnapshot{}, errors.New("CodexRadar efficiency refresh is throttled")
		}
		c.fetching = true
		c.wait = make(chan struct{})
		wait := c.wait
		c.lastAttemptAt = now
		c.mu.Unlock()

		raw, err := loader(ctx)
		var snapshot codexRadarEfficiencySnapshot
		if err == nil {
			snapshot, err = decodeCodexRadarEfficiency(raw)
		}

		c.mu.Lock()
		if err == nil {
			c.snapshot = snapshot
			c.hasSnapshot = true
			c.cachedAt = time.Now()
			c.lastAttemptAt = c.cachedAt
			c.lastError = nil
		} else {
			c.lastError = err
		}
		c.fetching = false
		close(wait)
		stale, hasStale := c.snapshot, c.hasSnapshot
		c.mu.Unlock()

		if err == nil {
			return snapshot, nil
		}
		if hasStale {
			registryLogger("").Warn("CodexRadar refresh failed; serving cached snapshot: %v", err)
			return stale, nil
		}
		return codexRadarEfficiencySnapshot{}, err
	}
}

type codexRadarEfficiencySnapshot struct {
	SourceUpdatedAt string                      `json:"source_updated_at"`
	Points          []codexRadarEfficiencyPoint `json:"points"`
}

type codexRadarEfficiencyPoint struct {
	Model           string   `json:"model"`
	Effort          string   `json:"effort"`
	IQ              float64  `json:"iq"`
	AveragePriceUSD *float64 `json:"average_price_usd"`
	AverageMinutes  *float64 `json:"average_minutes"`
}

type codexRadarEfficiencyPayload struct {
	SourceUpdatedAt string                             `json:"source_updated_at"`
	Points          []codexRadarEfficiencyPayloadPoint `json:"points"`
}

type codexRadarEfficiencyPayloadPoint struct {
	Model           string   `json:"model"`
	Effort          string   `json:"effort"`
	IQ              *float64 `json:"iq"`
	AveragePriceUSD *float64 `json:"average_price_usd"`
	AverageMinutes  *float64 `json:"average_minutes"`
}

func decodeCodexRadarEfficiency(raw json.RawMessage) (codexRadarEfficiencySnapshot, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return codexRadarEfficiencySnapshot{}, errors.New("CodexRadar efficiency response is empty")
	}

	var payload codexRadarEfficiencyPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return codexRadarEfficiencySnapshot{}, fmt.Errorf("decode CodexRadar efficiency payload: %w", err)
	}
	if payload.SourceUpdatedAt == "" {
		return codexRadarEfficiencySnapshot{}, errors.New("CodexRadar efficiency payload has no source update time")
	}

	points := make([]codexRadarEfficiencyPoint, 0, len(payload.Points))
	for _, candidate := range payload.Points {
		if candidate.Model == "" || candidate.Effort == "" || candidate.IQ == nil ||
			math.IsNaN(*candidate.IQ) || math.IsInf(*candidate.IQ, 0) {
			continue
		}
		points = append(points, codexRadarEfficiencyPoint{
			Model:           candidate.Model,
			Effort:          candidate.Effort,
			IQ:              *candidate.IQ,
			AveragePriceUSD: candidate.AveragePriceUSD,
			AverageMinutes:  candidate.AverageMinutes,
		})
	}
	if len(points) == 0 {
		return codexRadarEfficiencySnapshot{}, errors.New("CodexRadar efficiency payload has no valid points")
	}
	return codexRadarEfficiencySnapshot{
		SourceUpdatedAt: payload.SourceUpdatedAt,
		Points:          points,
	}, nil
}
