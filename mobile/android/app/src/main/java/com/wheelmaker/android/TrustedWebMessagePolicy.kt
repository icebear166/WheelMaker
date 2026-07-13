package com.wheelmaker.android

import java.net.URI
import java.util.Locale

enum class TrustedMessageSurface {
    BOOTSTRAP,
    BUSINESS
}

data class TrustedWebMessageRequest(
    val requestId: String,
    val action: String,
    val userGestureAt: Long?
)

class TrustedWebMessagePolicy(private val configuredBaseUrl: String) {
    fun isAllowed(
        surface: TrustedMessageSurface,
        sourceOrigin: String,
        isMainFrame: Boolean,
        topLevelUrl: String,
        navigationStartedAtElapsedRealtime: Long,
        nowElapsedRealtime: Long,
        request: TrustedWebMessageRequest
    ): Boolean {
        if (!isMainFrame || request.requestId.isBlank()) return false
        val actions = when (surface) {
            TrustedMessageSurface.BOOTSTRAP -> BOOTSTRAP_ACTIONS
            TrustedMessageSurface.BUSINESS -> BUSINESS_ACTIONS
        }
        if (request.action !in actions) return false

        val sourceAllowed = when (surface) {
            TrustedMessageSurface.BOOTSTRAP ->
                sourceOrigin == BOOTSTRAP_ORIGIN && topLevelUrl == ANDROID_BOOTSTRAP_URL
            TrustedMessageSurface.BUSINESS -> {
                val baseUrl = normalizeHttpsBaseUrl(configuredBaseUrl) ?: return false
                sourceOrigin == originOf(baseUrl) && BaseUrlPolicy(baseUrl).contains(topLevelUrl)
            }
        }
        if (!sourceAllowed) return false
        if (request.action !in SENSITIVE_ACTIONS) return true

        val gestureOffset = request.userGestureAt ?: return false
        if (gestureOffset < 0 || navigationStartedAtElapsedRealtime <= 0) return false
        val gestureElapsedRealtime = navigationStartedAtElapsedRealtime + gestureOffset
        val age = nowElapsedRealtime - gestureElapsedRealtime
        return age in -MAX_FUTURE_SKEW_MILLIS..MAX_GESTURE_AGE_MILLIS
    }

    companion object {
        val BOOTSTRAP_ACTIONS = setOf(
            "bootstrap.getState",
            "bootstrap.saveBaseUrl",
            "bootstrap.retry",
            "bootstrap.reset"
        )
        val BUSINESS_ACTIONS = setOf(
            "diagnostics.drain",
            "diagnostics.setLogLevel",
            "speech.start",
            "speech.finish",
            "speech.cancel",
            "notification.getPermissionState",
            "notification.requestPermission",
            "notification.show",
            "apk.getReleaseState",
            "apk.install",
            "image.share",
            "relay.clearSiteData"
        )
        val SENSITIVE_ACTIONS = setOf(
            "bootstrap.saveBaseUrl",
            "bootstrap.retry",
            "bootstrap.reset",
            "speech.start",
            "notification.requestPermission",
            "apk.install",
            "image.share",
            "relay.clearSiteData"
        )

        private const val BOOTSTRAP_ORIGIN = "https://appassets.androidplatform.net"
        private const val MAX_GESTURE_AGE_MILLIS = 5_000L
        private const val MAX_FUTURE_SKEW_MILLIS = 1_000L

        fun originOf(rawUrl: String): String? {
            val uri = try {
                URI(rawUrl)
            } catch (_: Exception) {
                return null
            }
            if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank()) return null
            val host = uri.host.lowercase(Locale.US)
            val displayHost = if (host.contains(':')) "[$host]" else host
            val port = if (uri.port == -1 || uri.port == 443) "" else ":${uri.port}"
            return "https://$displayHost$port"
        }
    }
}
