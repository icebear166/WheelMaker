package com.wheelmaker.android

import android.webkit.JavascriptInterface
import org.json.JSONObject

class WheelMakerBridge(
    private val webSourceRuntime: WebSourceRuntime,
    private val androidSpeechRuntime: AndroidSpeechRuntime,
    private val androidNotificationRuntime: AndroidNotificationRuntime,
    private val androidApkUpdateRuntime: AndroidApkUpdateRuntime,
    private val androidWebDiagnostics: AndroidWebDiagnostics,
    private val androidDebugLoggingStore: AndroidDebugLoggingStore
) {
    @JavascriptInterface
    fun getWebSourceState(): String = webSourceStateToJson(webSourceRuntime.state())

    @JavascriptInterface
    fun setWebSourcePreference(preference: String): String {
        val state = webSourceRuntime.setPreference(preference)
        androidWebDiagnostics.record("set_web_source_preference", mapOf(
            "preference" to state.preference,
            "actualSource" to state.actualSource,
            "remoteUrl" to state.remoteUrl,
            "remoteHost" to state.remoteHost
        ))
        return webSourceStateToJson(state)
    }

    @JavascriptInterface
    fun setRemoteWebCandidate(rawJson: String): String {
        val input = JSONObject(rawJson)
        val candidate = RemoteWebCandidate(
            source = input.optString("source"),
            registryAddress = input.optString("registryAddress"),
            remoteWebUrl = input.optString("remoteWebUrl")
        )
        val state = webSourceRuntime.setRemoteCandidate(candidate)
        androidWebDiagnostics.record("set_remote_web_candidate", mapOf(
            "candidateSource" to candidate.source,
            "registryAddress" to candidate.registryAddress,
            "candidateRemoteWebUrl" to candidate.remoteWebUrl,
            "actualSource" to state.actualSource,
            "remoteUrl" to state.remoteUrl,
            "remoteHost" to state.remoteHost
        ))
        return webSourceStateToJson(state)
    }

    @JavascriptInterface
    fun drainWebDiagnostics(): String = androidWebDiagnostics.drainJson()

    @JavascriptInterface
    fun setDebugLoggingEnabled(enabled: Boolean): String {
        androidDebugLoggingStore.saveDebugLoggingEnabled(enabled)
        androidWebDiagnostics.setEnabled(enabled)
        return JSONObject()
            .put("enabled", androidWebDiagnostics.isEnabled())
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
}
