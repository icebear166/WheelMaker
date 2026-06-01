package com.wheelmaker.android

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.util.Locale

class StableOriginWebViewClient(
    private val context: Context,
    private val webSourceRuntime: WebSourceRuntime,
    private val diagnostics: AndroidWebDiagnostics
) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url ?: return null
        if (uri.scheme != "https" || uri.host != "appassets.androidplatform.net") {
            return null
        }
        val assetName = assetNameForStablePath(uri.encodedPath ?: "/")
        recordDiagnostic(assetName, "stable_origin_request", mapOf(
            "method" to request.method,
            "path" to (uri.encodedPath ?: "/")
        ))
        nativeShellStubAsset(assetName)?.let { stub ->
            recordDiagnostic(assetName, "native_stub_asset", mapOf(
                "contentType" to stub.contentType
            ))
            return WebResourceResponse(
                stub.contentType,
                "utf-8",
                200,
                "OK",
                noStoreHeaders(),
                ByteArrayInputStream(stub.body.toByteArray())
            )
        }
        if (shouldBlockStableOriginAsset(assetName)) {
            recordDiagnostic(assetName, "blocked_stable_origin_asset", level = "warn")
            return notFoundResponse()
        }
        val remoteBase = webSourceRuntime.remoteBaseForRequest()
        val candidates = stableOriginAssetCandidates(assetName, remoteBase)
        recordDiagnostic(assetName, "stable_origin_candidates", mapOf(
            "remoteBase" to remoteBase,
            "candidates" to candidates.joinToString(",") { "${it.source}:${it.assetName}" }
        ))
        for (candidate in candidates) {
            when (candidate.source) {
                STABLE_ORIGIN_SOURCE_REMOTE -> remoteResponse(candidate.assetName, remoteBase)?.let { return it }
                STABLE_ORIGIN_SOURCE_EMBEDDED -> embeddedResponse(candidate.assetName)?.let { return it }
            }
        }
        recordDiagnostic(assetName, "stable_origin_not_found", mapOf(
            "remoteBase" to remoteBase
        ), level = "warn")
        return notFoundResponse()
    }

    private fun remoteResponse(assetName: String, remoteBase: String): WebResourceResponse? {
        if (remoteBase.isBlank()) {
            recordDiagnostic(assetName, "remote_asset_skipped", mapOf(
                "reason" to "empty_remote_base"
            ))
            return null
        }
        var connection: HttpURLConnection? = null
        return try {
            val suffix = if (assetName == "index.html") "" else assetName
            val url = URI(remoteBase).resolve(suffix).toURL()
            connection = url.openConnection() as HttpURLConnection
            val bypassCache = shouldBypassRemoteUrlConnectionCache(assetName)
            connection.useCaches = !bypassCache
            connection.connectTimeout = 5000
            connection.readTimeout = 15000
            connection.instanceFollowRedirects = true
            if (bypassCache) {
                connection.setRequestProperty("Cache-Control", "no-cache")
                connection.setRequestProperty("Pragma", "no-cache")
            }
            recordDiagnostic(assetName, "remote_asset_fetch", mapOf(
                "url" to url.toString(),
                "useCaches" to connection.useCaches,
                "bypassCache" to bypassCache
            ))
            val status = connection.responseCode
            val upstreamCacheControl = connection.getHeaderField("Cache-Control")
            if (status !in 200..299) {
                recordDiagnostic(assetName, "remote_asset_status", mapOf(
                    "url" to url.toString(),
                    "status" to status,
                    "responseMessage" to (connection.responseMessage ?: ""),
                    "upstreamCacheControl" to upstreamCacheControl
                ), level = "warn")
                connection.disconnect()
                return null
            }
            val upstreamContentType = connection.contentType
            val servedContentType = contentTypeForRemoteAsset(upstreamContentType, assetName)
            val headers = responseHeadersForRemoteAsset(assetName, upstreamCacheControl)
            recordDiagnostic(assetName, "remote_asset_success", mapOf(
                "url" to url.toString(),
                "status" to status,
                "upstreamContentType" to (upstreamContentType ?: ""),
                "servedContentType" to servedContentType,
                "upstreamCacheControl" to (upstreamCacheControl ?: ""),
                "servedCacheControl" to (headers["Cache-Control"] ?: ""),
                "useCaches" to connection.useCaches
            ))
            WebResourceResponse(
                servedContentType,
                null,
                status,
                connection.responseMessage ?: "OK",
                headers,
                connection.inputStream
            )
        } catch (error: Exception) {
            recordDiagnostic(assetName, "remote_asset_error", mapOf(
                "errorType" to error.javaClass.simpleName,
                "message" to (error.message ?: "")
            ), level = "warn")
            connection?.disconnect()
            null
        }
    }

    private fun embeddedResponse(assetName: String): WebResourceResponse? {
        val stream = openEmbeddedAsset(assetName)
        if (stream == null) {
            recordDiagnostic(assetName, "embedded_asset_missing", level = "warn")
            return null
        }
        recordDiagnostic(assetName, "embedded_asset_success", mapOf(
            "contentType" to contentTypeForAsset(assetName),
            "cacheControl" to (responseHeadersForAsset(assetName)["Cache-Control"] ?: "")
        ))
        return WebResourceResponse(
            contentTypeForAsset(assetName),
            null,
            200,
            "OK",
            responseHeadersForAsset(assetName),
            stream
        )
    }

    private fun openEmbeddedAsset(assetName: String): InputStream? {
        return try {
            context.assets.open(assetName)
        } catch (_: Exception) {
            null
        }
    }

    private fun notFoundResponse(): WebResourceResponse {
        return WebResourceResponse(
            "text/plain",
            "utf-8",
            404,
            "Not Found",
            noStoreHeaders(),
            ByteArrayInputStream("not found".toByteArray())
        )
    }

    private fun recordDiagnostic(
        assetName: String,
        nativeEvent: String,
        details: Map<String, Any?> = emptyMap(),
        level: String = "info"
    ) {
        if (!shouldRecordStableOriginDiagnosticAsset(assetName)) {
            return
        }
        diagnostics.record(nativeEvent, mapOf("asset" to assetName) + details, level)
    }
}

