package tts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	mimoEndpoint          = "https://token-plan-cn.xiaomimimo.com/v1/chat/completions"
	maxTextBytes          = 16 * 1024
	maxResponseBytes      = 16 * 1024 * 1024
	maxErrorBodyBytes     = 4 * 1024
	defaultRequestTimeout = 45 * time.Second
)

var (
	ErrInvalidRequest = errors.New("invalid TTS request")
	ErrUnavailable    = errors.New("TTS upstream unavailable")
)

type Request struct {
	APIKey string
	Model  string
	Voice  string
	Text   string
}

type Response struct {
	AudioBase64 string
	Format      string
}

type Client interface {
	Synthesize(context.Context, Request) (Response, error)
}

type clientImpl struct {
	endpoint string
	http     *http.Client
	timeout  time.Duration
}

func NewClient() Client {
	return &clientImpl{
		endpoint: mimoEndpoint,
		http:     &http.Client{Timeout: defaultRequestTimeout},
		timeout:  defaultRequestTimeout,
	}
}

func Validate(request Request) error {
	if request.APIKey == "" {
		return fmt.Errorf("%w: API key is required", ErrInvalidRequest)
	}
	if !validModel(strings.TrimSpace(request.Model)) {
		return fmt.Errorf("%w: unsupported model", ErrInvalidRequest)
	}
	if !validVoice(strings.TrimSpace(request.Voice)) {
		return fmt.Errorf("%w: unsupported voice", ErrInvalidRequest)
	}
	text := strings.TrimSpace(request.Text)
	if text == "" || len([]byte(text)) > maxTextBytes {
		return fmt.Errorf("%w: text must be between 1 byte and 16 KiB", ErrInvalidRequest)
	}
	return nil
}

func (c *clientImpl) Synthesize(ctx context.Context, request Request) (Response, error) {
	if err := Validate(request); err != nil {
		return Response{}, err
	}
	request.Model = strings.TrimSpace(request.Model)
	request.Voice = strings.TrimSpace(request.Voice)
	request.Text = strings.TrimSpace(request.Text)
	body, err := json.Marshal(map[string]any{
		"model": request.Model,
		"messages": []map[string]string{
			{"role": "user", "content": "请朗读以下文本"},
			{"role": "assistant", "content": request.Text},
		},
		"modalities": []string{"text", "audio"},
		"audio":      map[string]string{"voice": request.Voice, "format": "wav"},
	})
	if err != nil {
		return Response{}, fmt.Errorf("encode request: %w", err)
	}
	requestContext, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	httpRequest, err := http.NewRequestWithContext(requestContext, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return Response{}, fmt.Errorf("create request: %w", err)
	}
	httpRequest.Header.Set("Authorization", "Bearer "+request.APIKey)
	httpRequest.Header.Set("Content-Type", "application/json; charset=utf-8")
	request.APIKey = ""
	response, err := c.http.Do(httpRequest)
	if err != nil {
		return Response{}, fmt.Errorf("%w: request failed", ErrUnavailable)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.ReadAll(io.LimitReader(response.Body, maxErrorBodyBytes))
		return Response{}, fmt.Errorf("%w: HTTP %d", ErrUnavailable, response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return Response{}, fmt.Errorf("%w: response read failed", ErrUnavailable)
	}
	if len(raw) > maxResponseBytes {
		return Response{}, fmt.Errorf("%w: response is too large", ErrUnavailable)
	}
	var decoded struct {
		Choices []struct {
			Message struct {
				Audio struct {
					Data string `json:"data"`
				} `json:"audio"`
			} `json:"message"`
		} `json:"choices"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if err := decoder.Decode(&decoded); err != nil || len(decoded.Choices) == 0 || strings.TrimSpace(decoded.Choices[0].Message.Audio.Data) == "" {
		return Response{}, fmt.Errorf("%w: response contains no audio data", ErrUnavailable)
	}
	return Response{AudioBase64: decoded.Choices[0].Message.Audio.Data, Format: "wav"}, nil
}

func validModel(value string) bool {
	switch value {
	case "mimo-v2-tts", "mimo-v2.5-tts", "mimo-v2.5-tts-voiceclone", "mimo-v2.5-tts-voicedesign":
		return true
	default:
		return false
	}
}

func validVoice(value string) bool {
	switch value {
	case "mimo_default", "冰糖", "茉莉", "苏打", "白桦", "Mia", "Chloe", "Milo", "Dean":
		return true
	default:
		return false
	}
}
