package com.wheelmaker.android

import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class MainActivityPortRelayCookieTest {
    private fun source(path: String): String =
        String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun webViewAcceptsThirdPartyCookiesForEmbeddedPortRelayIframe() {
        val mainActivity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")

        assertTrue(mainActivity.contains("import android.webkit.CookieManager"))
        assertTrue(mainActivity.contains("CookieManager.getInstance().setAcceptCookie(true)"))
        assertTrue(mainActivity.contains("CookieManager.getInstance().setAcceptThirdPartyCookies(target, true)"))
    }

    @Test
    fun nativeBridgeClearsOnlyPortRelaySiteDataWithoutGlobalCookieRemoval() {
        val mainActivity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")
        val bridge = source("src/main/java/com/wheelmaker/android/WheelMakerBridge.kt")

        assertTrue(mainActivity.contains("private lateinit var androidPortRelaySiteDataRuntime: AndroidPortRelaySiteDataRuntime"))
        assertTrue(mainActivity.contains("AndroidPortRelaySiteDataRuntime(webView)"))
        assertTrue(bridge.contains("\"relay.clearSiteData\""))
        assertTrue(bridge.contains("androidPortRelaySiteDataRuntime.clear("))
    }

    @Test
    fun nativeCapabilitiesUseOriginRestrictedWebMessageListeners() {
        val mainActivity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")
        val bridge = source("src/main/java/com/wheelmaker/android/WheelMakerBridge.kt")

        assertTrue(mainActivity.contains("WebViewCompat.addWebMessageListener"))
        assertTrue(mainActivity.contains("BOOTSTRAP_MESSAGE_LISTENER"))
        assertTrue(mainActivity.contains("BUSINESS_MESSAGE_LISTENER"))
        assertTrue(mainActivity.contains("WebViewCompat.removeWebMessageListener"))
        assertFalse(mainActivity.contains("addJava" + "scriptInterface"))
        assertFalse(bridge.contains("@Java" + "scriptInterface"))
    }
}
