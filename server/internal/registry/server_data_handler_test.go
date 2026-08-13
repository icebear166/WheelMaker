package registry

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
	"github.com/swm8023/wheelmaker/internal/serverdata"
)

const codexRadarEfficiencyCacheFixture = `{
	"schema": 2,
	"mode": "weighted_latest_3",
	"source_updated_at": "2026-08-13T04:00:24Z",
	"points": [
		{"model":"gpt-5.6-sol","effort":"low","iq":120,"average_price_usd":1,"average_minutes":2},
		{"model":"deepseek-v4-pro","effort":"max","iq":82.98,"average_price_usd":0.242751,"average_minutes":38.94},
		{"model":"deepseek-v4-flash","effort":"low","iq":null,"average_price_usd":null,"average_minutes":null}
	]
}`

func TestCodexRadarEfficiencyGetUsesOfficialPoints(t *testing.T) {
	server := New(Config{})
	server.codexRadarEfficiencyLoader = func(context.Context) (json.RawMessage, error) {
		return json.RawMessage(codexRadarEfficiencyCacheFixture), nil
	}
	response := invokeServerDataHandler(t, server, &connectionState{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-web"}, envelope{
		RequestID: 1,
		Method:    rp.RegistryMethodCodexRadarEfficiencyGet,
		Payload:   rp.MustRaw(map[string]any{}),
	})
	if response.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("response=%+v", response)
	}
	var payload struct {
		SourceUpdatedAt string `json:"source_updated_at"`
		Points          []struct {
			Model           string  `json:"model"`
			Effort          string  `json:"effort"`
			IQ              float64 `json:"iq"`
			AveragePriceUSD float64 `json:"average_price_usd"`
			AverageMinutes  float64 `json:"average_minutes"`
		} `json:"points"`
	}
	if err := json.Unmarshal(response.Payload, &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.SourceUpdatedAt != "2026-08-13T04:00:24Z" {
		t.Fatalf("source_updated_at=%q", payload.SourceUpdatedAt)
	}
	if len(payload.Points) != 2 {
		t.Fatalf("points=%+v", payload.Points)
	}
	if payload.Points[0].Model != "gpt-5.6-sol" || payload.Points[0].Effort != "low" || payload.Points[0].IQ != 120 || payload.Points[0].AveragePriceUSD != 1 || payload.Points[0].AverageMinutes != 2 {
		t.Fatalf("gpt point=%+v", payload.Points[0])
	}
	if payload.Points[1].Model != "deepseek-v4-pro" || payload.Points[1].Effort != "max" || payload.Points[1].IQ != 82.98 || payload.Points[1].AveragePriceUSD != 0.242751 || payload.Points[1].AverageMinutes != 38.94 {
		t.Fatalf("deepseek point=%+v", payload.Points[1])
	}
}

func TestNewCodexRadarEfficiencyFetcherUsesOfficialEndpoint(t *testing.T) {
	fetcher := newCodexRadarEfficiencyFetcher()
	if fetcher.endpoint != "https://api.codexradar.com/api/v1/intelligence-efficiency?benchmark=deep-swe" {
		t.Fatalf("endpoint=%q", fetcher.endpoint)
	}
}

func TestCodexRadarEfficiencyFetcherLoadsLiveEndpoint(t *testing.T) {
	const body = `{"combos":[],"tasks":[],"cells":{}}`
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			t.Errorf("method=%q, want GET", request.Method)
		}
		if request.Header.Get("Accept") != "application/json" {
			t.Errorf("Accept=%q", request.Header.Get("Accept"))
		}
		if request.Header.Get("Cache-Control") != "no-cache" {
			t.Errorf("Cache-Control=%q", request.Header.Get("Cache-Control"))
		}
		_, _ = w.Write([]byte(body))
	}))
	defer httpServer.Close()

	fetcher := &codexRadarEfficiencyFetcher{client: httpServer.Client(), endpoint: httpServer.URL}
	raw, err := fetcher.load(context.Background())
	if err != nil {
		t.Fatalf("load() error = %v", err)
	}
	if string(raw) != body {
		t.Fatalf("raw body = %q, want %q", raw, body)
	}
}

