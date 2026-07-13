package main

import "github.com/swm8023/wheelmaker/internal/security"

func normalizeDesktopBaseURL(raw string) (string, error) {
	baseURL, err := security.NormalizeHTTPSBaseURL(raw)
	if err != nil {
		return "", err
	}
	return baseURL.String(), nil
}
