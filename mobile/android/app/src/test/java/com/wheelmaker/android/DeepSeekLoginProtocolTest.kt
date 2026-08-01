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
    fun `login dialog sizes the webview and loads after showing`() {
        val dialogSource = source("src/main/java/com/wheelmaker/android/DeepSeekLoginDialog.kt")
        assertTrue(dialogSource.contains("layoutParams ="))
        assertTrue(dialogSource.indexOf("dialog.show()") in 0 until dialogSource.indexOf("webView.loadUrl"))
        assertTrue(dialogSource.contains("dialog.window?.setLayout"))
        assertTrue(dialogSource.contains("onReceivedError"))
        assertTrue(dialogSource.contains("onReceivedHttpError"))
        assertTrue(dialogSource.contains("Blocked navigation"))
    }

    @Test
    fun `token script reads userToken key precisely`() {
        assertTrue(DEEP_SEEK_TOKEN_SCRIPT.contains("localStorage.getItem('userToken')"))
        assertFalse(DEEP_SEEK_TOKEN_SCRIPT.contains("localStorage.key("))
    }
}