func TestCodexRadarEfficiencyCacheLimitsUpstreamRequestsAndServesStaleData(t *testing.T) {
	cache := codexRadarEfficiencyCache{}
	var calls int
	loader := func(context.Context) (json.RawMessage, error) {
		calls++
		if calls == 1 {
			return json.RawMessage(codexRadarEfficiencyCacheFixture), nil
		}
		return nil, errors.New("upstream unavailable")
	}

	first, err := cache.get(context.Background(), loader)
	if err != nil {
		t.Fatalf("first get() error = %v", err)
	}
	second, err := cache.get(context.Background(), loader)
	if err != nil {
		t.Fatalf("second get() error = %v", err)
	}
	if calls != 1 || first.SourceUpdatedAt != second.SourceUpdatedAt {
		t.Fatalf("cache calls=%d first=%+v second=%+v", calls, first, second)
	}

	cache.cachedAt = time.Now().Add(-codexRadarEfficiencyCacheTTL - time.Second)
	cache.lastAttemptAt = cache.cachedAt
	stale, err := cache.get(context.Background(), loader)
	if err != nil {
		t.Fatalf("stale get() error = %v", err)
	}
	if calls != 2 || stale.SourceUpdatedAt != first.SourceUpdatedAt {
		t.Fatalf("stale fallback calls=%d stale=%+v", calls, stale)
	}
	if _, err := cache.get(context.Background(), loader); err != nil {
		t.Fatalf("cached failure get() error = %v", err)
	}
	if calls != 2 {
		t.Fatalf("cached failure retried upstream: calls=%d", calls)
	}
}

func TestCodexRadarEfficiencyCacheCoalescesConcurrentFetches(t *testing.T) {
	cache := codexRadarEfficiencyCache{}
	started := make(chan struct{})
	release := make(chan struct{})
	var calls int
	loader := func(context.Context) (json.RawMessage, error) {
		calls++
		close(started)
		<-release
		return json.RawMessage(codexRadarEfficiencyCacheFixture), nil
	}

	results := make(chan error, 2)
	go func() {
		_, err := cache.get(context.Background(), loader)
		results <- err
	}()
	<-started
	go func() {
		_, err := cache.get(context.Background(), loader)
		results <- err
	}()
	close(release)

	for range 2 {
		if err := <-results; err != nil {
			t.Fatalf("concurrent get() error = %v", err)
		}
	}
	if calls != 1 {
		t.Fatalf("concurrent upstream calls=%d, want 1", calls)
	}
}

type fakeServerDataStore struct {
	mu            sync.Mutex
	snapshot      serverdata.Snapshot
	snapshotErr   error
	secrets       map[serverdata.SecretKind]string
	versions      map[serverdata.SecretKind]string
	secretReads   []serverdata.SecretKind
	secretUpdates []serverDataSecretUpdate
}

type serverDataSecretUpdate struct {
	kind   serverdata.SecretKind
	action string
	value  string
}

func (f *fakeServerDataStore) Snapshot() (serverdata.Snapshot, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.snapshot, f.snapshotErr
}

func (f *fakeServerDataStore) UpdateSecret(kind serverdata.SecretKind, action, value string, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.secretUpdates = append(f.secretUpdates, serverDataSecretUpdate{kind: kind, action: action, value: value})
	return nil
}

func (f *fakeServerDataStore) UpdateVoiceInputModel(model string, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.snapshot.VoiceInput.Model = model
	return nil
}

func (f *fakeServerDataStore) UpdateTTS(model, voice string, _ time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.snapshot.TextToSpeech.Model = model
	f.snapshot.TextToSpeech.Voice = voice
	return nil
}

func (f *fakeServerDataStore) Secret(kind serverdata.SecretKind) (string, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.secretReads = append(f.secretReads, kind)
	return f.secrets[kind], f.versions[kind], nil
}

type serverDataCaptureWriter struct {
	writes chan envelope
}

func (w *serverDataCaptureWriter) WriteJSON(value any) error {
	env, ok := value.(envelope)
	if !ok {
		return errors.New("unexpected write type")
	}
	w.writes <- env
	return nil
}

func (w *serverDataCaptureWriter) Close() error { return nil }

func invokeServerDataHandler(t *testing.T, server *Server, state *connectionState, request envelope) envelope {
	t.Helper()
	writer := &serverDataCaptureWriter{writes: make(chan envelope, 1)}
	peer := newPeerConn(writer, "server-data-test")
	defer peer.close()
	state.peer = peer
	server.handleServerDataRequest(peer, state, request)
	select {
	case response := <-writer.writes:
		return response
	case <-time.After(time.Second):
		t.Fatal("server data handler did not respond")
		return envelope{}
	}
}

