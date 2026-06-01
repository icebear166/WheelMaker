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
    fun remoteResponsesKeepClientFreshnessHeadersForVolatileAssets() {
        assertEquals(
            "no-cache, must-revalidate",
            responseHeadersForRemoteAsset("index.html", "public, max-age=31536000")["Cache-Control"]
        )
        assertEquals(
            "no-cache, must-revalidate",
            responseHeadersForRemoteAsset("service-worker.js", "public, max-age=31536000")["Cache-Control"]
        )
        assertEquals(
            "no-store",
            responseHeadersForRemoteAsset("web-build.json", "public, max-age=31536000")["Cache-Control"]
        )
        assertEquals(
            "no-store",
            responseHeadersForRemoteAsset("runtime-config.js", "public, max-age=31536000")["Cache-Control"]
        )
    }
}
