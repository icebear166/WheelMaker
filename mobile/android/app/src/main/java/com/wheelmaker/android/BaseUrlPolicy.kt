package com.wheelmaker.android

import java.net.URI
import java.util.Locale

const val ANDROID_BOOTSTRAP_URL = "https://appassets.androidplatform.net/assets/bootstrap/index.html"

enum class NavigationDecision {
    ALLOW,
    EXTERNAL,
    BLOCK
}

fun normalizeHttpsBaseUrl(raw: String): String? {
    val input = raw.trim()
    if (input.isEmpty()) return null
    val parsed = parseUri(if (input.contains("://")) input else "https://$input") ?: return null
    if (
        parsed.isOpaque ||
        !parsed.scheme.equals("https", ignoreCase = true) ||
        parsed.host.isNullOrBlank() ||
        parsed.rawUserInfo != null ||
        parsed.rawQuery != null ||
        parsed.rawFragment != null
    ) {
        return null
    }
    val normalized = parsed.normalize()
    var normalizedPath = normalized.rawPath.orEmpty().ifBlank { "/" }
    if (!normalizedPath.startsWith('/')) normalizedPath = "/$normalizedPath"
    if (!normalizedPath.endsWith('/')) normalizedPath += "/"
    return "https://${normalized.rawAuthority}$normalizedPath"
}

fun isAllowedProbeRedirect(rawUrl: String, hopCount: Int): Boolean {
    val parsed = parseUri(rawUrl) ?: return false
    return hopCount <= 5 &&
        parsed.scheme.equals("https", ignoreCase = true) &&
        !parsed.host.isNullOrBlank() &&
        parsed.rawUserInfo == null
}

class BaseUrlPolicy(baseUrl: String) {
    private val base = requireNotNull(normalizeHttpsBaseUrl(baseUrl)) { "invalid HTTPS base URL" }
        .let(::URI)

    fun decide(rawUrl: String, isMainFrame: Boolean): NavigationDecision {
        if (contains(rawUrl)) return NavigationDecision.ALLOW
        val parsed = parseUri(rawUrl)
        if (
            parsed == null ||
            !parsed.scheme.equals("https", ignoreCase = true) ||
            parsed.host.isNullOrBlank() ||
            parsed.rawUserInfo != null
        ) {
            return NavigationDecision.BLOCK
        }
        return if (isMainFrame) NavigationDecision.EXTERNAL else NavigationDecision.BLOCK
    }

    fun contains(rawUrl: String): Boolean {
        val candidate = parseUri(rawUrl)?.normalize() ?: return false
        if (
            !candidate.scheme.equals("https", ignoreCase = true) ||
            candidate.host.isNullOrBlank() ||
            candidate.rawUserInfo != null ||
            !candidate.host.equals(base.host, ignoreCase = true) ||
            effectivePort(candidate) != effectivePort(base)
        ) {
            return false
        }
        val basePath = cleanPath(base.path)
        val candidatePath = cleanPath(candidate.path)
        return candidatePath == basePath.removeSuffix("/") || candidatePath.startsWith(basePath)
    }
}

private fun parseUri(raw: String): URI? = try {
    URI(raw)
} catch (_: Exception) {
    null
}

private fun effectivePort(uri: URI): Int = if (uri.port == -1) 443 else uri.port

private fun cleanPath(raw: String?): String {
    val segments = raw.orEmpty()
        .replace('\\', '/')
        .split('/')
        .fold(mutableListOf<String>()) { result, segment ->
            when (segment) {
                "", "." -> Unit
                ".." -> if (result.isNotEmpty()) result.removeAt(result.lastIndex)
                else -> result += segment
            }
            result
        }
    val clean = "/" + segments.joinToString("/")
    return if (raw.orEmpty().endsWith('/') && clean != "/") "$clean/" else clean
}