func responseErrorCode(t *testing.T, response envelope) string {
	t.Helper()
	var payload rp.ErrorPayload
	if err := json.Unmarshal(response.Payload, &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	return payload.Code
}

func TestServerConfigGetNeverReturnsSecretValues(t *testing.T) {
	store := &fakeServerDataStore{
		snapshot: serverdata.Snapshot{
			VoiceInput:   serverdata.VoiceInputSnapshot{FeatureSnapshot: serverdata.FeatureSnapshot{Configured: true}, Model: serverdata.VoiceInputModelDoubaoStreamingASR2},
			TextToSpeech: serverdata.TTSSnapshot{FeatureSnapshot: serverdata.FeatureSnapshot{Configured: true}, Model: serverdata.TTSModelMiMoV25, Voice: serverdata.TTSVoiceMia},
			DeepSeek:     serverdata.FeatureSnapshot{Configured: true},
		},
		secrets: map[serverdata.SecretKind]string{
			serverdata.SecretVolcengineASR: "speech-key",
			serverdata.SecretMiMoTTS:       "tts-key",
			serverdata.SecretDeepSeek:      "deep-key",
		},
	}
	server := New(Config{ServerData: store})
	response := invokeServerDataHandler(t, server, &connectionState{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-web"}, envelope{
		RequestID: 1,
		Method:    rp.RegistryMethodServerConfigGet,
		Payload:   rp.MustRaw(map[string]any{}),
	})
	if response.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("response=%+v", response)
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"speech-key", "tts-key", "deep-key", `"apiKey"`, `"accessToken"`} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("server config leaked %q: %s", forbidden, encoded)
		}
	}
	if len(store.secretReads) != 0 {
		t.Fatalf("server config read raw secrets: %v", store.secretReads)
	}
}

