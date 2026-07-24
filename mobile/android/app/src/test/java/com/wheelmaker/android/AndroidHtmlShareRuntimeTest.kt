package com.wheelmaker.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class AndroidHtmlShareRuntimeTest {
    private fun source(path: String): String = String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun bridgeAndProviderExposeTemporaryHtmlDocumentSharing() {
        val bridge = source("src/main/java/com/wheelmaker/android/WheelMakerBridge.kt")
        val mainActivity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")
        val providerPaths = source("src/main/res/xml/apk_update_paths.xml")
        val runtime = source("src/main/java/com/wheelmaker/android/AndroidHtmlShareRuntime.kt")

        assertTrue(bridge.contains("private val androidHtmlShareRuntime: AndroidHtmlShareRuntime"))
        assertTrue(bridge.contains("\"html.share.begin\""))
        assertTrue(bridge.contains("\"html.share.chunk\""))
        assertTrue(bridge.contains("\"html.share.commit\""))
        assertTrue(bridge.contains("\"html.share.cancel\""))
        assertTrue(mainActivity.contains("AndroidHtmlShareRuntime(this)"))
        assertTrue(mainActivity.contains("androidHtmlShareRuntime.clear()"))
        assertTrue(providerPaths.contains("html_shares"))
        assertTrue(providerPaths.contains("html-shares/"))
        assertTrue(runtime.contains("text/html"))
        assertTrue(runtime.contains("Intent.ACTION_SEND"))
        assertTrue(runtime.contains("Intent.EXTRA_STREAM"))
        assertTrue(runtime.contains("FileProvider.getUriForFile"))
        assertFalse(runtime.contains("DownloadManager"))
    }
}
