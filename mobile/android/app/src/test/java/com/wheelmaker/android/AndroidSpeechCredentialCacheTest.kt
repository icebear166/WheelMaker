package com.wheelmaker.android

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class AndroidSpeechCredentialCacheTest {
    private fun source(path: String): String = String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun credentialLivesOnlyInTheConfiguredRuntimeCache() {
        val configured = AndroidSpeechCredentialCache()
        val fresh = AndroidSpeechCredentialCache()

        configured.configure("secret-access-token", "credential-v1")

        assertEquals("secret-access-token", configured.snapshot()?.accessToken)
        assertEquals("credential-v1", configured.snapshot()?.version)
        assertNull(fresh.snapshot())
        configured.clear()
        assertNull(configured.snapshot())
    }

    @Test
    fun publicStateNeverContainsTheCredential() {
        val cache = AndroidSpeechCredentialCache()
        cache.configure("secret-access-token", "credential-v1")

        val state = JSONObject(cache.stateJson())

        assertTrue(state.getBoolean("configured"))
        assertEquals("credential-v1", state.getString("version"))
        assertFalse(cache.stateJson().contains("secret-access-token"))
        assertFalse(state.has("accessToken"))
    }

    @Test
    fun runtimeUsesDirectClientAndDoesNotPersistOrEmitPcm() {
        val runtime = source("src/main/java/com/wheelmaker/android/AndroidSpeechRuntime.kt")
        val production = listOf(
            "AndroidSpeechRuntime.kt",
            "AndroidSpeechBridgeProtocol.kt",
            "DoubaoSpeechClient.kt",
            "DoubaoSpeechProtocol.kt"
        ).filter { Files.exists(Paths.get("src/main/java/com/wheelmaker/android", it)) }
            .joinToString("\n") { source("src/main/java/com/wheelmaker/android/$it") }

        assertTrue(runtime.contains("DoubaoSpeechClient("))
        assertTrue(runtime.contains("NOT_CONFIGURED"))
        assertTrue(runtime.contains("AndroidSpeechEvent.Transcript"))
        assertFalse(runtime.contains("AndroidSpeechEvent.Audio"))
        assertFalse(production.contains("SharedPreferences"))
        assertFalse(production.contains("openFileOutput"))
    }
}
