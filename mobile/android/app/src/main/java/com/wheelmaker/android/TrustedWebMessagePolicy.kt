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

class TrustedNativeCapability internal constructor(
    val action: String,
    private val issuedAtElapsedRealtime: Long,
    private val expiresAtElapsedRealtime: Long
) {
    fun allows(expectedAction: String, nowElapsedRealtime: Long): Boolean =
        action == expectedAction && nowElapsedRealtime in issuedAtElapsedRealtime..expiresAtElapsedRealtime
}

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
		return authorize(
			surface,
			sourceOrigin,
			isMainFrame,
			topLevelUrl,
			navigationStartedAtElapsedRealtime,
			nowElapsedRealtime,
			request
		) != null
	}

	fun authorize(
		surface: TrustedMessageSurface,
		sourceOrigin: String,
		isMainFrame: Boolean,
		topLevelUrl: String,
		navigationStartedAtElapsedRealtime: Long,
		nowElapsedRealtime: Long,
		request: TrustedWebMessageRequest
	): TrustedNativeCapability? {
		if (!isMainFrame || request.requestId.isBlank()) {
			return null
		}
        val actions = when (surface) {
            TrustedMessageSurface.BOOTSTRAP -> BOOTSTRAP_ACTIONS
            TrustedMessageSurface.BUSINESS -> BUSINESS_ACTIONS
        }
		if (request.action !in actions) {
			return null
		}

        val sourceAllowed = when (surface) {
            TrustedMessageSurface.BOOTSTRAP ->
                sourceOrigin == BOOTSTRAP_ORIGIN && topLevelUrl == ANDROID_BOOTSTRAP_URL
            TrustedMessageSurface.BUSINESS -> {
				val baseUrl = normalizeHttpsBaseUrl(configuredBaseUrl) ?: return null
                sourceOrigin == originOf(baseUrl) && BaseUrlPolicy(baseUrl).contains(topLevelUrl)
            }
        }
		if (!sourceAllowed) return null
		if (request.action !in SENSITIVE_ACTIONS) {
			return capability(request.action, nowElapsedRealtime)
		}

		val gestureOffset = request.userGestureAt ?: return null
		if (gestureOffset < 0 || navigationStartedAtElapsedRealtime <= 0) return null
        val gestureElapsedRealtime = navigationStartedAtElapsedRealtime + gestureOffset
        val age = nowElapsedRealtime - gestureElapsedRealtime
		if (age !in -MAX_FUTURE_SKEW_MILLIS..MAX_GESTURE_AGE_MILLIS) return null
		return capability(request.action, nowElapsedRealtime)
    }

	private fun capability(action: String, nowElapsedRealtime: Long) = TrustedNativeCapability(
		action = action,
		issuedAtElapsedRealtime = nowElapsedRealtime,
		expiresAtElapsedRealtime = nowElapsedRealtime + CAPABILITY_TTL_MILLIS
	)

    companion object {
        val BOOTSTRAP_ACTIONS = setOf(
            "bootstrap.getState",
            "bootstrap.saveBaseUrl",
            "bootstrap.retry",
            "bootstrap.reset"
        )
        val BUSINESS_ACTIONS = setOf(
            "device.getName",
            "diagnostics.drain",
            "diagnostics.setLogLevel",
            "speech.credentialState",
            "speech.configureCredential",
            "speech.clearCredential",
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
		private const val CAPABILITY_TTL_MILLIS = 1_000L

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

fun isTrustedBusinessUiRequest(
	configuredBaseUrl: String,
	topLevelUrl: String,
	lastGestureElapsedRealtime: Long,
	nowElapsedRealtime: Long
): Boolean {
	val baseUrl = normalizeHttpsBaseUrl(configuredBaseUrl) ?: return false
	if (!BaseUrlPolicy(baseUrl).contains(topLevelUrl)) return false
	if (lastGestureElapsedRealtime <= 0) return false
	val age = nowElapsedRealtime - lastGestureElapsedRealtime
	return age in 0..5_000L
}
