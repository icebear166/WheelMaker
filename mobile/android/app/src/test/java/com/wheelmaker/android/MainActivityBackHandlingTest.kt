package com.wheelmaker.android

import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class MainActivityBackHandlingTest {
    private val source: String
        get() = String(Files.readAllBytes(
            Paths.get("src/main/java/com/wheelmaker/android/MainActivity.kt")
        ))

    @Test
    fun androidBackAsksWebBeforeFallingBackToWebViewHistoryOrActivityExit() {
        val mainActivity = source

        assertTrue(mainActivity.contains("private const val ANDROID_BACK_SCRIPT"))
        assertTrue(mainActivity.contains("window.WheelMakerAndroidBack"))
        assertTrue(mainActivity.contains("handleBack"))
        assertTrue(mainActivity.contains("webView.evaluateJavascript(ANDROID_BACK_SCRIPT)"))
        assertTrue(mainActivity.contains("if (consumed) {"))
        assertTrue(mainActivity.contains("performDefaultBackNavigation()"))
        assertTrue(mainActivity.contains("private fun performDefaultBackNavigation()"))
        assertTrue(mainActivity.contains("if (webView.canGoBack())"))
        assertTrue(mainActivity.contains("webView.goBack()"))
        assertTrue(mainActivity.contains("super.onBackPressed()"))
    }
}
