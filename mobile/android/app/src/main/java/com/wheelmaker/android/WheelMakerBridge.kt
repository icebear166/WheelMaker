package com.wheelmaker.android

import android.os.SystemClock
import android.os.Build
import org.json.JSONObject

class WheelMakerBridge(
    private val androidSpeechRuntime: AndroidSpeechRuntime,
    private val androidNotificationRuntime: AndroidNotificationRuntime,
    private val androidApkUpdateRuntime: AndroidApkUpdateRuntime,
    private val androidImageShareRuntime: AndroidImageShareRuntime,
    private val androidHtmlShareRuntime: AndroidHtmlShareRuntime,
    private val androidPortRelaySiteDataRuntime: AndroidPortRelaySiteDataRuntime,
    private val androidWebDiagnostics: AndroidWebDiagnostics,
    private val androidDiagnosticLogLevelStore: AndroidDiagnosticLogLevelStore,
    private val trustedNativeActionGrantStore: TrustedNativeActionGrantStore
) {
	fun dispatch(capability: TrustedNativeCapability, payload: JSONObject): String {
		val action = capability.action
		if (!capability.allows(action, SystemClock.elapsedRealtime())) {
			throw SecurityException("expired native capability")
		}
		return when (action) {
        "userAction.reserve" -> reserveUserAction(payload)
        "device.getName" -> JSONObject.quote(Build.MODEL.trim().ifBlank { "Android" }.take(80))
        "diagnostics.drain" -> androidWebDiagnostics.drainJson()
        "diagnostics.setLogLevel" -> setDiagnosticLogLevel(payload.optString("logLevel"))
        "speech.credentialState" -> androidSpeechRuntime.credentialState()
        "speech.configureCredential" -> androidSpeechRuntime.configureCredential(
            payload.optString("accessToken"),
            payload.optString("version")
        )
        "speech.clearCredential" -> androidSpeechRuntime.clearCredential()
        "speech.start" -> startSpeech(payload)
        "speech.finish" -> androidSpeechRuntime.finish(payload.optString("streamId"))
        "speech.cancel" -> androidSpeechRuntime.cancel(
            payload.optString("streamId"),
            payload.optString("reason")
        )
        "notification.requestPermission" -> androidNotificationRuntime.requestPermission()
        "notification.getPermissionState" -> androidNotificationRuntime.getPermissionState()
        "notification.show" -> androidNotificationRuntime.showNotification(payload.toString())
        "apk.getReleaseState" -> androidApkUpdateRuntime.getReleaseState()
        "apk.install" -> androidApkUpdateRuntime.installRelease(payload.toString())
        "image.share.begin" -> beginResponseImageShare(payload)
        "image.share.chunk" -> androidImageShareRuntime.append(payload.toString())
        "image.share.commit" -> androidImageShareRuntime.commit(payload.toString())
        "image.share.cancel" -> androidImageShareRuntime.cancel(payload.toString())
        "html.share.begin" -> beginMarkdownHtmlShare(payload)
        "html.share.chunk" -> androidHtmlShareRuntime.append(payload.toString())
        "html.share.commit" -> androidHtmlShareRuntime.commit(payload.toString())
        "html.share.cancel" -> androidHtmlShareRuntime.cancel(payload.toString())
        "relay.clearSiteData" -> androidPortRelaySiteDataRuntime.clear(payload.optString("relayUrl"))
			else -> throw IllegalArgumentException("unsupported native action")
		}
    }

    private fun reserveUserAction(payload: JSONObject): String = JSONObject()
        .put("token", trustedNativeActionGrantStore.issue(payload.optString("action")))
        .toString()

    private fun startSpeech(payload: JSONObject): String {
        if (!trustedNativeActionGrantStore.consume(
                payload.optString("userActionToken"),
                "speech.start"
            )) {
            throw SecurityException("invalid native user-action grant")
        }
        payload.remove("userActionToken")
        return androidSpeechRuntime.start(payload.toString())
    }

    private fun beginResponseImageShare(payload: JSONObject): String {
        if (!trustedNativeActionGrantStore.consume(
                payload.optString("userActionToken"),
                "image.share"
            )) {
            throw SecurityException("invalid native user-action grant")
        }
        payload.remove("userActionToken")
        return androidImageShareRuntime.begin(payload.toString())
    }

    private fun beginMarkdownHtmlShare(payload: JSONObject): String {
        if (!trustedNativeActionGrantStore.consume(
                payload.optString("userActionToken"),
                "html.share"
            )) {
            throw SecurityException("invalid native user-action grant")
        }
        payload.remove("userActionToken")
        return androidHtmlShareRuntime.begin(payload.toString())
    }

    private fun setDiagnosticLogLevel(logLevel: String): String {
        androidDiagnosticLogLevelStore.saveDiagnosticLogLevel(logLevel)
        androidWebDiagnostics.setLogLevel(logLevel)
        return JSONObject()
            .put("logLevel", androidWebDiagnostics.getLogLevel())
            .toString()
    }
}
