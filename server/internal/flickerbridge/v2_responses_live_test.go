package flickerbridge

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestV2ResponsesDeepSeekFlashSmoke(t *testing.T) {
	if os.Getenv("WHEELMAKER_V2_RESPONSES_SMOKE") != "1" {
		t.Skip("set WHEELMAKER_V2_RESPONSES_SMOKE=1 to run the live DeepSeek Responses smoke test")
	}
	settings, err := parseProxySettings(nil, environmentMap(os.Environ()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	worker, err := startWorker(ctx, settings.NodePath, nodeWorkerSource, []string{
		"MYFLICKER_CLI_DIR=" + settings.MyFlickerDir,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	ready, err := worker.Ready(ctx)
	if err != nil {
		t.Fatal(err)
	}
	proxy, err := newProxyServer(settings, worker, ready.Catalog)
	if err != nil {
		t.Fatal(err)
	}
	endpoint := httptest.NewServer(proxy.Handler)
	defer endpoint.Close()

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.URL+"/v1/responses", strings.NewReader(`{
		"model":"deepseek-v4-flash-0731",
		"instructions":"Reply with the requested marker and no extra text.",
		"input":"Reply exactly V2-RESPONSES-OK.",
		"reasoning":{"effort":"high"},
		"max_output_tokens":64,
		"stream":true
	}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !strings.Contains(string(body), `"type":"response.completed"`) || !strings.Contains(string(body), "V2-RESPONSES-OK") {
		t.Fatalf("status = %d, body = %s", response.StatusCode, body)
	}
}

func TestV2ResponsesDeepSeekFlashCodexProviderToolsSmoke(t *testing.T) {
	if os.Getenv("WHEELMAKER_V2_RESPONSES_SMOKE") != "1" {
		t.Skip("set WHEELMAKER_V2_RESPONSES_SMOKE=1 to run the live DeepSeek Codex tool smoke test")
	}
	settings, err := parseProxySettings(nil, environmentMap(os.Environ()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	worker, err := startWorker(ctx, settings.NodePath, nodeWorkerSource, []string{
		"MYFLICKER_CLI_DIR=" + settings.MyFlickerDir,
		"MYFLICKER_WANQING_INTERCEPT=1",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer worker.Close()
	if _, err := worker.Ready(ctx); err != nil {
		t.Fatal(err)
	}

	frames, err := worker.Request(ctx, "deepseek-v4-flash-0731", "high", map[string]any{
		"prompt": []any{map[string]any{
			"role":    "user",
			"content": []any{map[string]any{"type": "text", "text": "inspect the workspace"}},
		}},
		"tools": []any{
			map[string]any{"type": "function", "name": "read", "description": "Read a file", "inputSchema": map[string]any{"type": "object"}},
			map[string]any{"type": "provider", "id": "openai.apply_patch", "args": map[string]any{}},
			map[string]any{"type": "provider", "id": "openai.web_search_preview", "args": map[string]any{"search_context_size": "low"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	finished := false
	probeSeen := false
	for frame := range frames {
		if frame.Type == "error" {
			t.Fatalf("worker rejected Codex provider tools: %s", frame.Error)
		}
		if frame.Type == "probe" {
			probeSeen = true
			if !containsString(frame.Probe.BodyKeys, "tools") {
				t.Fatalf("intercepted request omitted tools: %#v", frame.Probe)
			}
		}
		if frame.Type == "part" {
			part, err := decodeV3Part(frame.Part)
			if err != nil {
				t.Fatal(err)
			}
			finished = finished || v2StringValue(part["type"]) == "finish"
		}
	}
	if !probeSeen || !finished {
		t.Fatalf("provider tool smoke probeSeen=%t finished=%t", probeSeen, finished)
	}
}
