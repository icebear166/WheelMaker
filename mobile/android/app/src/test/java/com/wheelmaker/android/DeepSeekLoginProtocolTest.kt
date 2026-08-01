package com.wheelmaker.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class DeepSeekLoginProtocolTest {
    private fun source(path: String): String =
        String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun `extracts token from script result`() {
        val token = "abcdefghijklmnopqrstuvwxyz012345"
        assertEquals(token, extractDeepSeekToken("\"$token\""))
        assertEquals(token, extractDeepSeekToken("Bearer $token"))
        assertNull(extractDeepSeekToken("\"\""))
        assertNull(extractDeepSeekToken("short"))
    }

    @Test
    fun `login screen is a full-screen in-app page`() {
        val dialogSource = source("src/main/java/com/wheelmaker/android/DeepSeekLoginDialog.kt")
        assertTrue(dialogSource.contains("FEATURE_NO_TITLE"))
        assertTrue(dialogSource.contains("ViewGroup.LayoutParams.MATCH_PARENT,\n            ViewGroup.LayoutParams.MATCH_PARENT"))
        assertTrue(dialogSource.contains("useWideViewPort = true"))
        assertTrue(dialogSource.contains("loadWithOverviewMode = true"))
        assertTrue(dialogSource.contains("onReceivedError"))
        assertTrue(dialogSource.contains("onReceivedHttpError"))
        assertTrue(dialogSource.contains("Blocked navigation"))
        assertTrue(dialogSource.contains("Retry"))
        assertFalse(dialogSource.contains("AlertDialog"))
    }

    @Test
    fun `token script reads userToken key precisely`() {
        assertTrue(DEEP_SEEK_TOKEN_SCRIPT.contains("localStorage.getItem('userToken')"))
        assertFalse(DEEP_SEEK_TOKEN_SCRIPT.contains("localStorage.key("))
    }
}
