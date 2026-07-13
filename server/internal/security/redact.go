package security

import (
	"reflect"
	"strings"
)

const (
	RedactedValue     = "[redacted]"
	maxRedactionDepth = 16
	maxRedactionNodes = 10_000
)

var redactionAllowlist = map[string]struct{}{
	"accesscodegeneration": {},
	"cachedinputtokens":    {},
	"inputtokens":          {},
	"outputtokens":         {},
	"reasoningtokens":      {},
	"tokencount":           {},
	"totaltokens":          {},
}

var sensitiveKeySuffixes = []string{
	"authorization",
	"credential",
	"accesscode",
	"password",
	"setcookie",
	"appsecret",
	"apikey",
	"cookie",
	"secret",
	"token",
	"nonce",
	"csrf",
}

type redactionState struct {
	nodes int
}

// RedactDiagnosticValue returns a redacted deep copy suitable only for logs and
// diagnostic exports. It deliberately converts composite values to JSON-like
// maps and slices so callers cannot accidentally reuse the result as business
// state.
func RedactDiagnosticValue(value any) any {
	state := &redactionState{}
	return state.redact(reflect.ValueOf(value), 0)
}

func (s *redactionState) redact(value reflect.Value, depth int) any {
	if !value.IsValid() {
		return nil
	}
	if depth > maxRedactionDepth || s.nodes >= maxRedactionNodes {
		return RedactedValue
	}
	s.nodes++

	for value.Kind() == reflect.Interface || value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return nil
		}
		value = value.Elem()
		if depth > maxRedactionDepth || s.nodes >= maxRedactionNodes {
			return RedactedValue
		}
	}

	switch value.Kind() {
	case reflect.Map:
		if value.IsNil() {
			return nil
		}
		output := make(map[string]any, value.Len())
		iterator := value.MapRange()
		for iterator.Next() {
			key := diagnosticKey(iterator.Key())
			if isSensitiveDiagnosticKey(key) {
				output[key] = RedactedValue
				continue
			}
			output[key] = s.redact(iterator.Value(), depth+1)
		}
		return output
	case reflect.Struct:
		output := make(map[string]any, value.NumField())
		typeOfValue := value.Type()
		for index := 0; index < value.NumField(); index++ {
			field := typeOfValue.Field(index)
			if field.PkgPath != "" {
				continue
			}
			key := field.Name
			if tag := strings.Split(field.Tag.Get("json"), ",")[0]; tag != "" {
				if tag == "-" {
					continue
				}
				key = tag
			}
			if isSensitiveDiagnosticKey(key) {
				output[key] = RedactedValue
				continue
			}
			output[key] = s.redact(value.Field(index), depth+1)
		}
		return output
	case reflect.Slice, reflect.Array:
		if value.Kind() == reflect.Slice && value.IsNil() {
			return nil
		}
		output := make([]any, value.Len())
		for index := 0; index < value.Len(); index++ {
			output[index] = s.redact(value.Index(index), depth+1)
		}
		return output
	case reflect.Bool:
		return value.Interface()
	case reflect.String:
		return value.Interface()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return value.Interface()
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return value.Interface()
	case reflect.Float32, reflect.Float64:
		return value.Interface()
	case reflect.Invalid:
		return nil
	default:
		return RedactedValue
	}
}

func diagnosticKey(value reflect.Value) string {
	if value.Kind() == reflect.Interface {
		value = value.Elem()
	}
	if value.Kind() == reflect.String {
		return value.String()
	}
	return "[non-string-key]"
}

func isSensitiveDiagnosticKey(key string) bool {
	normalized := normalizeDiagnosticKey(key)
	if _, allowed := redactionAllowlist[normalized]; allowed {
		return false
	}
	for _, suffix := range sensitiveKeySuffixes {
		if strings.HasSuffix(normalized, suffix) {
			return true
		}
	}
	return false
}

func normalizeDiagnosticKey(key string) string {
	normalized := strings.ToLower(strings.TrimSpace(key))
	replacer := strings.NewReplacer("-", "", "_", "", ".", "")
	return replacer.Replace(normalized)
}
