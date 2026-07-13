package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/swm8023/wheelmaker/internal/security"
)

func normalizeDesktopBaseURL(raw string) (string, error) {
	if !strings.Contains(strings.TrimSpace(raw), "://") {
		raw = "https://" + raw
	}
	baseURL, err := security.NormalizeHTTPSBaseURL(raw)
	if err != nil {
		return "", err
	}
	return baseURL.String(), nil
}

type httpDesktopBaseURLProber struct {
	client *http.Client
}

func newDefaultDesktopBaseURLProber() *httpDesktopBaseURLProber {
	return &httpDesktopBaseURLProber{client: newDesktopProbeHTTPClient()}
}

func newDesktopProbeHTTPClient() *http.Client {
	return &http.Client{
		Timeout: 3 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req.URL.Scheme != "https" {
				return fmt.Errorf("redirect downgrade to %s is not allowed", req.URL.Scheme)
			}
			if len(via) > 5 {
				return errors.New("too many redirects")
			}
			return nil
		},
	}
}

func (p *httpDesktopBaseURLProber) Probe(ctx context.Context, baseURL string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "WheelMakerDesktop/remote-shell")
	response, err := p.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("server returned HTTP %d", response.StatusCode)
	}
	return nil
}
