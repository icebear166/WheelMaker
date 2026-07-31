package com.wheelmaker.android

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.webkit.WebView
import android.webkit.WebViewClient
import java.util.concurrent.atomic.AtomicBoolean

internal const val DEEP_SEEK_LOGIN_URL = "https://platform.deepseek.com"
internal const val DEEP_SEEK_TOKEN_SCRIPT = """
  (() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (!/token/i.test(key)) continue;
      const raw = String(localStorage.getItem(key) || '');
      const match = raw.match(/[A-Za-z0-9._~+/=-]{20,}/);
      if (match) return match[0];
    }
    return '';
  })()
"""

internal fun extractDeepSeekToken(result: String): String? {
    var value = result.trim().trim('"')
    if (value.startsWith("Bearer ")) value = value.removePrefix("Bearer ")
    if (value.length < 20 || value.length > 4096) return null
    if (value.any { it.isWhitespace() }) return null
    return value
}

class DeepSeekLoginDialog(
    private val activity: Activity,
    private val onResult: (token: String?) -> Unit,
) {
    private val finished = AtomicBoolean(false)

    @SuppressLint("SetJavaScriptEnabled")
    fun show() {
        val webView = WebView(activity)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return url?.startsWith(DEEP_SEEK_LOGIN_URL) != true
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                view?.postDelayed({ pollToken(view) }, 1000)
            }
        }
        val dialog = AlertDialog.Builder(activity)
            .setTitle("DeepSeek Login")
            .setView(webView)
            .setNegativeButton("Cancel") { _, _ -> finish(null) }
            .setOnCancelListener { finish(null) }
            .create()
        webView.loadUrl(DEEP_SEEK_LOGIN_URL)
        dialog.show()
    }

    private fun pollToken(view: WebView) {
        if (finished.get()) return
        view.evaluateJavascript(DEEP_SEEK_TOKEN_SCRIPT) { result ->
            val token = extractDeepSeekToken(result ?: "")
            if (token != null) {
                finish(token)
            } else {
                view.postDelayed({ pollToken(view) }, 1000)
            }
        }
    }

    private fun finish(token: String?) {
        if (!finished.compareAndSet(false, true)) return
        onResult(token)
    }
}
