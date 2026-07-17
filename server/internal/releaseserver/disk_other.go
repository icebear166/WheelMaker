//go:build !linux

package releaseserver

import "errors"

func availableDiskBytes(string) (uint64, error) {
	return 0, errors.New("release server disk checks require Linux")
}
