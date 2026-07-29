package usage

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/swm8023/wheelmaker/internal/shared"
)

const (
	historyFileVersion = 1
	historyMaxPoints   = 10_000
	historyQueryRange  = 7 * 24 * time.Hour
)

var shanghaiLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

type HistorySample struct {
	ObservedAtMillis int64
	RemainingPercent float64
}

func (s HistorySample) MarshalJSON() ([]byte, error) {
	return json.Marshal([2]float64{float64(s.ObservedAtMillis), s.RemainingPercent})
}

func (s *HistorySample) UnmarshalJSON(raw []byte) error {
	var pair []float64
	if err := json.Unmarshal(raw, &pair); err != nil {
		return err
	}
	if len(pair) != 2 || !finite(pair[0]) || !finite(pair[1]) || pair[0] < 0 || pair[0] != math.Trunc(pair[0]) || pair[1] < 0 || pair[1] > 100 {
		return errors.New("invalid history sample")
	}
	s.ObservedAtMillis = int64(pair[0])
	s.RemainingPercent = pair[1]
	return nil
}

type HistoryQuery struct {
	ProviderID     ProviderID
	AccountLocalID string
	Now            time.Time
}

type HistoryLimit struct {
	ID                 string          `json:"id"`
	Label              string          `json:"label"`
	WindowKind         WindowKind      `json:"windowKind"`
	WindowDurationMins int64           `json:"windowDurationMins,omitempty"`
	ResetsAt           *time.Time      `json:"resetsAt,omitempty"`
	Samples            []HistorySample `json:"samples"`
}

type HistoryResponse struct {
	ProviderID     ProviderID     `json:"providerId"`
	AccountLocalID string         `json:"accountLocalId"`
	Limits         []HistoryLimit `json:"limits"`
}

type historySeries struct {
	ProviderID         ProviderID      `json:"providerId"`
	AccountLocalID     string          `json:"accountLocalId"`
	LimitID            string          `json:"limitId"`
	LimitLabel         string          `json:"limitLabel"`
	WindowKind         WindowKind      `json:"windowKind"`
	WindowDurationMins int64           `json:"windowDurationMins,omitempty"`
	ResetAt            *time.Time      `json:"resetAt,omitempty"`
	Samples            []HistorySample `json:"samples"`
}

type historyFile struct {
	Version int             `json:"version"`
	Series  []historySeries `json:"series"`
}

type HistoryStore struct {
	path string
	mu   sync.Mutex
}

func NewHistoryStore(path string) *HistoryStore {
	return &HistoryStore{path: filepath.Clean(path)}
}

func (s *HistoryStore) Record(at time.Time, providers []ProviderSnapshot) error {
	if s == nil || s.path == "" || at.IsZero() {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	changed := false
	at = at.UTC()
	for _, provider := range providers {
		if provider.Status != ProviderOK || provider.ID == "" {
			continue
		}
		for _, account := range provider.Accounts {
			if account.Status != ProviderOK || account.LocalID == "" {
				continue
			}
			for _, limit := range account.Limits {
				if !validLimitForHistory(limit) {
					continue
				}
				index := findHistorySeries(data.Series, provider.ID, account.LocalID, limit.ID)
				if index < 0 {
					data.Series = append(data.Series, historySeries{
						ProviderID: provider.ID, AccountLocalID: account.LocalID,
						LimitID: limit.ID, Samples: []HistorySample{},
					})
					index = len(data.Series) - 1
				}
				series := &data.Series[index]
				series.LimitLabel = limit.Label
				series.WindowKind = limit.WindowKind
				series.WindowDurationMins = limit.WindowDurationMins
				series.ResetAt = cloneTime(limit.ResetsAt)
				upsertHistorySample(&series.Samples, HistorySample{
					ObservedAtMillis: at.UnixMilli(),
					RemainingPercent: limit.RemainingPercent,
				})
				pruneHistorySeries(series)
				changed = true
			}
		}
	}
	if !changed {
		return nil
	}
	sort.Slice(data.Series, func(i, j int) bool {
		left, right := data.Series[i], data.Series[j]
		if left.ProviderID != right.ProviderID {
			return left.ProviderID < right.ProviderID
		}
		if left.AccountLocalID != right.AccountLocalID {
			return left.AccountLocalID < right.AccountLocalID
		}
		return left.LimitID < right.LimitID
	})
	return s.writeLocked(data)
}

func (s *HistoryStore) Query(input HistoryQuery) (HistoryResponse, error) {
	response := HistoryResponse{
		ProviderID: input.ProviderID, AccountLocalID: input.AccountLocalID, Limits: []HistoryLimit{},
	}
	if s == nil || s.path == "" {
		return response, nil
	}
	if input.ProviderID == "" || input.AccountLocalID == "" {
		return response, errors.New("providerId and accountLocalId are required")
	}
	now := input.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = now.UTC()

	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return response, err
	}
	for _, series := range data.Series {
		if series.ProviderID != input.ProviderID || series.AccountLocalID != input.AccountLocalID {
			continue
		}
		cutoff := now.Add(-historyQueryRange)
		samples := make([]HistorySample, 0, len(series.Samples))
		for _, sample := range series.Samples {
			observedAt := time.UnixMilli(sample.ObservedAtMillis)
			if observedAt.Before(cutoff) || observedAt.After(now) {
				continue
			}
			samples = append(samples, sample)
		}
		if len(samples) == 0 {
			continue
		}
		response.Limits = append(response.Limits, HistoryLimit{
			ID: series.LimitID, Label: series.LimitLabel,
			WindowKind: series.WindowKind, WindowDurationMins: series.WindowDurationMins,
			ResetsAt: cloneTime(series.ResetAt), Samples: samples,
		})
	}
	sort.Slice(response.Limits, func(i, j int) bool {
		return response.Limits[i].ID < response.Limits[j].ID
	})
	return response, nil
}