fun assetNameForStablePath(path: String): String {
    val clean = path
        .replace('\\', '/')
        .split('/')
        .filter { it.isNotBlank() && it != "." && it != ".." }
        .joinToString("/")
    return clean.ifBlank { "index.html" }
}

fun isWorkspaceRoute(assetName: String): Boolean {
    val baseName = assetName.substringAfterLast('/')
    return baseName.isNotBlank() && !baseName.contains('.')
}

fun shouldBlockStableOriginAsset(assetName: String): Boolean {
    val baseName = assetName.substringAfterLast('/')
    return baseName == "ws"
}

fun shouldRecordStableOriginDiagnosticAsset(assetName: String): Boolean {
    val baseName = assetName.substringAfterLast('/')
    return baseName == "index.html" ||
        baseName == "service-worker.js" ||
        baseName == "manifest.webmanifest" ||
        isWorkspaceRoute(assetName) ||
        assetName.endsWith(".js") ||
        assetName.endsWith(".css") ||
        assetName.endsWith(".json") ||
        assetName.endsWith(".webmanifest")
}

data class NativeShellStubAsset(
    val body: String,
    val contentType: String
)

fun shouldServeNativeShellStubAsset(assetName: String): Boolean {
    return nativeShellStubAsset(assetName) != null
}

fun nativeShellStubAsset(assetName: String): NativeShellStubAsset? {
    return when (assetName.substringAfterLast('/')) {
        "service-worker.js" -> NativeShellStubAsset(
            "/* native shell: service worker disabled */\n",
            "application/javascript"
        )
        "manifest.webmanifest" -> NativeShellStubAsset(
            """{"name":"WheelMaker","short_name":"WheelMaker","start_url":"/","display":"standalone","icons":[]}""",
            "application/manifest+json"
        )
        else -> null
    }
}

data class StableOriginAssetCandidate(
    val source: String,
    val assetName: String
)

