package com.wheelmaker.android

import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class QwenLoginProtocolTest {
    private fun source(path: String): String =
        String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun `login screen is a resilient full-screen in-app page`() {
        val dialogSource = source("src/main/java/com/wheelmaker/android/QwenLoginDialog.kt")
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
    fun `extracts OAuth bundle and rejects non OAuth values`() {
        val bundle = extractQwenOAuth("\"{\\\"accessToken\\\":\\\"qwen-access-token\\\",\\\"refreshToken\\\":\\\"qwen-refresh-token\\\"}\"")
        assertTrue(bundle?.contains("qwen-access-token") == true)
        assertNull(extractQwenOAuth("\"\""))
        assertNull(extractQwenOAuth("{\"token\":\"ordinary-api-key\"}"))
    }

    @Test
    fun `callback accepts OAuth fields and rejects wrong state`() {
        val body = "{\"data\":{\"access_token\":\"qwen-access-token\",\"refresh_token\":\"qwen-refresh-token\"},\"cookie\":\"must-not-copy\"}"
        val bundle = qwenCallbackCredential("/?state=state-1", "application/json", body, "state-1")
        assertTrue(bundle?.contains("qwen-access-token") == true)
        assertTrue(bundle?.contains("cookie") != true)
        assertNull(qwenCallbackCredential("/?state=wrong", "application/json", body, "state-1"))
    }

    @Test
    fun `console dialog is scoped to Aliyun login origins`() {
        assertTrue(isQwenLoginUrl(QWEN_LOGIN_URL))
        assertTrue(isQwenLoginUrl("https://account.aliyun.com/login"))
        assertFalse(isQwenLoginUrl("http://bailian.console.aliyun.com/login"))
        assertFalse(isQwenLoginUrl("https://evil.aliyun.com/login"))
        assertFalse(isQwenLoginUrl("https://bailian.console.aliyun.com.evil.test/login"))
    }
}
