package registry

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	codexRadarEfficiencyEndpoint = "https://codexradar.com/api/intelligence-efficiency"
	maxCodexRadarResponseBytes   = 8 * 1024 * 1024
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

type codexRadarTablePayload struct {
	Combos []codexRadarCombo         `json:"combos"`
	Tasks  []codexRadarTask          `json:"tasks"`
	Cells  map[string]codexRadarCell `json:"cells"`
}

type codexRadarCombo struct {
	Model  string `json:"model"`
	Effort string `json:"effort"`
}

type codexRadarTask struct {
	ID string `json:"id"`
}

type codexRadarCell struct {
	RanBy []codexRadarRunner `json:"ran_by"`
}

type codexRadarRunner struct {
	Passed        *bool    `json:"passed"`
	DurationSec   *float64 `json:"duration_sec"`
	ActualCostUSD *float64 `json:"actual_cost_usd"`
	CostComplete  bool     `json:"cost_complete"`
	GradedAt      string   `json:"graded_at"`
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

func aggregateCodexRadarEfficiency(raw json.RawMessage) (codexRadarEfficiencySnapshot, error) {
	var table codexRadarTablePayload
	if err := json.Unmarshal(raw, &table); err != nil {
		return codexRadarEfficiencySnapshot{}, fmt.Errorf("decode CodexRadar efficiency table: %w", err)
	}
	if len(table.Combos) == 0 || len(table.Tasks) == 0 || table.Cells == nil {
		return codexRadarEfficiencySnapshot{}, errors.New("CodexRadar efficiency table is incomplete")
	}

	latest := time.Time{}
	points := make([]codexRadarEfficiencyPoint, 0, len(table.Combos))
	for _, combo := range table.Combos {
		model := combo.Model
		effort := combo.Effort
		if model == "" || effort == "" {
			continue
		}
		passed := 0
		validTasks := 0
		priceSum := 0.0
		priceSamples := 0
		durationSum := 0.0
		durationSamples := 0
		for _, task := range table.Tasks {
			cell, ok := table.Cells[task.ID+"|"+model+"|"+effort]
			if !ok || len(cell.RanBy) == 0 {
				continue
			}
			runner := cell.RanBy[0]
			if runner.Passed != nil {
				validTasks++
				if *runner.Passed {
					passed++
				}
			}
			if runner.DurationSec != nil && *runner.DurationSec > 0 {
				durationSum += *runner.DurationSec / 60
				durationSamples++
			}
			if runner.ActualCostUSD != nil && *runner.ActualCostUSD >= 0 && (effort != "ultra" || runner.CostComplete) {
				priceSum += *runner.ActualCostUSD
				priceSamples++
			}
			if gradedAt, err := time.Parse(time.RFC3339Nano, runner.GradedAt); err == nil && gradedAt.After(latest) {
				latest = gradedAt
			}
		}
		if validTasks == 0 {
			continue
		}
		point := codexRadarEfficiencyPoint{
			Model:  model,
			Effort: effort,
			IQ:     float64(passed) / float64(validTasks) * 150,
		}
		if priceSamples > 0 {
			average := priceSum / float64(priceSamples)
			point.AveragePriceUSD = &average
		}
		if durationSamples > 0 {
			average := durationSum / float64(durationSamples)
			point.AverageMinutes = &average
		}
		points = append(points, point)
	}
	if len(points) == 0 || latest.IsZero() {
		return codexRadarEfficiencySnapshot{}, errors.New("CodexRadar efficiency table has no valid points")
	}
	return codexRadarEfficiencySnapshot{
		SourceUpdatedAt: latest.UTC().Format(time.RFC3339Nano),
		Points:          points,
	}, nil
}

func decodeCodexRadarEfficiency(raw json.RawMessage) (codexRadarEfficiencySnapshot, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return codexRadarEfficiencySnapshot{}, errors.New("CodexRadar efficiency response is empty")
	}
	return aggregateCodexRadarEfficiency(raw)
}
