package com.wheelmaker.android

import java.net.URI

data class AndroidFileDownloadRequest(
    val url: String,
    val fileName: String,
    val mimeType: String,
    val size: Long,
    val cookie: String,
    val userAgent: String,
    val destinationDirectory: String = "Downloads",
    val notificationVisibleOnCompletion: Boolean = true
)

class AndroidFileDownloadRuntime(
    private val configuredBaseUrl: () -> String,
    private val cookieProvider: (String) -> String?,
    private val userAgentProvider: () -> String,
    private val enqueue: (AndroidFileDownloadRequest) -> Long
) {
    fun start(url: String, fileName: String, mimeType: String, size: Long): Long {
        require(isTrustedRegistryDownloadUrl(configuredBaseUrl(), url)) {
            "untrusted Registry download URL"
        }
        require(size >= 0) { "invalid download size" }
        val request = AndroidFileDownloadRequest(
            url = url,
            fileName = safeAndroidDownloadFileName(fileName),
            mimeType = safeAndroidDownloadMimeType(mimeType),
            size = size,
            cookie = cookieProvider(url).orEmpty(),
            userAgent = userAgentProvider().trim()
        )
        return enqueue(request)
    }
}

fun isTrustedRegistryDownloadUrl(configuredBaseUrl: String, rawUrl: String): Boolean {
    val normalizedBase = normalizeHttpsBaseUrl(configuredBaseUrl) ?: return false
    val base = parseDownloadUri(normalizedBase) ?: return false
    val candidate = parseDownloadUri(rawUrl) ?: return false
    if (
        !candidate.scheme.equals("https", ignoreCase = true) ||
        candidate.host.isNullOrBlank() ||
        candidate.rawUserInfo != null ||
        candidate.rawQuery != null ||
        candidate.rawFragment != null ||
        !candidate.host.equals(base.host, ignoreCase = true) ||
        downloadEffectivePort(candidate) != downloadEffectivePort(base)
    ) {
        return false
    }
    val basePath = base.path.orEmpty().ifBlank { "/" }.let {
        if (it.endsWith('/')) it else "$it/"
    }
    val candidatePath = candidate.path ?: return false
    if (candidate.rawPath != candidatePath || candidate.normalize().path != candidatePath) {
        return false
    }
    val prefix = "${basePath}ws/download/"
    if (!candidatePath.startsWith(prefix)) return false
    val token = candidatePath.removePrefix(prefix)
    return DOWNLOAD_TOKEN_PATTERN.matches(token)
}

internal fun safeAndroidDownloadFileName(raw: String): String {
    val leaf = raw.replace('\\', '/').substringAfterLast('/')
    val clean = leaf
        .filter { it.code >= 32 && it.code != 127 }
        .trim()
        .trim('.')
        .take(180)
    return clean.ifBlank { "download" }
}

private fun safeAndroidDownloadMimeType(raw: String): String {
    val clean = raw.trim().lowercase()
    return if (DOWNLOAD_MIME_PATTERN.matches(clean)) clean else "application/octet-stream"
}

private fun parseDownloadUri(raw: String): URI? = try {
    URI(raw)
} catch (_: Exception) {
    null
}

private fun downloadEffectivePort(uri: URI): Int = if (uri.port == -1) 443 else uri.port

private val DOWNLOAD_TOKEN_PATTERN = Regex("^[A-Za-z0-9_-]{43}$")
private val DOWNLOAD_MIME_PATTERN = Regex("^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$")
