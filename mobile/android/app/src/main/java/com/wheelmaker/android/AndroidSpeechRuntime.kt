package com.wheelmaker.android

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import java.util.UUID

class AndroidSpeechRuntime(
    private val activity: Activity,
    private val webView: WebView,
    private val permissionRequestCode: Int,
    private val okHttpClient: OkHttpClient = DoubaoSpeechClient.defaultOkHttpClient()
) {
    private val lock = Any()
    private val credentialCache = AndroidSpeechCredentialCache()
    private var activeSession: ActiveSpeechSession? = null

    fun credentialState(): String = credentialCache.stateJson()

    fun configureCredential(accessToken: String, version: String): String {
        return try {
            val previous = credentialCache.snapshot()
            val normalizedToken = accessToken.trim()
            val normalizedVersion = version.trim()
            if (previous != null && (previous.accessToken != normalizedToken || previous.version != normalizedVersion)) {
                cancelActiveSession("credential_replaced")
            }
            credentialCache.configure(normalizedToken, normalizedVersion)
            credentialCache.stateJson()
        } catch (error: IllegalArgumentException) {
            androidSpeechCommandRejected("INVALID_CREDENTIAL", error.message ?: "Invalid speech credential.")
        }
    }

    fun clearCredential(): String {
        cancelActiveSession("credential_cleared")
        credentialCache.clear()
        return credentialCache.stateJson()
    }

    fun start(rawJson: String): String {
        val request = try {
            parseAndroidSpeechStartRequest(rawJson)
        } catch (error: Exception) {
            return androidSpeechCommandRejected("INVALID_REQUEST", error.message ?: "Invalid Android speech request.")
        }
        val credential = credentialCache.snapshot()
            ?: return androidSpeechCommandRejected("NOT_CONFIGURED", "Android speech credential is not configured.")
        val session = ActiveSpeechSession(
            streamId = "android-speech-${UUID.randomUUID()}",
            audio = request.audio,
            credential = credential
        )
        synchronized(lock) {
            if (activeSession != null) return androidSpeechCommandRejected("BUSY", "Native speech is already active.")
            activeSession = session
        }
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            sendEvent(AndroidSpeechEvent.Status(session.streamId, "permission"))
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.RECORD_AUDIO), permissionRequestCode)
            return androidSpeechCommandAccepted(session.streamId)
        }
        startDirectClient(session)
        return androidSpeechCommandAccepted(session.streamId)
    }

    fun finish(streamId: String): String {
        val session = activeSessionFor(streamId)
            ?: return androidSpeechCommandRejected("NOT_FOUND", "Native speech stream is not active.")
        session.finishRequested = true
        sendEvent(AndroidSpeechEvent.Status(streamId, "finishing"))
        val recorder = session.recorder
        if (recorder != null) {
            recorder.stop(flush = true)
        } else if (session.clientConnected) {
            sendFinishFrame(session)
        }
        return androidSpeechCommandAccepted(streamId)
    }

    fun cancel(streamId: String, reason: String): String {
        val session = takeActiveSession(streamId)
            ?: return androidSpeechCommandRejected("NOT_FOUND", "Native speech stream is not active.")
        stopSession(session, reason.ifBlank { "cancelled" }, emitClosed = true)
        return androidSpeechCommandAccepted(streamId)
    }

    fun stopForAppBackground() {
        val session = takeAnyActiveSession() ?: return
        stopSession(session, "app_background", emitClosed = true)
    }

    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != permissionRequestCode) return false
        val session = synchronized(lock) { activeSession } ?: return true
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            startDirectClient(session)
            return true
        }
        failSession(session, "PERMISSION_DENIED", "Microphone permission was denied.", false)
        return true
    }

    private fun startDirectClient(session: ActiveSpeechSession) {
        if (!isActive(session.streamId)) return
        sendEvent(AndroidSpeechEvent.Status(session.streamId, "connecting"))
        val client = DoubaoSpeechClient(
            okHttpClient = okHttpClient,
            accessToken = session.credential.accessToken,
            audio = session.audio,
            listener = object : DoubaoSpeechClientListener {
                override fun onConnected() {
                    if (!isActive(session.streamId)) return
                    session.clientConnected = true
                    if (session.finishRequested) {
                        sendFinishFrame(session)
                    } else {
                        startRecorder(session)
                    }
                }

                override fun onTranscript(text: String, final: Boolean) {
                    if (!isActive(session.streamId)) return
                    sendEvent(AndroidSpeechEvent.Transcript(session.streamId, text, final))
                    if (final) {
                        val completed = takeActiveSession(session.streamId) ?: return
                        completed.recorder?.stop(flush = false)
                        sendEvent(AndroidSpeechEvent.Closed(session.streamId, "finished"))
                    }
                }

                override fun onError(code: String, message: String, retryable: Boolean) {
                    failSession(session, code, message, retryable)
                }

                override fun onClosed(reason: String) {
                    if (isActive(session.streamId)) {
                        failSession(session, "UNAVAILABLE", "Doubao speech connection closed: $reason", true)
                    }
                }
            }
        )
        session.client = client
        try {
            client.connect()
        } catch (error: Exception) {
            failSession(session, "UNAVAILABLE", error.message ?: "Failed to connect Doubao speech.", true)
        }
    }

    private fun startRecorder(session: ActiveSpeechSession) {
        if (!isActive(session.streamId)) return
        val recorder = PcmAudioRecorder(
            context = activity,
            listener = object : PcmAudioRecorderListener {
                override fun onAudioChunk(pcm: ByteArray) {
                    if (!isActive(session.streamId)) return
                    try {
                        session.client?.sendAudio(pcm)
                            ?: throw IllegalStateException("Doubao speech client is not connected.")
                    } catch (error: Exception) {
                        failSession(session, "SEND_FAILED", error.message ?: "Failed to send speech audio.", true)
                    }
                }

                override fun onLevel(level: Double) {
                    if (isActive(session.streamId)) sendEvent(AndroidSpeechEvent.Level(session.streamId, level))
                }

                override fun onError(message: String) {
                    failSession(session, "MICROPHONE", message, false)
                }

                override fun onStopped() {
                    if (!isActive(session.streamId)) return
                    if (session.finishRequested) {
                        sendFinishFrame(session)
                    } else {
                        failSession(session, "MICROPHONE", "Microphone capture stopped.", false)
                    }
                }
            }
        )
        session.recorder = recorder
        try {
            recorder.start()
            sendEvent(AndroidSpeechEvent.Status(session.streamId, "recording"))
        } catch (error: Exception) {
            failSession(session, "MICROPHONE", error.message ?: "Failed to start microphone capture.", false)
        }
    }

    private fun sendFinishFrame(session: ActiveSpeechSession) {
        synchronized(session) {
            if (session.finishSent || !isActive(session.streamId)) return
            session.finishSent = true
        }
        sendEvent(AndroidSpeechEvent.Status(session.streamId, "recognizing"))
        try {
            session.client?.finish()
                ?: throw IllegalStateException("Doubao speech client is not connected.")
        } catch (error: Exception) {
            failSession(session, "SEND_FAILED", error.message ?: "Failed to finish speech recognition.", true)
        }
    }

    private fun failSession(session: ActiveSpeechSession, code: String, message: String, retryable: Boolean) {
        val removed = takeActiveSession(session.streamId) ?: return
        stopSession(removed, "error", emitClosed = false)
        sendEvent(AndroidSpeechEvent.Error(session.streamId, code, message, retryable))
    }

    private fun cancelActiveSession(reason: String) {
        val session = takeAnyActiveSession() ?: return
        stopSession(session, reason, emitClosed = true)
    }

    private fun stopSession(session: ActiveSpeechSession, reason: String, emitClosed: Boolean) {
        session.recorder?.stop(flush = false)
        session.client?.cancel(reason)
        session.recorder = null
        session.client = null
        if (emitClosed) sendEvent(AndroidSpeechEvent.Closed(session.streamId, reason))
    }

    private fun sendEvent(event: AndroidSpeechEvent) {
        val script = "window.__wheelmakerAndroidSpeechEvent && window.__wheelmakerAndroidSpeechEvent(${event.toJson()});"
        activity.runOnUiThread { webView.evaluateJavascript(script, null) }
    }

    private fun isActive(streamId: String): Boolean = synchronized(lock) { activeSession?.streamId == streamId }

    private fun activeSessionFor(streamId: String): ActiveSpeechSession? = synchronized(lock) {
        activeSession?.takeIf { it.streamId == streamId }
    }

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

    private class ActiveSpeechSession(
        val streamId: String,
        val audio: SpeechAudioConfig,
        val credential: AndroidSpeechCredential
    ) {
        @Volatile var recorder: PcmAudioRecorder? = null
        @Volatile var client: DoubaoSpeechClient? = null
        @Volatile var clientConnected: Boolean = false
        @Volatile var finishRequested: Boolean = false
        @Volatile var finishSent: Boolean = false
    }
}