const val STABLE_ORIGIN_SOURCE_REMOTE = "remote"
const val STABLE_ORIGIN_SOURCE_EMBEDDED = "embedded"

fun stableOriginAssetCandidates(assetName: String, remoteBase: String): List<StableOriginAssetCandidate> {
    val remoteActive = remoteBase.isNotBlank()
    val source = if (remoteActive) STABLE_ORIGIN_SOURCE_REMOTE else STABLE_ORIGIN_SOURCE_EMBEDDED
    val candidates = mutableListOf(StableOriginAssetCandidate(source, assetName))
    if (isWorkspaceRoute(assetName) && assetName != "index.html") {
        candidates += StableOriginAssetCandidate(source, "index.html")
    }
    return candidates
}

fun contentTypeForAsset(assetName: String): String {
    return when {
        assetName.endsWith(".html") -> "text/html"
        assetName.endsWith(".js") -> "application/javascript"
        assetName.endsWith(".css") -> "text/css"
        assetName.endsWith(".json") -> "application/json"
        assetName.endsWith(".webmanifest") -> "application/manifest+json"
        assetName.endsWith(".svg") -> "image/svg+xml"
        assetName.endsWith(".png") -> "image/png"
        assetName.endsWith(".jpg") || assetName.endsWith(".jpeg") -> "image/jpeg"
        assetName.endsWith(".ico") -> "image/x-icon"
        assetName.endsWith(".woff2") -> "font/woff2"
        assetName.endsWith(".woff") -> "font/woff"
        assetName.endsWith(".ttf") -> "font/ttf"
        assetName.endsWith(".eot") -> "application/vnd.ms-fontobject"
        else -> "application/octet-stream"
    }
}

fun contentTypeForRemoteAsset(contentType: String?, assetName: String): String {
    val upstreamType = normalizedContentType(contentType)
    val assetType = contentTypeForAsset(assetName)
    if (shouldPreferAssetContentType(assetName, assetType, upstreamType)) {
        return assetType
    }
    return upstreamType ?: assetType
}

fun responseHeadersForAsset(assetName: String): Map<String, String> {
    val baseName = assetName.substringAfterLast('/')
    val cacheControl = when {
        baseName == "index.html" || !baseName.contains('.') -> "no-cache, must-revalidate"
        else -> "public, max-age=31536000, immutable"
    }
    val headers = mutableMapOf("Cache-Control" to cacheControl)
    if (cacheControl == "no-store" || cacheControl.startsWith("no-cache")) {
        headers["Pragma"] = "no-cache"
        headers["Expires"] = "0"
    }
    return headers
}

fun noStoreHeaders(): Map<String, String> {
    return mapOf(
        "Cache-Control" to "no-store",
        "Pragma" to "no-cache",
        "Expires" to "0"
    )
}

fun responseHeadersForRemoteAsset(assetName: String, upstreamCacheControl: String?): Map<String, String> {
    return responseHeadersForAsset(assetName)
}

fun shouldBypassRemoteUrlConnectionCache(assetName: String): Boolean {
    val baseName = assetName.substringAfterLast('/')
    return when (responseHeadersForAsset(baseName)["Cache-Control"]) {
        "no-store", "no-cache", "no-cache, must-revalidate" -> true
        else -> false
    }
}

private fun normalizedContentType(contentType: String?): String? {
    return contentType
        ?.substringBefore(';')
        ?.trim()
        ?.lowercase(Locale.US)
        ?.takeIf { it.isNotBlank() }
}

private fun shouldPreferAssetContentType(assetName: String, assetType: String, upstreamType: String?): Boolean {
    if (assetType == "application/octet-stream") return false
    if (isFontAsset(assetName)) return true
    return upstreamType == null || upstreamType == "application/octet-stream" || upstreamType == "binary/octet-stream"
}

private fun isFontAsset(assetName: String): Boolean {
    return assetName.endsWith(".woff2") ||
        assetName.endsWith(".woff") ||
        assetName.endsWith(".ttf") ||
        assetName.endsWith(".eot")
}