func TestServerConfigUpdateValidatesSectionFieldAndAction(t *testing.T) {
	store := &fakeServerDataStore{snapshot: serverdata.Snapshot{
		VoiceInput:   serverdata.VoiceInputSnapshot{Model: serverdata.VoiceInputModelDoubaoStreamingASR2},
		TextToSpeech: serverdata.TTSSnapshot{Model: serverdata.TTSModelMiMoV25, Voice: serverdata.TTSVoiceMia},
	}}
	server := New(Config{ServerData: store})
	state := &connectionState{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-web"}
	tests := []rp.ServerConfigUpdatePayload{
		{Section: "unknown", Field: "key", Action: "set", Value: "key"},
		{Section: "voiceInput", Field: "voice", Action: "set", Value: "Mia"},
		{Section: "deepSeek", Field: "key", Action: "clear", Value: "must-reject"},
		{Section: "textToSpeech", Field: "model", Action: "clear"},
		{Section: "deepSeek", Field: "key", Action: "replace", Value: "key"},
	}
	for index, payload := range tests {
		response := invokeServerDataHandler(t, server, state, envelope{RequestID: int64(index + 1), Method: rp.RegistryMethodServerConfigUpdate, Payload: rp.MustRaw(payload)})
		if response.Type != rp.RegistryEnvelopeTypeError || responseErrorCode(t, response) != codeInvalidArgument {
			t.Fatalf("case %d response=%+v", index, response)
		}
	}

	valid := rp.ServerConfigUpdatePayload{Section: "deepSeek", Field: "key", Action: "set", Value: "short"}
	response := invokeServerDataHandler(t, server, state, envelope{RequestID: 20, Method: rp.RegistryMethodServerConfigUpdate, Payload: rp.MustRaw(valid)})
	if response.Type != rp.RegistryEnvelopeTypeResponse {
		t.Fatalf("valid response=%+v", response)
	}
	if len(store.secretUpdates) != 1 || store.secretUpdates[0] != (serverDataSecretUpdate{kind: serverdata.SecretDeepSeek, action: "set", value: "short"}) {
		t.Fatalf("updates=%+v", store.secretUpdates)
	}
}

func TestAndroidSpeechCredentialRequiresAndroidClientName(t *testing.T) {
	store := &fakeServerDataStore{
		snapshot: serverdata.Snapshot{VoiceInput: serverdata.VoiceInputSnapshot{Model: serverdata.VoiceInputModelDoubaoStreamingASR2}},
		secrets:  map[serverdata.SecretKind]string{serverdata.SecretVolcengineASR: "speech-key"},
		versions: map[serverdata.SecretKind]string{serverdata.SecretVolcengineASR: "v1"},
	}
	server := New(Config{ServerData: store})
	states := []*connectionState{
		{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-web"},
		{browserSession: false, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-android"},
		{browserSession: true, role: string(rp.RegistryRoleHub), clientName: "wheelmaker-android"},
	}
	for index, state := range states {
		response := invokeServerDataHandler(t, server, state, envelope{RequestID: int64(index + 1), Method: rp.RegistryMethodServerAndroidSpeechCredentialGet, Payload: rp.MustRaw(map[string]any{})})
		if response.Type != rp.RegistryEnvelopeTypeError || responseErrorCode(t, response) != codeForbidden {
			t.Fatalf("case %d response=%+v", index, response)
		}
	}
	if len(store.secretReads) != 0 {
		t.Fatalf("rejected requests read secrets: %v", store.secretReads)
	}
}

func TestAndroidSpeechCredentialReturnsOnlyVolcengineValue(t *testing.T) {
	store := &fakeServerDataStore{
		snapshot: serverdata.Snapshot{VoiceInput: serverdata.VoiceInputSnapshot{FeatureSnapshot: serverdata.FeatureSnapshot{Configured: true}, Model: serverdata.VoiceInputModelDoubaoStreamingASR2}},
		secrets: map[serverdata.SecretKind]string{
			serverdata.SecretVolcengineASR: "speech-key",
			serverdata.SecretMiMoTTS:       "tts-key",
			serverdata.SecretDeepSeek:      "deep-key",
		},
		versions: map[serverdata.SecretKind]string{serverdata.SecretVolcengineASR: "v1"},
	}
	server := New(Config{ServerData: store})
	response := invokeServerDataHandler(t, server, &connectionState{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-android"}, envelope{
		RequestID: 1,
		Method:    rp.RegistryMethodServerAndroidSpeechCredentialGet,
		Payload:   rp.MustRaw(map[string]any{}),
	})
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	if response.Type != rp.RegistryEnvelopeTypeResponse || !strings.Contains(string(encoded), "speech-key") || !strings.Contains(string(encoded), "v1") {
		t.Fatalf("response=%s", encoded)
	}
	for _, forbidden := range []string{"tts-key", "deep-key"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("credential leaked %q: %s", forbidden, encoded)
		}
	}
	if len(store.secretReads) != 1 || store.secretReads[0] != serverdata.SecretVolcengineASR {
		t.Fatalf("secret reads=%v", store.secretReads)
	}
}

func TestAndroidSpeechCredentialReturnsNotConfiguredWithoutKey(t *testing.T) {
	store := &fakeServerDataStore{
		snapshot: serverdata.Snapshot{VoiceInput: serverdata.VoiceInputSnapshot{Model: serverdata.VoiceInputModelDoubaoStreamingASR2}},
		secrets:  map[serverdata.SecretKind]string{},
		versions: map[serverdata.SecretKind]string{},
	}
	server := New(Config{ServerData: store})
	response := invokeServerDataHandler(t, server, &connectionState{browserSession: true, role: string(rp.RegistryRoleClient), clientName: "wheelmaker-android"}, envelope{
		RequestID: 1,
		Method:    rp.RegistryMethodServerAndroidSpeechCredentialGet,
		Payload:   rp.MustRaw(map[string]any{}),
	})
	if response.Type != rp.RegistryEnvelopeTypeError || responseErrorCode(t, response) != "not_configured" {
		t.Fatalf("response=%+v", response)
	}
}

func TestConnectInitPersistsClientNameForServerDataGate(t *testing.T) {
	server := New(Config{ServerData: &fakeServerDataStore{}})
	tests := []struct {
		name       string
		clientName string
		wantType   string
		wantStored string
	}{
		{name: "android", clientName: "  wheelmaker-android  ", wantType: rp.RegistryEnvelopeTypeResponse, wantStored: "wheelmaker-android"},
		{name: "empty", clientName: "   ", wantType: rp.RegistryEnvelopeTypeError},
		{name: "too long", clientName: strings.Repeat("a", 81), wantType: rp.RegistryEnvelopeTypeError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			writer := &serverDataCaptureWriter{writes: make(chan envelope, 1)}
			peer := newPeerConn(writer, "connect-client-name")
			defer peer.close()
			state := &connectionState{browserSession: true, peer: peer}
			server.handleConnectInit(peer, state, envelope{RequestID: 1, Method: rp.RegistryMethodConnectInit, Payload: rp.MustRaw(rp.ConnectInitPayload{
				ClientName: tt.clientName, ProtocolVersion: rp.DefaultProtocolVersion, Role: string(rp.RegistryRoleClient),
			})})
			response := <-writer.writes
			if response.Type != tt.wantType || state.clientName != tt.wantStored {
				t.Fatalf("response=%+v state.clientName=%q", response, state.clientName)
			}
		})
	}
}
