package shared

// AcquireFileLock serializes a cross-process critical section using the same
// platform-specific file lock used by the configuration store.
func AcquireFileLock(path string) (func(), error) {
	return acquireConfigFileLock(path)
}
