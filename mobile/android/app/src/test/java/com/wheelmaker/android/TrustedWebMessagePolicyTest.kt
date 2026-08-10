package com.wheelmaker.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustedWebMessagePolicyTest {
    private val policy = TrustedWebMessagePolicy("https://example.com/app/")

    @Test
    fun bootstrapOnlyAcceptsItsExactOriginMainFrameAndAllowlist() {
        val request = TrustedWebMessageRequest("request-1", "bootstrap.getState")

        assertTrue(authorizeBootstrap(request))
        assertFalse(authorizeBootstrap(request, sourceOrigin = "https://evil.example"))
        assertFalse(authorizeBootstrap(request, isMainFrame = false))
        assertFalse(authorizeBootstrap(request.copy(action = "speech.start")))
    }

    @Test
    fun businessMessagesRequireExactConfiguredOriginAndBasePath() {
        val request = TrustedWebMessageRequest("request-2", "diagnostics.drain")

        assertTrue(authorizeBusiness(request))
        assertFalse(authorizeBusiness(request, sourceOrigin = "https://example.com:444"))
        assertFalse(authorizeBusiness(request, topLevelUrl = "https://example.com/other/"))
        assertFalse(authorizeBusiness(request.copy(action = "bootstrap.reset")))
    }

    @Test
    fun sensitiveActionsUseNativeGestureConsumerAfterTrustChecks() {
        var consumeCount = 0
        val consumeGesture = {
            consumeCount += 1
            true
        }

        assertTrue(authorizeBusiness(
            TrustedWebMessageRequest("request-3", "apk.install"),
            consumeTrustedUserGesture = consumeGesture
        ))
        assertTrue(authorizeBusiness(
            TrustedWebMessageRequest("request-4", "diagnostics.drain"),
            consumeTrustedUserGesture = consumeGesture
        ))
        assertFalse(authorizeBusiness(
            TrustedWebMessageRequest("request-5", "apk.install"),
            sourceOrigin = "https://evil.example",
            consumeTrustedUserGesture = consumeGesture
        ))
        assertEquals(1, consumeCount)
        assertFalse(authorizeBusiness(
            TrustedWebMessageRequest("request-6", "userAction.reserve"),
            consumeTrustedUserGesture = { false }
        ))
    }

    @Test
    fun deferredActionsRequireActionGrantAtDispatchInsteadOfImmediateGesture() {
        val noGesture = { false }

        for (action in listOf(
            "speech.start",
            "image.share.begin",
            "image.share.chunk",
            "image.share.commit",
            "image.share.cancel",
            "html.share.begin",
            "html.share.chunk",
            "html.share.commit",
            "html.share.cancel",
            "file.download.start"
        )) {
            assertTrue(authorizeBusiness(
                TrustedWebMessageRequest("deferred-$action", action),
                consumeTrustedUserGesture = noGesture
            ))
        }
    }

    @Test
    fun authorizationReturnsShortLivedActionBoundCapability() {
        val capability = policy.authorize(
            surface = TrustedMessageSurface.BUSINESS,
            sourceOrigin = "https://example.com",
            isMainFrame = true,
            topLevelUrl = "https://example.com/app/",
            nowElapsedRealtime = 20_000,
            request = TrustedWebMessageRequest("request-7", "image.share.begin"),
            consumeTrustedUserGesture = { false }
        )

        assertTrue(capability != null)
        assertTrue(capability!!.allows("image.share.begin", 20_999))
        assertFalse(capability.allows("apk.install", 20_999))
        assertFalse(capability.allows("image.share.begin", 21_001))
    }

    private fun authorizeBootstrap(
        request: TrustedWebMessageRequest,
        sourceOrigin: String = "https://appassets.androidplatform.net",
        isMainFrame: Boolean = true,
        consumeTrustedUserGesture: () -> Boolean = { false }
    ): Boolean = policy.isAllowed(
        surface = TrustedMessageSurface.BOOTSTRAP,
        sourceOrigin = sourceOrigin,
        isMainFrame = isMainFrame,
        topLevelUrl = ANDROID_BOOTSTRAP_URL,
        nowElapsedRealtime = 2_000,
        request = request,
        consumeTrustedUserGesture = consumeTrustedUserGesture
    )

    private fun authorizeBusiness(
        request: TrustedWebMessageRequest,
        sourceOrigin: String = "https://example.com",
        topLevelUrl: String = "https://example.com/app/chat",
        consumeTrustedUserGesture: () -> Boolean = { false }
    ): Boolean = policy.isAllowed(
        surface = TrustedMessageSurface.BUSINESS,
        sourceOrigin = sourceOrigin,
        isMainFrame = true,
        topLevelUrl = topLevelUrl,
        nowElapsedRealtime = 2_000,
        request = request,
        consumeTrustedUserGesture = consumeTrustedUserGesture
    )

    private fun assertEquals(expected: Int, actual: Int) {
        org.junit.Assert.assertEquals(expected, actual)
    }
}