func (s *HistoryStore) loadLocked() (historyFile, error) {
	empty := historyFile{Version: historyFileVersion, Series: []historySeries{}}
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return empty, nil
	}
	if err != nil {
		return empty, err
	}
	var data historyFile
	if json.Unmarshal(raw, &data) != nil || validateHistoryFile(data) != nil {
		if err := os.Remove(s.path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return empty, fmt.Errorf("remove invalid usage history: %w", err)
		}
		return empty, nil
	}
	if data.Series == nil {
		data.Series = []historySeries{}
	}
	return data, nil
}

func (s *HistoryStore) writeLocked(data historyFile) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("marshal usage history: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create usage history directory: %w", err)
	}
	if err := shared.WriteConfigFile(s.path, raw); err != nil {
		return fmt.Errorf("write usage history: %w", err)
	}
	return nil
}

func validateHistoryFile(data historyFile) error {
	if data.Version != historyFileVersion {
		return fmt.Errorf("unsupported usage history version %d", data.Version)
	}
	seen := make(map[string]struct{}, len(data.Series))
	for _, series := range data.Series {
		if series.ProviderID == "" || series.AccountLocalID == "" || series.LimitID == "" {
			return errors.New("usage history series identity is incomplete")
		}
		if !validWindow(series.WindowKind, series.WindowDurationMins) || series.ResetAt == nil || series.ResetAt.IsZero() {
			return errors.New("usage history series window is invalid")
		}
		key := historySeriesKey(series.ProviderID, series.AccountLocalID, series.LimitID)
		if _, exists := seen[key]; exists {
			return errors.New("duplicate usage history series")
		}
		seen[key] = struct{}{}
		var previous int64 = -1
		for _, sample := range series.Samples {
			if sample.ObservedAtMillis <= previous || !validPercent(sample.RemainingPercent) {
				return errors.New("usage history samples are invalid")
			}
			previous = sample.ObservedAtMillis
		}
	}
	return nil
}

func validLimitForHistory(limit Limit) bool {
	return limit.ID != "" && validPercent(limit.RemainingPercent) &&
		validWindow(limit.WindowKind, limit.WindowDurationMins) &&
		limit.ResetsAt != nil && !limit.ResetsAt.IsZero()
}

func validWindow(kind WindowKind, durationMins int64) bool {
	switch kind {
	case WindowFixed:
		return durationMins > 0
	case WindowCalendarMonth:
		return durationMins == 0
	default:
		return false
	}
}

func validPercent(value float64) bool {
	return finite(value) && value >= 0 && value <= 100
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func findHistorySeries(series []historySeries, providerID ProviderID, accountLocalID, limitID string) int {
	key := historySeriesKey(providerID, accountLocalID, limitID)
	for index := range series {
		if historySeriesKey(series[index].ProviderID, series[index].AccountLocalID, series[index].LimitID) == key {
			return index
		}
	}
	return -1
}

func historySeriesKey(providerID ProviderID, accountLocalID, limitID string) string {
	return string(providerID) + "\x00" + accountLocalID + "\x00" + limitID
}

func upsertHistorySample(samples *[]HistorySample, sample HistorySample) {
	index := sort.Search(len(*samples), func(index int) bool {
		return (*samples)[index].ObservedAtMillis >= sample.ObservedAtMillis
	})
	if index < len(*samples) && (*samples)[index].ObservedAtMillis == sample.ObservedAtMillis {
		(*samples)[index] = sample
		return
	}
	*samples = append(*samples, HistorySample{})
	copy((*samples)[index+1:], (*samples)[index:])
	(*samples)[index] = sample
}

func pruneHistorySeries(series *historySeries) {
	if series == nil || len(series.Samples) == 0 {
		return
	}
	cutoff, ok := retainedWindowStart(*series)
	if ok {
		index := sort.Search(len(series.Samples), func(index int) bool {
			return !time.UnixMilli(series.Samples[index].ObservedAtMillis).Before(cutoff)
		})
		if index > 0 {
			series.Samples = append([]HistorySample(nil), series.Samples[index:]...)
		}
	}
	if len(series.Samples) > historyMaxPoints {
		series.Samples = append([]HistorySample(nil), series.Samples[len(series.Samples)-historyMaxPoints:]...)
	}
}

func retainedWindowStart(series historySeries) (time.Time, bool) {
	if series.ResetAt == nil || series.ResetAt.IsZero() {
		return time.Time{}, false
	}
	switch series.WindowKind {
	case WindowFixed:
		if series.WindowDurationMins <= 0 {
			return time.Time{}, false
		}
		return series.ResetAt.UTC().Add(-2 * time.Duration(series.WindowDurationMins) * time.Minute), true
	case WindowCalendarMonth:
		reset := series.ResetAt.In(shanghaiLocation)
		return time.Date(reset.Year(), reset.Month()-2, 1, 0, 0, 0, 0, shanghaiLocation), true
	default:
		return time.Time{}, false
	}
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	copyValue := value.UTC()
	return &copyValue
}
