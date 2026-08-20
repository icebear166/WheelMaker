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
import org.json.JSONObject
import org.json.JSONTokener
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

internal const val QWEN_LOGIN_URL = "https://bailian.console.aliyun.com/"
internal const val QWEN_LOGIN_TIMEOUT_MS = 10 * 60 * 1000L
private const val QWEN_LOGIN_DOMESTIC_ORIGIN = "https://bailian.console.aliyun.com"
private const val QWEN_CALLBACK_MAX_BODY = 64 * 1024
private val QWEN_LOGIN_HOSTS = setOf(
    "bailian.console.aliyun.com",
    "modelstudio.console.alibabacloud.com",
    "account.aliyun.com",
    "passport.aliyun.com",
    "login.aliyun.com",
)

internal fun extractQwenOAuth(result: String): String? {
    val decoded = try {
        JSONTokener(result).nextValue()?.toString() ?: result
    } catch (_: Exception) {
        result.trim().trim('"')
    }
    if (decoded.isBlank() || decoded.length > 16 * 1024) return null
    return try {
        val json = JSONObject(decoded)
        val token = json.optString("accessToken")
        if (token.isBlank() || token.length > 4096 || token.any { it.isWhitespace() }) null else json.toString()
    } catch (_: Exception) {
        null
    }
}

internal fun qwenCallbackCredential(
    target: String,
    contentType: String,
    body: String,
    expectedState: String,
): String? {
    if (queryParameter(target, "state") != expectedState) return null
    val json = if (contentType.lowercase().contains("application/json") || body.trimStart().startsWith("{")) {
        try { JSONObject(body) } catch (_: Exception) { null }
    } else {
        null
    }
    val form = if (json == null) parseForm(body) else emptyMap()
    fun field(vararg names: String): String? {
        names.forEach { name ->
            queryParameter(target, name)?.takeIf { it.isNotBlank() }?.let { return it }
        }
        json?.let { findJsonString(it, *names)?.let { value -> return value } }
        names.forEach { name -> form[name]?.takeIf { it.isNotBlank() }?.let { return it } }
        return null
    }

    val accessToken = field("access_token", "accessToken")?.trim()
    if (accessToken.isNullOrBlank() || accessToken.length > 4096 || accessToken.any { it.isWhitespace() }) return null
    val credential = JSONObject().put("accessToken", accessToken)
    field("refresh_token", "refreshToken")?.trim()?.takeIf { it.length <= 4096 && it.none { character -> character.isWhitespace() } }?.let {
        credential.put("refreshToken", it)
    }
    field("expires_at", "expiresAt")?.trim()?.takeIf { it.length <= 128 }?.let {
        credential.put("expiresAt", it)
    }
    field("console_region", "consoleRegion", "region")?.trim()?.takeIf { it.length <= 128 }?.let {
        credential.put("region", it)
    }
    field("console_site", "consoleSite", "site")?.trim()?.takeIf { it.length <= 64 }?.let {
        credential.put("site", it)
    }
    return extractQwenOAuth(credential.toString())
}

private fun findJsonString(json: JSONObject, vararg names: String): String? {
    names.forEach { name ->
        json.optString(name).trim().takeIf { it.isNotBlank() }?.let { return it }
    }
    val data = json.optJSONObject("data") ?: return null
    names.forEach { name ->
        data.optString(name).trim().takeIf { it.isNotBlank() }?.let { return it }
    }
    return null
}

private fun parseForm(raw: String): Map<String, String> {
    if (raw.isBlank()) return emptyMap()
    return raw.split('&').mapNotNull { part ->
        val separator = part.indexOf('=')
        val rawKey = if (separator >= 0) part.substring(0, separator) else part
        val rawValue = if (separator >= 0) part.substring(separator + 1) else ""
        try {
            URLDecoder.decode(rawKey, "UTF-8") to URLDecoder.decode(rawValue, "UTF-8")
        } catch (_: Exception) {
            null
        }
    }.toMap()
}

private fun queryParameter(target: String, name: String): String? {
    val query = target.substringAfter('?', "")
    return query.split('&').firstNotNullOfOrNull { part ->
        val separator = part.indexOf('=')
        val rawKey = if (separator >= 0) part.substring(0, separator) else part
        if (rawKey != name) return@firstNotNullOfOrNull null
        val rawValue = if (separator >= 0) part.substring(separator + 1) else ""
        try { URLDecoder.decode(rawValue, "UTF-8") } catch (_: Exception) { null }
    }
}

internal fun isQwenLoginUrl(rawUrl: String?): Boolean {
    val parsed = try { URI(rawUrl ?: "") } catch (_: Exception) { return false }
    val host = parsed.host?.lowercase() ?: return false
    return parsed.scheme.equals("https", true) && (parsed.port == -1 || parsed.port == 443) && host in QWEN_LOGIN_HOSTS
}

