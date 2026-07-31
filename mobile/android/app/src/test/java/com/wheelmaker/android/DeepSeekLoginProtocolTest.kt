package com.wheelmaker.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepSeekLoginProtocolTest {
    @Test
    fun `extracts token from script result`() {
        val token = "abcdefghijklmnopqrstuvwxyz012345"
        assertEquals(token, extractDeepSeekToken("\"$token\""))
        assertEquals(token, extractDeepSeekToken("Bearer $token"))
        assertNull(extractDeepSeekToken("\"\""))
        assertNull(extractDeepSeekToken("short"))
    }
}
