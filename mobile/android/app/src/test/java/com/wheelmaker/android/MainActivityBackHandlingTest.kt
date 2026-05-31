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

    @Test
    fun androidBackRegistersOnBackInvokedCallbackForModernSystemBack() {
        val mainActivity = source

        assertTrue(mainActivity.contains("import android.window.OnBackInvokedCallback"))
        assertTrue(mainActivity.contains("import android.window.OnBackInvokedDispatcher"))
        assertTrue(mainActivity.contains("private var systemBackCallback: OnBackInvokedCallback? = null"))
        assertTrue(mainActivity.contains("registerSystemBackCallback()"))
        assertTrue(mainActivity.contains("unregisterSystemBackCallback()"))
        assertTrue(mainActivity.contains("Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU"))
        assertTrue(mainActivity.contains("OnBackInvokedCallback {"))
        assertTrue(mainActivity.contains("handleSystemBack()"))
        assertTrue(mainActivity.contains("onBackInvokedDispatcher.registerOnBackInvokedCallback("))
        assertTrue(mainActivity.contains("OnBackInvokedDispatcher.PRIORITY_DEFAULT"))
        assertTrue(mainActivity.contains("onBackInvokedDispatcher.unregisterOnBackInvokedCallback"))
    }
}
