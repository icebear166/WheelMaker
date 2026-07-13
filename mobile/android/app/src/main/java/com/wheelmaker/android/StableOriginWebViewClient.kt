package com.wheelmaker.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.http.SslError
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream

open class StableOriginWebViewClient(
    private val context: Context,
    private val configuredBaseUrl: () -> String,
    private val onRemoteFailure: (String) -> Unit
) : WebViewClient() {
    private val assetLoader = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val rawUrl = request.url?.toString().orEmpty()
        if (rawUrl == ANDROID_BOOTSTRAP_URL) {
            return assetLoader.shouldInterceptRequest(request.url)
        }
        if (request.url?.host == "appassets.androidplatform.net") {
            return WebResourceResponse(
                "text/plain",
                "utf-8",
                404,
                "Not Found",
                mapOf("Cache-Control" to "no-store"),
                ByteArrayInputStream("not found".toByteArray())
            )
        }
        return null
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val rawUrl = request.url?.toString().orEmpty()
        if (request.isForMainFrame && rawUrl == ANDROID_BOOTSTRAP_URL) return false
        val baseUrl = configuredBaseUrl()
        if (baseUrl.isBlank()) return true
        return when (BaseUrlPolicy(baseUrl).decide(rawUrl, request.isForMainFrame)) {
            NavigationDecision.ALLOW -> false
            NavigationDecision.EXTERNAL -> {
                openExternal(rawUrl)
                true
            }
            NavigationDecision.BLOCK -> true
        }
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
        if (isConfiguredRemote(error.url)) {
            onRemoteFailure("The server certificate is not trusted.")
        }
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        super.onReceivedError(view, request, error)
        if (request.isForMainFrame && isConfiguredRemote(request.url?.toString().orEmpty())) {
            onRemoteFailure("The secure server could not be loaded.")
        }
    }

    private fun isConfiguredRemote(rawUrl: String): Boolean {
        val baseUrl = configuredBaseUrl()
        return baseUrl.isNotBlank() && BaseUrlPolicy(baseUrl).contains(rawUrl)
    }

    private fun openExternal(rawUrl: String) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(rawUrl)))
        } catch (_: Exception) {
            // The URL remains blocked in the WebView when no external browser is available.
        }
    }
}
