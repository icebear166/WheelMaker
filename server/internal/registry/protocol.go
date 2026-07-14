package registry

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"

	rp "github.com/swm8023/wheelmaker/internal/protocol"
)

const (
	codeUnauthorized    = rp.CodeUnauthorized
	codeInvalidArgument = rp.CodeInvalidArgument
	codeForbidden       = rp.CodeForbidden
	codeNotFound        = rp.CodeNotFound
	codeConflict        = rp.CodeConflict
	codeUnavailable     = rp.CodeUnavailable
	codeInternal        = rp.CodeInternal
	codeTimeout         = rp.CodeTimeout
)

type envelope = rp.Envelope

type errorPayload = rp.ErrorPayload

type connectInitPayload = rp.ConnectInitPayload

type connectInitResponsePayload = rp.ConnectInitResponsePayload

type hubReportProjectsPayload = rp.HubReportProjectsPayload

type hubUpdateProjectPayload = rp.HubUpdateProjectPayload

type projectListItem = rp.ProjectListItem

type debugUploadLogPayload = rp.DebugUploadLogPayload

type debugUploadLogResponsePayload = rp.DebugUploadLogResponsePayload

func decodeStrictPayload(raw []byte, out any) error {
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = []byte("{}")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}
		return err
	}
	return nil
}
