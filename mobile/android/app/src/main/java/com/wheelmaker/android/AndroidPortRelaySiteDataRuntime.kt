package com.wheelmaker.android

import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import org.json.JSONObject
import java.net.URI
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class AndroidPortRelaySiteDataRuntime(private val webView: WebView) {
    fun clear(relayUrl: String): String {
        val origin = normalizePortRelayOrigin(relayUrl)
            ?: return JSONObject()
                .put("ok", false)
                .put("relayUrl", relayUrl)
                .put("error", "invalid relay URL")
                .toString()

        CookieManager.getInstance().setCookie(
            origin,
            "wm_port_relay=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
        )
        CookieManager.getInstance().flush()
        WebStorage.getInstance().deleteOrigin(origin)
        clearWebViewCache()

        return JSONObject()
            .put("ok", true)
            .put("relayUrl", relayUrl)
            .put("origin", origin)
            .toString()
    }

    fun clearAllForServerSwitch(onComplete: () -> Unit) {
        val clearNativeData = {
            WebStorage.getInstance().deleteAllData()
            webView.clearHistory()
            webView.clearCache(true)
            CookieManager.getInstance().removeAllCookies {
                CookieManager.getInstance().flush()
                webView.post(onComplete)
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            clearNativeData()
        } else {
            webView.post(clearNativeData)
        }
    }

    private fun clearWebViewCache() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            webView.clearCache(true)
            return
        }
        val latch = CountDownLatch(1)
        webView.post {
            try {
                webView.clearCache(true)
            } finally {
                latch.countDown()
            }
        }
        latch.await(2, TimeUnit.SECONDS)
    }

    private fun normalizePortRelayOrigin(relayUrl: String): String? {
        val uri = try {
            URI(relayUrl)
        } catch (_: IllegalArgumentException) {
            return null
        }
        val scheme = uri.scheme?.lowercase(Locale.US)
        if (scheme != "http" && scheme != "https") {
            return null
        }
        val host = uri.host?.lowercase(Locale.US) ?: return null
        if (host.isBlank()) {
            return null
        }
        val displayHost = if (host.contains(':') && !host.startsWith("[")) "[$host]" else host
        val port = if (uri.port > 0) ":${uri.port}" else ""
        return "$scheme://$displayHost$port"
    }
}
