package registry

import (
	"bytes"
	"fmt"
	"os"
	"strings"

	"github.com/swm8023/wheelmaker/internal/gateway"
	"github.com/swm8023/wheelmaker/internal/portrelay"
)

func newGatewayRelayPortProvider(path string) portrelay.RelayPortProvider {
	path = strings.TrimSpace(path)
	return func() (int, error) {
		if path == "" {
			return 0, portrelay.ErrRelayPortClientManaged
		}
		data, err := os.ReadFile(path)
		if err != nil {
			if os.IsNotExist(err) {
				return 0, portrelay.ErrRelayPortClientManaged
			}
			return 0, fmt.Errorf("read Gateway config %s: %w", path, err)
		}
		global, err := gateway.LoadGlobal(bytes.NewReader(data))
		if err != nil {
			return 0, fmt.Errorf("load Gateway config %s: %w", path, err)
		}
		if err := gateway.ValidateGlobal(global); err != nil {
			return 0, fmt.Errorf("validate Gateway config %s: %w", path, err)
		}
		return global.Relay.ListenPort, nil
	}
}
