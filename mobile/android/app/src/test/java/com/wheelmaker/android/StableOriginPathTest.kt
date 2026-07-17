package com.wheelmaker.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class StableOriginPathTest {
    private fun source(path: String): String = String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun appassetsOriginServesOnlyTheLocalBootstrap() {
        assertTrue(ANDROID_BOOTSTRAP_URL.endsWith("/assets/bootstrap/index.html"))

        val client = source("src/main/java/com/wheelmaker/android/StableOriginWebViewClient.kt")
        assertTrue(client.contains("WebViewAssetLoader"))
        assertTrue(client.contains("ANDROID_BOOTSTRAP_URL"))
        assertFalse(client.contains("HttpURLConnection"))
        assertFalse(client.contains("remoteResponse"))
        assertFalse(client.contains("stableOriginAssetCandidates"))
    }

    @Test
    fun businessPagesLoadConfiguredBaseUrlDirectly() {
        val activity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")
        assertTrue(activity.contains("target.loadUrl(configuredBaseUrl)"))
        assertFalse(activity.contains("WebSourceRuntime"))
        assertFalse(activity.contains("ANDROID_APP_ORIGIN"))
		assertFalse(activity.contains("MIXED_CONTENT_ALWAYS_" + "ALLOW"))
		assertFalse(activity.contains("allowFileAccess" + " = true"))
    }

    @Test
    fun sourceModesAndWorkspaceProxyAreRemoved() {
        assertFalse(Files.exists(Paths.get("src/main/java/com/wheelmaker/android/WebSourceModels.kt")))
        assertFalse(Files.exists(Paths.get("src/main/java/com/wheelmaker/android/WebSourceRuntime.kt")))
        assertFalse(Files.exists(Paths.get("src/test/java/com/wheelmaker/android/WebSourceRuntimeTest.kt")))

        assertFalse(Files.exists(Paths.get("../../../scripts/publish_android.ps1")))
        val publish = source("../../../scripts/release/android.mjs")
        assertTrue(publish.contains("'wheelmaker-desktop'"))
        assertTrue(publish.contains("'bootstrap'"))
        assertTrue(publish.contains("join(assetsRoot, 'bootstrap', 'index.html')"))
        assertFalse(publish.contains("WHEELMAKER_WEB_TARGET"))
        assertFalse(publish.contains("npm run build:web"))
    }
}