private class QwenLoginCallbackServer(
    private val expectedState: String,
    private val onCredential: (String) -> Unit,
) {
    private val closed = AtomicBoolean(false)
    private val delivered = AtomicBoolean(false)
    private val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val port: Int = socket.localPort

    fun start() {
        thread(start = true, isDaemon = true, name = "wheelmaker-qwen-login-callback") {
            while (!closed.get()) {
                try {
                    socket.accept().use { connection -> handle(connection) }
                } catch (_: Exception) {
                    if (closed.get()) return@thread
                }
            }
        }
    }

    fun close() {
        if (closed.compareAndSet(false, true)) socket.close()
    }

    private fun handle(connection: java.net.Socket) {
        val reader = BufferedReader(InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))
        val requestLine = reader.readLine() ?: return
        val headers = mutableMapOf<String, String>()
        while (true) {
            val line = reader.readLine() ?: return
            if (line.isEmpty()) break
            val separator = line.indexOf(':')
            if (separator > 0) headers[line.substring(0, separator).lowercase()] = line.substring(separator + 1).trim()
        }
        val parts = requestLine.split(' ')
        if (parts.firstOrNull().equals("OPTIONS", true)) {
            writeResponse(connection, 204, "")
            return
        }
        val target = parts.getOrNull(1) ?: run {
            writeResponse(connection, 400, "bad request")
            return
        }
        val length = headers["content-length"]?.toIntOrNull() ?: 0
        if (length < 0 || length > QWEN_CALLBACK_MAX_BODY) {
            writeResponse(connection, 413, "payload too large")
            return
        }
        val body = CharArray(length)
        var offset = 0
        while (offset < length) {
            val read = reader.read(body, offset, length - offset)
            if (read <= 0) break
            offset += read
        }
        val credential = qwenCallbackCredential(
            target,
            headers["content-type"].orEmpty(),
            body.concatToString(0, offset),
            expectedState,
        )
        if (credential == null) {
            writeResponse(connection, 400, "missing OAuth credential")
            return
        }
        writeResponse(connection, 200, "OK")
        if (delivered.compareAndSet(false, true)) {
            onCredential(credential)
            close()
        }
    }

    private fun writeResponse(connection: java.net.Socket, status: Int, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        val reason = when (status) {
            200 -> "OK"
            204 -> "No Content"
            413 -> "Payload Too Large"
            else -> "Bad Request"
        }
        val response = "HTTP/1.1 $status $reason\r\n" +
            "Access-Control-Allow-Origin: *\r\n" +
            "Access-Control-Allow-Methods: GET, POST, PUT, PATCH, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: Content-Type\r\n" +
            "Content-Type: text/plain; charset=utf-8\r\n" +
            "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        connection.getOutputStream().use { output ->
            output.write(response.toByteArray(StandardCharsets.UTF_8))
            output.write(bytes)
            output.flush()
        }
    }
}

class QwenLoginDialog(
    private val activity: Activity,
    private val onResult: (credentialJson: String?) -> Unit,
) {
    private val finished = AtomicBoolean(false)
    private var dialog: Dialog? = null
    private var callbackServer: QwenLoginCallbackServer? = null
    private var webView: WebView? = null
    private var progressView: View? = null
    private var errorLabel: TextView? = null
    private var errorView: View? = null
    private var timeoutRunnable: Runnable? = null

    @SuppressLint("SetJavaScriptEnabled")
    fun show() {
        val state = UUID.randomUUID().toString().replace("-", "")
        val callback = try {
            QwenLoginCallbackServer(state) { credential ->
                activity.runOnUiThread { finish(credential) }
            }
        } catch (_: Exception) {
            onResult(null)
            return
        }
        callbackServer = callback
        callback.start()

        val dialog = Dialog(activity)
        this.dialog = dialog
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val titleView = TextView(activity).apply {
            text = "Qwen / Bailian Login"
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
                dp(56),
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
                web.loadUrl(qwenLoginUrl(callback.port, state))
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
                ViewGroup.LayoutParams.MATCH_PARENT,
            ))
            addView(errorContainer, FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ))
        }

        web.webViewClient = object : WebViewClient() {
            @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
                handleNavigation(url, callback.port)

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
                handleNavigation(request?.url?.toString(), callback.port)

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
        val timeout = Runnable { finish(null) }
        timeoutRunnable = timeout
        web.postDelayed(timeout, QWEN_LOGIN_TIMEOUT_MS)
        web.loadUrl(qwenLoginUrl(callback.port, state))
    }

    private fun handleNavigation(rawUrl: String?, port: Int): Boolean {
        if (isQwenLoginUrl(rawUrl) || isQwenCallbackUrl(rawUrl, port)) return false
        showError("Blocked navigation to $rawUrl")
        return true
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

    private fun isQwenCallbackUrl(rawUrl: String?, port: Int): Boolean {
        val parsed = try { URI(rawUrl ?: "") } catch (_: Exception) { return false }
        return parsed.scheme.equals("http", true) &&
            (parsed.host == "127.0.0.1" || parsed.host == "localhost") && parsed.port == port
    }

    private fun qwenLoginUrl(port: Int, state: String): String =
        "${QWEN_LOGIN_DOMESTIC_ORIGIN}/console-login?notice=127.0.0.1:${port}?state=${state}"

    private fun finish(credential: String?) {
        if (!finished.compareAndSet(false, true)) return
        timeoutRunnable?.let { webView?.removeCallbacks(it) }
        callbackServer?.close()
        dialog?.dismiss()
        onResult(credential)
    }
}
