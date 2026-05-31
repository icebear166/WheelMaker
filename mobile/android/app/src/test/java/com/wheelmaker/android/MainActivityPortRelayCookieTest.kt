package com.wheelmaker.android

import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class MainActivityPortRelayCookieTest {
    private val source: String
        get() = String(Files.readAllBytes(
            Paths.get("src/main/java/com/wheelmaker/android/MainActivity.kt")
        ))

    @Test
    fun webViewAcceptsThirdPartyCookiesForEmbeddedPortRelayIframe() {
        val mainActivity = source

        assertTrue(mainActivity.contains("import android.webkit.CookieManager"))
        assertTrue(mainActivity.contains("CookieManager.getInstance().setAcceptCookie(true)"))
        assertTrue(mainActivity.contains("CookieManager.getInstance().setAcceptThirdPartyCookies(target, true)"))
    }
}
