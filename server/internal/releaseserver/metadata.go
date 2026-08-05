package releaseserver

type stableDocument struct {
	Schema      int             `json:"schema"`
	Version     string          `json:"version"`
	PublishedAt string          `json:"publishedAt"`
	SourceSHA   string          `json:"sourceSha"`
	Deploy      deployPointer   `json:"deploy"`
	Release     manifestPointer `json:"release"`
	Desktop     *desktopPointer `json:"desktopExe,omitempty"`
	Android     *androidPointer `json:"androidApk,omitempty"`
	Gateway     *gatewayPointer `json:"gateway,omitempty"`
}

type deployPointer struct {
	MJSPath    string `json:"mjsPath"`
	MJSSHA256  string `json:"mjsSha256"`
	CorePath   string `json:"corePath"`
	CoreSHA256 string `json:"coreSha256"`
}

type manifestPointer struct {
	ManifestPath   string `json:"manifestPath"`
	ManifestSHA256 string `json:"manifestSha256"`
}

type desktopPointer struct {
	Version string `json:"version"`
	Path    string `json:"path"`
	SHA256  string `json:"sha256"`
}

type androidPointer struct {
	Version     string `json:"version"`
	VersionName string `json:"versionName"`
	VersionCode int    `json:"versionCode"`
	PublishedAt string `json:"publishedAt"`
	SourceSHA   string `json:"sourceSha"`
	Path        string `json:"path"`
	SHA256      string `json:"sha256"`
	Size        int64  `json:"size"`
}

type gatewayPointer struct {
	Version        string `json:"version"`
	SourceSHA      string `json:"sourceSha"`
	ManifestPath   string `json:"manifestPath"`
	ManifestSHA256 string `json:"manifestSha256"`
}

type releaseManifest struct {
	Schema      int                 `json:"schema"`
	Version     string              `json:"version"`
	PublishedAt string              `json:"publishedAt"`
	SourceSHA   string              `json:"sourceSha"`
	Artifacts   map[string]artifact `json:"artifacts"`
	Gateway     *gatewayPointer     `json:"gateway,omitempty"`
}

type gatewayManifest struct {
	Schema      int                 `json:"schema"`
	Version     string              `json:"version"`
	PublishedAt string              `json:"publishedAt"`
	SourceSHA   string              `json:"sourceSha"`
	Path        string              `json:"path"`
	Artifacts   map[string]artifact `json:"artifacts"`
}

type artifact struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type releaseHistory struct {
	Schema   int                   `json:"schema"`
	Releases []releaseHistoryEntry `json:"releases"`
}

type releaseHistoryEntry struct {
	Version        string         `json:"version"`
	PublishedAt    string         `json:"publishedAt"`
	SourceSHA      string         `json:"sourceSha"`
	ManifestSHA256 string         `json:"manifestSha256"`
	Assets         []releaseAsset `json:"assets"`
}

type releaseAsset struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type androidReleaseManifest struct {
	Schema      int    `json:"schema"`
	Platform    string `json:"platform"`
	Version     string `json:"version"`
	VersionName string `json:"versionName"`
	VersionCode int    `json:"versionCode"`
	SourceSHA   string `json:"sourceSha"`
	BuiltAt     string `json:"builtAt"`
	APK         struct {
		FileName string `json:"fileName"`
		SHA256   string `json:"sha256"`
		Size     int64  `json:"size"`
	} `json:"apk"`
	Signing struct {
		CertificateSHA256 []string `json:"certificateSha256"`
	} `json:"signing"`
}
