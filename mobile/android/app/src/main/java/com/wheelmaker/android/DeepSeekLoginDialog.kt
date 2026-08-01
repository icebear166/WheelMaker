package com.wheelmaker.android

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
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
    private var errorView: TextView? = null

    @SuppressLint("SetJavaScriptEnabled")
    fun show() {
        val webView = WebView(activity)
        webView.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(520)
        )
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true

        val errorLabel = TextView(activity).apply {
            textSize = 14f
            setTextColor(Color.RED)
            gravity = Gravity.CENTER
            setBackgroundColor(Color.WHITE)
            visibility = View.GONE
        }
        errorView = errorLabel

        val content = FrameLayout(activity).apply {
            addView(webView, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))
            addView(errorLabel, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))
        }

        webView.webViewClient = object : WebViewClient() {
            @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                if (url?.startsWith(DEEP_SEEK_LOGIN_URL) == true) return false
                showError("Blocked navigation to $url")
                return true
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?,
            ) {
                if (request?.isForMainFrame != true) return
                showError("Page load error: ${error?.description}")
            }

            override fun onReceivedHttpError(
                view: WebView?,
                request: WebResourceRequest?,
                errorResponse: WebResourceResponse?,
            ) {
                if (request?.isForMainFrame != true) return
                showError("HTTP ${errorResponse?.statusCode}: ${errorResponse?.reasonPhrase}")
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                view?.postDelayed({ pollToken(view) }, 1000)
            }
        }
        val dialog = AlertDialog.Builder(activity)
            .setTitle("DeepSeek Login")
            .setView(content)
            .setNegativeButton("Cancel") { _, _ -> finish(null) }
            .setOnCancelListener { finish(null) }
            .create()
        dialog.show()
        dialog.window?.setLayout(dp(340), dp(520))
        webView.loadUrl(DEEP_SEEK_LOGIN_URL)
    }

    private fun showError(message: String) {
        errorView?.apply {
            text = message
            visibility = View.VISIBLE
        }
    }

    private fun dp(value: Int): Int =
        (activity.resources.displayMetrics.density * value).toInt()

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
