package com.wheelmaker.android

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidSpeechBridgeProtocolTest {
    @Test
    fun parsesDirectRecognitionRequestAndRejectsCredentials() {
        val request = parseAndroidSpeechStartRequest(
            """
            {
              "provider": "volcengine",
              "model": "doubao-streaming-asr-2.0",
              "audio": {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1}
            }
            """.trimIndent()
        )

        assertEquals("volcengine", request.provider)
        assertEquals("doubao-streaming-asr-2.0", request.model)
        assertEquals(16000, request.audio.rate)

        try {
            parseAndroidSpeechStartRequest("""{"provider":"volcengine","model":"doubao-streaming-asr-2.0","apiKey":"client-key"}""")
            throw AssertionError("expected client api key rejection")
        } catch (error: IllegalArgumentException) {
            assertEquals("Android speech must not receive an API key.", error.message)
        }
    }

    @Test
    fun serializesCredentialStateWithoutCredentialValue() {
        val state = JSONObject(androidSpeechCredentialState(configured = true, version = "credential-v1"))

        assertTrue(state.getBoolean("configured"))
        assertEquals("credential-v1", state.getString("version"))
        assertFalse(state.has("accessToken"))
        assertFalse(state.has("apiKey"))
    }

    @Test
    fun serializesTranscriptInsteadOfPcmAudio() {
        val transcript = JSONObject(AndroidSpeechEvent.Transcript(
            streamId = "android-speech-1",
            text = "hello",
            final = true
        ).toJson())

        assertEquals("transcript", transcript.getString("type"))
        assertEquals("android-speech-1", transcript.getString("streamId"))
        assertEquals("hello", transcript.getString("text"))
        assertTrue(transcript.getBoolean("final"))
        assertFalse(transcript.has("pcm"))
    }
}
