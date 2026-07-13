package com.wheelmaker.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustedWebMessagePolicyTest {
    private val policy = TrustedWebMessagePolicy("https://example.com/app/")

    @Test
    fun bootstrapOnlyAcceptsItsExactOriginMainFrameAndAllowlist() {
        val request = TrustedWebMessageRequest(
            requestId = "request-1",
            action = "bootstrap.getState",
            userGestureAt = null
        )

        assertTrue(policy.isAllowed(
            surface = TrustedMessageSurface.BOOTSTRAP,
            sourceOrigin = "https://appassets.androidplatform.net",
            isMainFrame = true,
            topLevelUrl = ANDROID_BOOTSTRAP_URL,
            navigationStartedAtElapsedRealtime = 1_000,
            nowElapsedRealtime = 2_000,
            request = request
        ))
        assertFalse(policy.isAllowed(
            surface = TrustedMessageSurface.BOOTSTRAP,
            sourceOrigin = "https://evil.example",
            isMainFrame = true,
            topLevelUrl = ANDROID_BOOTSTRAP_URL,
            navigationStartedAtElapsedRealtime = 1_000,
            nowElapsedRealtime = 2_000,
            request = request
        ))
        assertFalse(policy.isAllowed(
            surface = TrustedMessageSurface.BOOTSTRAP,
            sourceOrigin = "https://appassets.androidplatform.net",
            isMainFrame = false,
            topLevelUrl = ANDROID_BOOTSTRAP_URL,
            navigationStartedAtElapsedRealtime = 1_000,
            nowElapsedRealtime = 2_000,
            request = request
        ))
        assertFalse(policy.isAllowed(
            surface = TrustedMessageSurface.BOOTSTRAP,
            sourceOrigin = "https://appassets.androidplatform.net",
            isMainFrame = true,
            topLevelUrl = ANDROID_BOOTSTRAP_URL,
            navigationStartedAtElapsedRealtime = 1_000,
            nowElapsedRealtime = 2_000,
            request = request.copy(action = "speech.start")
        ))
    }

    @Test
    fun businessMessagesRequireExactConfiguredOriginAndBasePath() {
        val request = TrustedWebMessageRequest(
            requestId = "request-2",
            action = "diagnostics.drain",
            userGestureAt = null
        )

        assertTrue(policy.isAllowed(
            surface = TrustedMessageSurface.BUSINESS,
            sourceOrigin = "https://example.com",
            isMainFrame = true,
            topLevelUrl = "https://example.com/app/chat",
            navigationStartedAtElapsedRealtime = 1_000,
            nowElapsedRealtime = 2_000,
            request = request
        ))
        assertFalse(policy.isAllowed(
            surface = TrustedMessageSurface.BUSINESS,
            sourceOrigin = "https://example.com:444",
            isMainFrame = true,
            topLevelUrl = "https://example.com/app/chat",
            navigationStartedAtElapsedRealtime = 1_000,
            nowElapsedRealtime = 2_000,
            request = request
        ))
        assertFalse(policy.isAllowed(
            surface = TrustedMessageSurface.BUSINESS,
            sourceOrigin = "https://example.com",
            isMainFrame = true,
            topLevelUrl = "https://example.com/other/",
            navigationStartedAtElapsedRealtime = 1_000,
            nowElapsedRealtime = 2_000,
            request = request
        ))
        assertFalse(policy.isAllowed(
            surface = TrustedMessageSurface.BUSINESS,
            sourceOrigin = "https://example.com",
            isMainFrame = true,
            topLevelUrl = "https://example.com/app/chat",
            navigationStartedAtElapsedRealtime = 1_000,
            nowElapsedRealtime = 2_000,
            request = request.copy(action = "bootstrap.reset")
        ))
    }

    @Test
    fun sensitiveActionsRequireRecentPageGestureTimestamp() {
        val recent = TrustedWebMessageRequest(
            requestId = "request-3",
            action = "apk.install",
            userGestureAt = 6_000
        )

        assertTrue(policy.isAllowed(
            surface = TrustedMessageSurface.BUSINESS,
            sourceOrigin = "https://example.com",
            isMainFrame = true,
            topLevelUrl = "https://example.com/app/",
            navigationStartedAtElapsedRealtime = 10_000,
            nowElapsedRealtime = 20_000,
            request = recent
        ))
        assertFalse(policy.isAllowed(
            surface = TrustedMessageSurface.BUSINESS,
            sourceOrigin = "https://example.com",
            isMainFrame = true,
            topLevelUrl = "https://example.com/app/",
            navigationStartedAtElapsedRealtime = 10_000,
            nowElapsedRealtime = 21_001,
            request = recent
        ))
        assertFalse(policy.isAllowed(
            surface = TrustedMessageSurface.BUSINESS,
            sourceOrigin = "https://example.com",
            isMainFrame = true,
            topLevelUrl = "https://example.com/app/",
            navigationStartedAtElapsedRealtime = 10_000,
            nowElapsedRealtime = 20_000,
            request = recent.copy(userGestureAt = null)
        ))
    }

    @Test
    fun authorizationReturnsShortLivedActionBoundCapability() {
        val capability = policy.authorize(
            surface = TrustedMessageSurface.BUSINESS,
            sourceOrigin = "https://example.com",
            isMainFrame = true,
            topLevelUrl = "https://example.com/app/",
            navigationStartedAtElapsedRealtime = 10_000,
            nowElapsedRealtime = 20_000,
            request = TrustedWebMessageRequest("request-4", "image.share", 6_000)
        )

		assertTrue(capability != null)
		assertTrue(capability!!.allows("image.share", 20_999))
		assertFalse(capability.allows("apk.install", 20_999))
		assertFalse(capability.allows("image.share", 21_001))
    }
}
