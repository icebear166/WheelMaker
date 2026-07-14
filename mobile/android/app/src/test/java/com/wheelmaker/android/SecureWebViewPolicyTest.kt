package com.wheelmaker.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class SecureWebViewPolicyTest {
    private fun source(path: String): String = String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun manifestDisablesCleartextAndPlatformBackups() {
        val manifest = source("src/main/AndroidManifest.xml")

        assertTrue(manifest.contains("android:usesCleartextTraffic=\"false\""))
        assertTrue(manifest.contains("android:allowBackup=\"false\""))
        assertTrue(manifest.contains("android:fullBackupContent=\"false\""))
    }

    @Test
    fun webViewDisablesDangerousContentAndProductionDebugSurfaces() {
        val activity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")

        assertTrue(activity.contains("target.settings.allowFileAccess = false"))
        assertTrue(activity.contains("target.settings.allowContentAccess = false"))
        assertTrue(activity.contains("target.settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW"))
        assertTrue(activity.contains("target.settings.javaScriptCanOpenWindowsAutomatically = false"))
        assertTrue(activity.contains("setAcceptThirdPartyCookies(target, false)"))
		assertTrue(activity.contains("ApplicationInfo.FLAG_DEBUGGABLE"))
		assertFalse(activity.contains("WebView.setWebContentsDebuggingEnabled(true)"))
        assertTrue(activity.contains("target.setOnKeyListener"))
        assertTrue(activity.contains("event.action == KeyEvent.ACTION_DOWN"))
    }

    @Test
    fun nativeUiRequestsRequireTrustedTopLevel() {
        assertTrue(isTrustedBusinessUiRequest(
            configuredBaseUrl = "https://example.com/app/",
            topLevelUrl = "https://example.com/app/chat"
        ))
        assertFalse(isTrustedBusinessUiRequest(
            configuredBaseUrl = "https://example.com/app/",
            topLevelUrl = "https://evil.example/app/"
        ))
    }
}
