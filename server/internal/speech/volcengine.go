package speech

import "context"

const ErrorCodeUnavailable = "unavailable"

type AudioConfig struct {
	Format  string
	Codec   string
	Rate    int
	Bits    int
	Channel int
}

type Events interface {
	Transcript(text string, final bool)
	Error(code, message string, retryable bool)
}

type Stream interface {
	WriteAudio(context.Context, []byte) error
	Finish(context.Context) error
	Cancel()
}

type Provider interface {
	Start(context.Context, string, AudioConfig, Events) (Stream, error)
}
