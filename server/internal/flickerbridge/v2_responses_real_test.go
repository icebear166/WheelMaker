package flickerbridge

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestV2ResponsesDeepSeekFlashRealToolAndImageProbe(t *testing.T) {
	if os.Getenv("WHEELMAKER_V2_RESPONSES_REAL_SMOKE") != "1" {
		t.Skip("set WHEELMAKER_V2_RESPONSES_REAL_SMOKE=1 to run the real DeepSeek tool and image probe")
	}
	settings, err := parseProxySettings(nil, environmentMap(os.Environ()))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
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
	for _, model := range ready.Catalog {
		if model.ID == "deepseek-v4-flash-0731" {
			t.Logf("live flash metadata: apiFormat=%s metadata=%v", model.APIFormat, model.Metadata)
		}
	}

	toolFrames, err := worker.Request(ctx, "deepseek-v4-flash-0731", "high", map[string]any{
		"prompt": []any{map[string]any{
			"role": "user",
			"content": []any{map[string]any{
				"type": "text",
				"text": "You must call the read_file function exactly once with path=README.md. Do not answer with text before or instead of the tool call.",
			}},
		}},
		"tools": []any{map[string]any{
			"type":        "function",
			"name":        "read_file",
			"description": "Read a UTF-8 text file.",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{
				"path": map[string]any{"type": "string"},
			}, "required": []string{"path"}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	toolCall := false
	toolFinished := false
	for frame := range toolFrames {
		if frame.Type == "error" {
			t.Fatalf("real tool request failed: %s", frame.Error)
		}
		if frame.Type != "part" {
			continue
		}
		part, err := decodeV3Part(frame.Part)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("real tool part type=%s tool=%s", v2StringValue(part["type"]), v2StringValue(part["toolName"]))
		toolCall = toolCall || v2StringValue(part["type"]) == "tool-call"
		toolFinished = toolFinished || v2StringValue(part["type"]) == "finish"
	}
	if !toolCall || !toolFinished {
		t.Fatalf("real tool request did not produce tool-call and finish: toolCall=%t finish=%t", toolCall, toolFinished)
	}

	imageFrames, err := worker.Request(ctx, "deepseek-v4-flash-0731", "high", map[string]any{
		"prompt": []any{map[string]any{
			"role": "user",
			"content": []any{
				map[string]any{"type": "text", "text": "Describe the attached image in one short sentence."},
				map[string]any{"type": "file", "mediaType": "image/png", "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="},
			},
		}},
	})
	if err != nil {
		t.Logf("real image request was rejected before streaming: %v", err)
		return
	}
	imageFinished := false
	for frame := range imageFrames {
		if frame.Type == "error" {
			t.Logf("real image request returned worker error: %s", frame.Error)
			return
		}
		if frame.Type == "part" {
			part, err := decodeV3Part(frame.Part)
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("real image part type=%s", v2StringValue(part["type"]))
			imageFinished = imageFinished || v2StringValue(part["type"]) == "finish"
		}
	}
	if !imageFinished {
		t.Log("real image request ended without a finish part")
	}
}
