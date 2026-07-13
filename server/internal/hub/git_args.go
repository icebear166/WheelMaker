package hub

import (
	"errors"
	"strings"
)

const maxGitRevisionBytes = 1024

var errInvalidGitRevision = errors.New("invalid git revision")

func validateGitRevision(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maxGitRevisionBytes || strings.HasPrefix(value, "-") || strings.ContainsAny(value, "\x00\r\n") {
		return "", errInvalidGitRevision
	}
	return value, nil
}

func gitRevisionArgs(values ...string) ([]string, error) {
	args := make([]string, 1, len(values)+1)
	args[0] = "--end-of-options"
	for _, value := range values {
		validated, err := validateGitRevision(value)
		if err != nil {
			return nil, err
		}
		args = append(args, validated)
	}
	return args, nil
}

func gitRevisionRangeArg(base string, head string) (string, error) {
	base, err := validateGitRevision(base)
	if err != nil {
		return "", err
	}
	head, err = validateGitRevision(head)
	if err != nil {
		return "", err
	}
	return base + ".." + head, nil
}
