package security

import (
	"errors"
	"net/url"
	"path"
	"strings"
)

var ErrInvalidHTTPSBaseURL = errors.New("invalid HTTPS base URL")

// NormalizeHTTPSBaseURL validates an HTTPS base URL and returns a directory URL.
func NormalizeHTTPSBaseURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.Hostname() == "" || u.User != nil || u.Opaque != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(raw, "#") {
		return nil, ErrInvalidHTTPSBaseURL
	}

	cleanPath := path.Clean("/" + strings.TrimPrefix(u.Path, "/"))
	if cleanPath == "." {
		cleanPath = "/"
	}
	if !strings.HasSuffix(cleanPath, "/") {
		cleanPath += "/"
	}
	u.Path = cleanPath
	u.RawPath = ""
	return u, nil
}
