package com.wheelmaker.android

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidSpeechBridgeProtocolTest {
    @Test
    fun parsesCaptureRequestAndRejectsApiKey() {
        val request = parseAndroidSpeechStartRequest(
            """
            {
              "provider": "volcengine",
			  "streamId": "speech-1",
              "audio": {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1}
            }
            """.trimIndent()
        )

        assertEquals("volcengine", request.provider)
		assertEquals("speech-1", request.streamId)
        assertEquals(16000, request.audio.rate)

        try {
			parseAndroidSpeechStartRequest("""{"provider":"volcengine","streamId":"speech-1","apiKey":"client-key"}""")
			throw AssertionError("expected client api key rejection")
		} catch (error: IllegalArgumentException) {
			assertEquals("Android speech must not receive an API key.", error.message)
        }
    }

    @Test
    fun serializesCommandResponses() {
        val accepted = JSONObject(androidSpeechCommandAccepted("speech-1"))

        assertTrue(accepted.getBoolean("accepted"))
        assertEquals("speech-1", accepted.getString("streamId"))

        val rejected = JSONObject(androidSpeechCommandRejected("BUSY", "Native speech is already active."))

        assertFalse(rejected.getBoolean("accepted"))
        assertEquals("BUSY", rejected.getString("code"))
        assertEquals("Native speech is already active.", rejected.getString("message"))
    }

    @Test
    fun serializesEventsForWebCallback() {
		val audio = JSONObject(AndroidSpeechEvent.Audio(
			streamId = "speech-1",
			pcm = "AQID"
        ).toJson())
        val error = JSONObject(AndroidSpeechEvent.Error(
            streamId = "speech-1",
            code = "NETWORK",
            message = "network down",
            retryable = false
        ).toJson())

		assertEquals("audio", audio.getString("type"))
		assertEquals("speech-1", audio.getString("streamId"))
		assertEquals("AQID", audio.getString("pcm"))
        assertEquals("error", error.getString("type"))
        assertEquals("NETWORK", error.getString("code"))
        assertFalse(error.getBoolean("retryable"))
    }
}
