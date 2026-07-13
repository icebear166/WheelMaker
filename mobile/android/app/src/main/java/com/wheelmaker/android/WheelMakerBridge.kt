package com.wheelmaker.android

import android.os.SystemClock
import org.json.JSONObject

class WheelMakerBridge(
    private val androidSpeechRuntime: AndroidSpeechRuntime,
    private val androidNotificationRuntime: AndroidNotificationRuntime,
    private val androidApkUpdateRuntime: AndroidApkUpdateRuntime,
    private val androidImageShareRuntime: AndroidImageShareRuntime,
    private val androidPortRelaySiteDataRuntime: AndroidPortRelaySiteDataRuntime,
    private val androidWebDiagnostics: AndroidWebDiagnostics,
    private val androidDiagnosticLogLevelStore: AndroidDiagnosticLogLevelStore
) {
	fun dispatch(capability: TrustedNativeCapability, payload: JSONObject): String {
		val action = capability.action
		if (!capability.allows(action, SystemClock.elapsedRealtime())) {
			throw SecurityException("expired native capability")
		}
		return when (action) {
        "diagnostics.drain" -> androidWebDiagnostics.drainJson()
        "diagnostics.setLogLevel" -> setDiagnosticLogLevel(payload.optString("logLevel"))
        "speech.start" -> androidSpeechRuntime.start(payload.toString())
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
        "image.share" -> androidImageShareRuntime.shareResponseImage(payload.toString())
        "relay.clearSiteData" -> androidPortRelaySiteDataRuntime.clear(payload.optString("relayUrl"))
			else -> throw IllegalArgumentException("unsupported native action")
		}
    }

    private fun setDiagnosticLogLevel(logLevel: String): String {
        androidDiagnosticLogLevelStore.saveDiagnosticLogLevel(logLevel)
        androidWebDiagnostics.setLogLevel(logLevel)
        return JSONObject()
            .put("logLevel", androidWebDiagnostics.getLogLevel())
            .toString()
    }
}
