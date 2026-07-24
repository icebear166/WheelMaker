package com.wheelmaker.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustedNativeUserActionTest {
    @Test
    fun gestureIsRecentSingleUseAndClearable() {
        val gate = TrustedUserGestureGate(maxAgeMillis = 5_000)

        gate.record(10_000)
        assertTrue(gate.consume(14_999))
        assertFalse(gate.consume(15_000))

        gate.record(20_000)
        gate.clear()
        assertFalse(gate.consume(20_001))
    }

    @Test
    fun gestureRejectsMissingExpiredAndFutureEvidence() {
        val gate = TrustedUserGestureGate(maxAgeMillis = 5_000)

        assertFalse(gate.consume(1_000))
        gate.record(10_000)
        assertFalse(gate.consume(9_999))
        gate.record(10_000)
        assertFalse(gate.consume(15_001))
    }

    @Test
    fun grantsAreActionBoundSingleUseExpiredAndClearable() {
        var now = 1_000L
        val grants = TrustedNativeActionGrantStore(
            now = { now },
            ttlMillis = 60_000,
            capacity = 2
        )

        val token = grants.issue("image.share")
        assertFalse(grants.consume(token, "speech.start"))
        assertFalse(grants.consume(token, "image.share"))

        val usable = grants.issue("image.share")
        assertTrue(grants.consume(usable, "image.share"))
        assertFalse(grants.consume(usable, "image.share"))

        val expired = grants.issue("speech.start")
        now = 61_001
        assertFalse(grants.consume(expired, "speech.start"))

        val cleared = grants.issue("image.share")
        grants.clear()
        assertFalse(grants.consume(cleared, "image.share"))
    }

    @Test
    fun grantsEvictOldestAtCapacityAndRejectUnsupportedActions() {
        val grants = TrustedNativeActionGrantStore(
            now = { 1_000 },
            ttlMillis = 60_000,
            capacity = 2
        )

        val first = grants.issue("image.share")
        val second = grants.issue("speech.start")
        val third = grants.issue("image.share")

        assertFalse(grants.consume(first, "image.share"))
        assertTrue(grants.consume(second, "speech.start"))
        assertTrue(grants.consume(third, "image.share"))
        val htmlShare = grants.issue("html.share")
        assertTrue(grants.consume(htmlShare, "html.share"))
        assertTrue(runCatching { grants.issue("apk.install") }.isFailure)
    }
}
