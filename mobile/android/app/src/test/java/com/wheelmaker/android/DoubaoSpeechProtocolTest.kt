package com.wheelmaker.android

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.util.zip.GZIPInputStream

class DoubaoSpeechProtocolTest {
    @Test
    fun buildsFullClientRequestFrame() {
        val frame = buildDoubaoFullClientRequest(SpeechAudioConfig())

        assertArrayEquals(byteArrayOf(0x11, 0x10, 0x11, 0x00), frame.copyOfRange(0, 4))
        val size = readUint32(frame, 4)
        assertEquals(frame.size - 8, size)
        val payload = gunzip(frame.copyOfRange(8, frame.size)).decodeToString()

        assertTrue(payload.contains("\"uid\":\"wheelmaker\""))
        assertTrue(payload.contains("\"format\":\"pcm\""))
        assertTrue(payload.contains("\"codec\":\"raw\""))
        assertTrue(payload.contains("\"rate\":16000"))
        assertTrue(payload.contains("\"bits\":16"))
        assertTrue(payload.contains("\"channel\":1"))
        assertTrue(payload.contains("\"model_name\":\"bigmodel\""))
        assertTrue(payload.contains("\"enable_nonstream\":true"))
    }

    @Test
    fun buildsAudioAndFinalFrames() {
        val frame = buildDoubaoAudioRequest(byteArrayOf(1, 2, 3), final = false)

        assertArrayEquals(byteArrayOf(0x11, 0x20, 0x01, 0x00), frame.copyOfRange(0, 4))
        assertEquals(frame.size - 8, readUint32(frame, 4))
        assertArrayEquals(byteArrayOf(1, 2, 3), gunzip(frame.copyOfRange(8, frame.size)))

        val finalFrame = buildDoubaoAudioRequest(byteArrayOf(), final = true)
        assertArrayEquals(byteArrayOf(0x11, 0x22, 0x01, 0x00), finalFrame.copyOfRange(0, 4))
    }

    @Test
    fun parsesTranscriptAndFinalFrames() {
        val interimBody = gzip("""{"result":{"text":"你好世界"}}""".encodeToByteArray())
        val interimFrame = byteArrayOf(0x11, 0x91.toByte(), 0x11, 0x00) +
            int32Bytes(7) + uint32Bytes(interimBody.size) + interimBody

        val interim = parseDoubaoSpeechFrame(interimFrame)
        assertEquals("你好世界", interim.text)
        assertTrue(interim.hasTranscript)
        assertFalse(interim.final)

        val finalBody = gzip("""{"result":{"text":"最终"}}""".encodeToByteArray())
        val finalFrame = byteArrayOf(0x11, 0x93.toByte(), 0x11, 0x00) +
            int32Bytes(-3) + uint32Bytes(finalBody.size) + finalBody

        val final = parseDoubaoSpeechFrame(finalFrame)
        assertEquals("最终", final.text)
        assertTrue(final.final)
    }

    @Test
    fun rejectsDecompressedPayloadsOverTheLimit() {
        val oversizedBody = gzip(ByteArray(4 * 1024 * 1024 + 1))
        val frame = byteArrayOf(0x11, 0x91.toByte(), 0x11, 0x00) +
            int32Bytes(1) + uint32Bytes(oversizedBody.size) + oversizedBody

        try {
            parseDoubaoSpeechFrame(frame)
            throw AssertionError("expected oversized payload rejection")
        } catch (error: IllegalArgumentException) {
            assertEquals("doubao decompressed payload is too large", error.message)
        }
    }

    private fun readUint32(bytes: ByteArray, offset: Int): Int =
        ((bytes[offset].toInt() and 0xff) shl 24) or
            ((bytes[offset + 1].toInt() and 0xff) shl 16) or
            ((bytes[offset + 2].toInt() and 0xff) shl 8) or
            (bytes[offset + 3].toInt() and 0xff)

    private fun gunzip(bytes: ByteArray): ByteArray =
        GZIPInputStream(ByteArrayInputStream(bytes)).use { it.readBytes() }
}
