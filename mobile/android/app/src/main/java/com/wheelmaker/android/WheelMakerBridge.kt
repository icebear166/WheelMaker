package com.wheelmaker.android

import android.webkit.JavascriptInterface
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
    @JavascriptInterface
    fun drainWebDiagnostics(): String = androidWebDiagnostics.drainJson()

    @JavascriptInterface
    fun setDiagnosticLogLevel(logLevel: String): String {
        androidDiagnosticLogLevelStore.saveDiagnosticLogLevel(logLevel)
        androidWebDiagnostics.setLogLevel(logLevel)
        return JSONObject()
            .put("logLevel", androidWebDiagnostics.getLogLevel())
            .toString()
    }

    @JavascriptInterface
    fun startSpeech(rawJson: String): String = androidSpeechRuntime.start(rawJson)

    @JavascriptInterface
    fun finishSpeech(streamId: String): String = androidSpeechRuntime.finish(streamId)

    @JavascriptInterface
    fun cancelSpeech(streamId: String, reason: String): String = androidSpeechRuntime.cancel(streamId, reason)

    @JavascriptInterface
    fun requestNotificationPermission(): String = androidNotificationRuntime.requestPermission()

    @JavascriptInterface
    fun getNotificationPermissionState(): String = androidNotificationRuntime.getPermissionState()

    @JavascriptInterface
    fun showNotification(rawJson: String): String = androidNotificationRuntime.showNotification(rawJson)

    @JavascriptInterface
    fun getAndroidReleaseState(): String = androidApkUpdateRuntime.getReleaseState()

    @JavascriptInterface
    fun installAndroidRelease(rawJson: String): String = androidApkUpdateRuntime.installRelease(rawJson)

    @JavascriptInterface
    fun shareResponseImage(rawJson: String): String = androidImageShareRuntime.shareResponseImage(rawJson)

    @JavascriptInterface
    fun clearPortRelaySiteData(relayUrl: String): String = androidPortRelaySiteDataRuntime.clear(relayUrl)
}
