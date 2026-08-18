package agent

// CreateDirectoryLink creates a directory link using the platform-native
// representation: a directory Symlink on Unix-like systems and a Junction on
// Windows.
func CreateDirectoryLink(target, link string) error {
	return createDirectoryLink(target, link)
}
