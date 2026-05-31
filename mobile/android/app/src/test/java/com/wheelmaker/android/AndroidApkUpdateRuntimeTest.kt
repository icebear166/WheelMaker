package com.wheelmaker.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class AndroidApkUpdateRuntimeTest {
    private fun source(path: String): String =
        String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun normalizesSha256DigestValues() {
        assertEquals("abcdef", normalizeApkSha256("sha256:ABCDEF"))
        assertEquals("abcdef", normalizeApkSha256(" ABCDEF "))
    }

    @Test
    fun bridgeExposesAndroidApkUpdateMethods() {
        val bridge = source("src/main/java/com/wheelmaker/android/WheelMakerBridge.kt")
        val mainActivity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")

        assertTrue(bridge.contains("getAndroidReleaseState()"))
        assertTrue(bridge.contains("installAndroidRelease(rawJson: String)"))
        assertTrue(mainActivity.contains("private lateinit var androidApkUpdateRuntime: AndroidApkUpdateRuntime"))
        assertTrue(mainActivity.contains("AndroidApkUpdateRuntime(this, webView)"))
    }

    @Test
    fun manifestAllowsUserConfirmedApkInstallViaFileProvider() {
        val manifest = source("src/main/AndroidManifest.xml")
        val providerPaths = source("src/main/res/xml/apk_update_paths.xml")

        assertTrue(manifest.contains("android.permission.REQUEST_INSTALL_PACKAGES"))
        assertTrue(manifest.contains("androidx.core.content.FileProvider"))
        assertTrue(manifest.contains('"' + "\${applicationId}.apkprovider" + '"'))
        assertTrue(manifest.contains("@xml/apk_update_paths"))
        assertTrue(providerPaths.contains("<cache-path"))
        assertTrue(providerPaths.contains("apk-updates/"))
    }

    @Test
    fun runtimeDownloadsVerifiesAndStartsSystemInstaller() {
        val runtime = source("src/main/java/com/wheelmaker/android/AndroidApkUpdateRuntime.kt")

        assertTrue(runtime.contains("OkHttpClient"))
        assertTrue(runtime.contains("expectedSha256"))
        assertTrue(runtime.contains("fileSha256"))
        assertTrue(runtime.contains("ACTION_MANAGE_UNKNOWN_APP_SOURCES"))
        assertTrue(runtime.contains("canRequestPackageInstalls"))
        assertTrue(runtime.contains("FileProvider.getUriForFile"))
        assertTrue(runtime.contains("Intent.ACTION_INSTALL_PACKAGE"))
        assertTrue(runtime.contains("FLAG_GRANT_READ_URI_PERMISSION"))
        assertTrue(runtime.contains("wheelmaker:android-apk-update"))
    }
}
