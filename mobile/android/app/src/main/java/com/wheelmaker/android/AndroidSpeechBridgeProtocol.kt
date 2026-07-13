package com.wheelmaker.android

import org.json.JSONObject

data class SpeechAudioConfig(
    val format: String = "pcm",
    val codec: String = "raw",
    val rate: Int = 16000,
    val bits: Int = 16,
    val channel: Int = 1
)

data class AndroidSpeechStartRequest(
    val streamId: String,
    val provider: String,
    val audio: SpeechAudioConfig
)

sealed class AndroidSpeechEvent {
    abstract val streamId: String
    abstract fun toJson(): String

    data class Status(
        override val streamId: String,
        val status: String
    ) : AndroidSpeechEvent() {
        override fun toJson(): String = JSONObject()
            .put("type", "status")
            .put("streamId", streamId)
            .put("status", status)
            .toString()
    }

    data class Level(
        override val streamId: String,
        val level: Double
    ) : AndroidSpeechEvent() {
        override fun toJson(): String = JSONObject()
            .put("type", "level")
            .put("streamId", streamId)
            .put("level", level)
            .toString()
    }

    data class Audio(
        override val streamId: String,
        val pcm: String
    ) : AndroidSpeechEvent() {
        override fun toJson(): String = JSONObject()
            .put("type", "audio")
            .put("streamId", streamId)
            .put("pcm", pcm)
            .toString()
    }

    data class Error(
        override val streamId: String = "",
        val code: String,
        val message: String,
        val retryable: Boolean
    ) : AndroidSpeechEvent() {
        override fun toJson(): String {
            val payload = JSONObject()
                .put("type", "error")
                .put("code", code)
                .put("message", message)
                .put("retryable", retryable)
            if (streamId.isNotBlank()) payload.put("streamId", streamId)
            return payload.toString()
        }
    }

    data class Closed(
        override val streamId: String,
        val reason: String
    ) : AndroidSpeechEvent() {
        override fun toJson(): String = JSONObject()
            .put("type", "closed")
            .put("streamId", streamId)
            .put("reason", reason)
            .toString()
    }
}

fun parseAndroidSpeechStartRequest(rawJson: String): AndroidSpeechStartRequest {
    val root = JSONObject(rawJson)
    val streamId = root.optString("streamId", "").trim()
    val provider = root.optString("provider", "").trim()
    if (streamId.isBlank()) throw IllegalArgumentException("Registry speech stream ID is required.")
    if (provider != "volcengine") throw IllegalArgumentException("Only Volcengine speech is supported on Android.")
    if (root.has("apiKey")) throw IllegalArgumentException("Android speech must not receive an API key.")
    val audio = root.optJSONObject("audio")
    val config = SpeechAudioConfig(
        format = audio?.optString("format", "pcm") ?: "pcm",
        codec = audio?.optString("codec", "raw") ?: "raw",
        rate = audio?.optInt("rate", 16000) ?: 16000,
        bits = audio?.optInt("bits", 16) ?: 16,
        channel = audio?.optInt("channel", 1) ?: 1
    )
    if (config != SpeechAudioConfig()) throw IllegalArgumentException("Android speech requires pcm/raw 16kHz 16-bit mono audio.")
    return AndroidSpeechStartRequest(streamId = streamId, provider = provider, audio = config)
}

fun androidSpeechCommandAccepted(streamId: String): String = JSONObject()
    .put("accepted", true)
    .put("streamId", streamId)
    .toString()

fun androidSpeechCommandRejected(code: String, message: String): String = JSONObject()
    .put("accepted", false)
    .put("code", code)
    .put("message", message)
    .toString()
