package com.wheelmaker.android

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import java.util.concurrent.atomic.AtomicBoolean

internal const val DEEP_SEEK_LOGIN_URL = "https://platform.deepseek.com"
internal const val DEEP_SEEK_TOKEN_SCRIPT = """
  (() => {
    try {
      const raw = localStorage.getItem('userToken');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      const token = parsed && typeof parsed.value === 'string' ? parsed.value : '';
      return /^[A-Za-z0-9._~+/=-]{20,4096}$/.test(token) ? token : '';
    } catch (_) {
      return '';
    }
  })()
"""

internal const val DEEP_SEEK_LOGIN_TIMEOUT_MS = 10 * 60 * 1000L

internal fun extractDeepSeekToken(result: String): String? {
    var value = result.trim().trim('"')
    if (value.startsWith("Bearer ")) value = value.removePrefix("Bearer ")
    if (value.length < 20 || value.length > 4096) return null
    if (value.any { it.isWhitespace() }) return null
    return value
}

// DeepSeekLoginDialog presents the official platform login as a full-screen
// in-app screen (app bar + progress + error retry), not a floating system
// dialog. The WebView uses the wide viewport so the platform page renders with
// its responsive layout instead of a desktop-width miniature.
class DeepSeekLoginDialog(
    private val activity: Activity,
    private val onResult: (token: String?) -> Unit,
) {
    private val finished = AtomicBoolean(false)
    private var dialog: Dialog? = null
    private var webView: WebView? = null
    private var progressView: View? = null
    private var errorLabel: TextView? = null
    private var errorView: View? = null

    @SuppressLint("SetJavaScriptEnabled")
    fun show() {
        val dialog = Dialog(activity)
        this.dialog = dialog
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)

        val titleView = TextView(activity).apply {
            text = "DeepSeek Login"
            setTextColor(Color.WHITE)
            textSize = 16f
            gravity = Gravity.CENTER_VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f)
        }
        val closeButton = ImageButton(activity).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            setColorFilter(Color.WHITE)
            setBackgroundColor(Color.TRANSPARENT)
            contentDescription = "Close"
            setOnClickListener { finish(null) }
        }
        val appBar = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.rgb(0x1b, 0x1b, 0x1b))
            setPadding(dp(16), 0, dp(8), 0)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(56)
            )
            addView(titleView)
            addView(closeButton, LinearLayout.LayoutParams(dp(40), dp(40)))
        }

        val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            isIndeterminate = true
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3))
        }
        progressView = progress

        val web = WebView(activity)
        webView = web
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.useWideViewPort = true
        web.settings.loadWithOverviewMode = true

        val errorText = TextView(activity).apply {
            textSize = 14f
            setTextColor(Color.rgb(0xb0, 0x30, 0x30))
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(24), dp(24), dp(24))
        }
        errorLabel = errorText
        val retryButton = Button(activity).apply {
            text = "Retry"
            setOnClickListener {
                errorView?.visibility = View.GONE
                web.visibility = View.VISIBLE
                progressView?.visibility = View.VISIBLE
                web.loadUrl(DEEP_SEEK_LOGIN_URL)
            }
        }
        val errorContainer = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.WHITE)
            visibility = View.GONE
            addView(errorText)
            addView(retryButton)
        }
        errorView = errorContainer

        val content = FrameLayout(activity).apply {
            addView(web, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))
            addView(errorContainer, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            ))
        }

        web.webViewClient = object : WebViewClient() {
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
                progressView?.visibility = View.GONE
                view?.postDelayed({ pollToken(view) }, 1000)
            }
        }

        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            addView(appBar)
            addView(progress)
            addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }

        dialog.setContentView(root)
        dialog.setOnCancelListener { finish(null) }
        dialog.show()
        dialog.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        web.postDelayed({ finish(null) }, DEEP_SEEK_LOGIN_TIMEOUT_MS)
        web.loadUrl(DEEP_SEEK_LOGIN_URL)
    }

    private fun showError(message: String) {
        if (finished.get()) return
        progressView?.visibility = View.GONE
        webView?.visibility = View.GONE
        errorLabel?.text = message
        errorView?.visibility = View.VISIBLE
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
        dialog?.dismiss()
        onResult(token)
    }
}
