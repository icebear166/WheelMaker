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

class StableOriginWebViewClient(
    private val context: Context,
    private val webSourceRuntime: WebSourceRuntime
) : WebViewClient() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        val uri = request.url ?: return null
        if (uri.scheme != "https" || uri.host != "appassets.androidplatform.net") {
            return null
        }
        val assetName = assetNameForStablePath(uri.encodedPath ?: "/")
        nativeShellStubAsset(assetName)?.let { stub ->
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
            return notFoundResponse()
        }
        val remoteBase = webSourceRuntime.remoteBaseForRequest()
        for (candidate in stableOriginAssetCandidates(assetName, remoteBase)) {
            when (candidate.source) {
                STABLE_ORIGIN_SOURCE_REMOTE -> remoteResponse(candidate.assetName, remoteBase)?.let { return it }
                STABLE_ORIGIN_SOURCE_EMBEDDED -> embeddedResponse(candidate.assetName)?.let { return it }
            }
        }
        return notFoundResponse()
    }

    private fun remoteResponse(assetName: String, remoteBase: String): WebResourceResponse? {
        if (remoteBase.isBlank()) return null
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
            val status = connection.responseCode
            if (status !in 200..299) {
                connection.disconnect()
                return null
            }
            val headers = responseHeadersForRemoteAsset(assetName, connection.getHeaderField("Cache-Control"))
            WebResourceResponse(
                mimeTypeFromHeader(connection.contentType, assetName),
                null,
                status,
                connection.responseMessage ?: "OK",
                headers,
                connection.inputStream
            )
        } catch (_: Exception) {
            connection?.disconnect()
            null
        }
    }

    private fun embeddedResponse(assetName: String): WebResourceResponse? {
        val stream = openEmbeddedAsset(assetName) ?: return null
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

private fun mimeTypeFromHeader(contentType: String?, assetName: String): String {
    return contentType
        ?.substringBefore(';')
        ?.trim()
        ?.takeIf { it.isNotBlank() }
        ?: contentTypeForAsset(assetName)
}
