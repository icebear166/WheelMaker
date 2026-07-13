package com.wheelmaker.android

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.util.Base64
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class AndroidSpeechRuntime(
    private val activity: Activity,
    private val webView: WebView,
    private val permissionRequestCode: Int
) {
    private val lock = Any()
    private var activeSession: ActiveSpeechSession? = null

    fun start(rawJson: String): String {
        val request = try {
            parseAndroidSpeechStartRequest(rawJson)
        } catch (error: Exception) {
            return androidSpeechCommandRejected("INVALID_REQUEST", error.message ?: "Invalid Android speech request.")
        }
        val session = ActiveSpeechSession(request.streamId)
        synchronized(lock) {
            if (activeSession != null) return androidSpeechCommandRejected("BUSY", "Native speech is already active.")
            activeSession = session
        }
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            sendEvent(AndroidSpeechEvent.Status(session.streamId, "permission"))
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.RECORD_AUDIO), permissionRequestCode)
            return androidSpeechCommandAccepted(session.streamId)
        }
        startRecorder(session)
        return androidSpeechCommandAccepted(session.streamId)
    }

    fun finish(streamId: String): String {
        val session = activeSessionFor(streamId)
            ?: return androidSpeechCommandRejected("NOT_FOUND", "Native speech stream is not active.")
        session.finishRequested = true
        sendEvent(AndroidSpeechEvent.Status(streamId, "finishing"))
        session.recorder?.stop(flush = true)
        return androidSpeechCommandAccepted(streamId)
    }

    fun cancel(streamId: String, reason: String): String {
        val session = takeActiveSession(streamId)
            ?: return androidSpeechCommandRejected("NOT_FOUND", "Native speech stream is not active.")
        session.recorder?.stop(flush = false)
        sendEvent(AndroidSpeechEvent.Closed(streamId, reason))
        return androidSpeechCommandAccepted(streamId)
    }

    fun stopForAppBackground() {
        val session = takeAnyActiveSession() ?: return
        session.recorder?.stop(flush = false)
        sendEvent(AndroidSpeechEvent.Closed(session.streamId, "app_background"))
    }

    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != permissionRequestCode) return false
        val session = synchronized(lock) { activeSession } ?: return true
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            startRecorder(session)
            return true
        }
        clearActiveSession(session.streamId)
        sendEvent(AndroidSpeechEvent.Error(session.streamId, "PERMISSION_DENIED", "Microphone permission was denied.", false))
        return true
    }

    private fun startRecorder(session: ActiveSpeechSession) {
        if (!isActive(session.streamId)) return
        val recorder = PcmAudioRecorder(
            context = activity,
            listener = object : PcmAudioRecorderListener {
                override fun onAudioChunk(pcm: ByteArray) {
                    if (isActive(session.streamId)) {
                        sendEvent(AndroidSpeechEvent.Audio(session.streamId, Base64.encodeToString(pcm, Base64.NO_WRAP)))
                    }
                }

                override fun onLevel(level: Double) {
                    if (isActive(session.streamId)) sendEvent(AndroidSpeechEvent.Level(session.streamId, level))
                }

                override fun onError(message: String) {
                    failSession(session, "MICROPHONE", message)
                }

                override fun onStopped() {
                    if (!isActive(session.streamId)) return
                    if (session.finishRequested) {
                        takeActiveSession(session.streamId)
                        sendEvent(AndroidSpeechEvent.Closed(session.streamId, "finished"))
                    } else {
                        failSession(session, "MICROPHONE", "Microphone capture stopped.")
                    }
                }
            }
        )
        session.recorder = recorder
        try {
            recorder.start()
            sendEvent(AndroidSpeechEvent.Status(session.streamId, "recording"))
        } catch (error: Exception) {
            failSession(session, "MICROPHONE", error.message ?: "Failed to start microphone capture.")
        }
    }

    private fun failSession(session: ActiveSpeechSession, code: String, message: String) {
        val removed = takeActiveSession(session.streamId) ?: return
        removed.recorder?.stop(flush = false)
        sendEvent(AndroidSpeechEvent.Error(session.streamId, code, message, false))
    }

    private fun sendEvent(event: AndroidSpeechEvent) {
        val script = "window.__wheelmakerAndroidSpeechEvent && window.__wheelmakerAndroidSpeechEvent(${event.toJson()});"
        activity.runOnUiThread { webView.evaluateJavascript(script, null) }
    }

    private fun isActive(streamId: String): Boolean = synchronized(lock) { activeSession?.streamId == streamId }
    private fun activeSessionFor(streamId: String): ActiveSpeechSession? = synchronized(lock) { activeSession?.takeIf { it.streamId == streamId } }
    private fun takeActiveSession(streamId: String): ActiveSpeechSession? = synchronized(lock) {
        val current = activeSession ?: return@synchronized null
        if (current.streamId != streamId) return@synchronized null
        activeSession = null
        current
    }
    private fun takeAnyActiveSession(): ActiveSpeechSession? = synchronized(lock) {
        val current = activeSession
        activeSession = null
        current
    }
    private fun clearActiveSession(streamId: String) = synchronized(lock) {
        if (activeSession?.streamId == streamId) activeSession = null
    }

    private class ActiveSpeechSession(val streamId: String) {
        @Volatile var recorder: PcmAudioRecorder? = null
        @Volatile var finishRequested: Boolean = false
    }
}
