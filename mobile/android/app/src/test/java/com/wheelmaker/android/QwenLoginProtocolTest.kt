package com.wheelmaker.android

import org.junit.Assert.assertNull
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QwenLoginProtocolTest {
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
