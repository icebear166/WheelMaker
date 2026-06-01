package com.wheelmaker.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StableOriginPathTest {
    @Test
    fun mapsRootToIndexHtml() {
        assertEquals("index.html", assetNameForStablePath("/"))
    }

    @Test
    fun stripsLeadingSlashForAssets() {
        assertEquals("bundle.abc.js", assetNameForStablePath("/bundle.abc.js"))
    }

    @Test
    fun removesParentTraversalSegments() {
        assertEquals("secret.js", assetNameForStablePath("/../secret.js"))
    }

    @Test
    fun treatsWorkspaceRoutesAsIndexFallbackCandidates() {
        assertTrue(isWorkspaceRoute("settings/update"))
        assertFalse(isWorkspaceRoute("bundle.abc.js"))
    }

    @Test
    fun servesBrowserPwaAssetsAsNativeShellStubs() {
        assertTrue(shouldServeNativeShellStubAsset("service-worker.js"))
        assertTrue(shouldServeNativeShellStubAsset("nested/service-worker.js"))
        assertTrue(shouldServeNativeShellStubAsset("manifest.webmanifest"))
        assertTrue(nativeShellStubAsset("service-worker.js")!!.body.contains("disabled"))
        assertTrue(nativeShellStubAsset("manifest.webmanifest")!!.body.contains("\"icons\":[]"))

        assertTrue(shouldBlockStableOriginAsset("ws"))

        assertFalse(shouldServeNativeShellStubAsset("web-build.json"))
        assertFalse(shouldServeNativeShellStubAsset("runtime-config.js"))
        assertFalse(shouldBlockStableOriginAsset("web-build.json"))
        assertFalse(shouldBlockStableOriginAsset("runtime-config.js"))
        assertFalse(shouldBlockStableOriginAsset("bundle.abc123.js"))
    }

    @Test
    fun remoteModeDoesNotUseEmbeddedAssetFallbackCandidates() {
        assertEquals(
            listOf(StableOriginAssetCandidate("remote", "bundle.abc123.js")),
            stableOriginAssetCandidates("bundle.abc123.js", "https://workspace.example.com/")
        )
    }

    @Test
    fun remoteModeFallsBackWorkspaceRoutesToRemoteIndexOnly() {
        assertEquals(
            listOf(
                StableOriginAssetCandidate("remote", "settings/update"),
                StableOriginAssetCandidate("remote", "index.html")
            ),
            stableOriginAssetCandidates("settings/update", "https://workspace.example.com/")
        )
    }

    @Test
    fun embeddedModeKeepsEmbeddedWorkspaceRouteFallback() {
        assertEquals(
            listOf(
                StableOriginAssetCandidate("embedded", "settings/update"),
                StableOriginAssetCandidate("embedded", "index.html")
            ),
            stableOriginAssetCandidates("settings/update", "")
        )
    }

    @Test
    fun remoteResponsesKeepClientFreshnessHeadersForVolatileAssets() {
        assertEquals(
            "no-cache, must-revalidate",
            responseHeadersForRemoteAsset("index.html", "public, max-age=31536000")["Cache-Control"]
        )
        assertEquals(
            "no-cache, must-revalidate",
            responseHeadersForRemoteAsset("settings/update", "public, max-age=31536000")["Cache-Control"]
        )
    }

    @Test
    fun remoteCacheBypassOnlyAppliesToVolatileAssets() {
        assertTrue(shouldBypassRemoteUrlConnectionCache("index.html"))
        assertTrue(shouldBypassRemoteUrlConnectionCache("settings/update"))

        assertFalse(shouldBypassRemoteUrlConnectionCache("bundle.abc123.js"))
        assertFalse(shouldBypassRemoteUrlConnectionCache("bundle.abc123.css"))
        assertFalse(shouldBypassRemoteUrlConnectionCache("font.abc123.woff2"))
        assertFalse(shouldBypassRemoteUrlConnectionCache("codicon.abc123.ttf"))
        assertFalse(shouldBypassRemoteUrlConnectionCache("legacy.abc123.eot"))
        assertFalse(shouldBypassRemoteUrlConnectionCache("asset.abc123.bin"))
    }

    @Test
    fun remoteResponsesKeepStaticAssetsCacheableByDefault() {
        assertEquals(
            "public, max-age=31536000, immutable",
            responseHeadersForRemoteAsset("bundle.abc123.js", "no-store")["Cache-Control"]
        )
        assertEquals(
            "public, max-age=31536000, immutable",
            responseHeadersForRemoteAsset("bundle.abc123.css", "no-store")["Cache-Control"]
        )
        assertEquals(
            "public, max-age=31536000, immutable",
            responseHeadersForRemoteAsset("font.abc123.woff2", "no-store")["Cache-Control"]
        )
        assertEquals(
            "public, max-age=31536000, immutable",
            responseHeadersForRemoteAsset("codicon.abc123.ttf", "no-store")["Cache-Control"]
        )
        assertEquals(
            "public, max-age=31536000, immutable",
            responseHeadersForRemoteAsset("asset.abc123.bin", "no-store")["Cache-Control"]
        )
    }

    @Test
    fun contentTypesCoverFontAssets() {
        assertEquals("font/ttf", contentTypeForAsset("codicon.abc123.ttf"))
        assertEquals("application/vnd.ms-fontobject", contentTypeForAsset("legacy.abc123.eot"))
    }
}
