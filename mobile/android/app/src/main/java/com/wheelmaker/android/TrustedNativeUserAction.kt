package com.wheelmaker.android

import android.os.SystemClock
import java.util.LinkedHashMap
import java.util.UUID

class TrustedUserGestureGate(
    private val maxAgeMillis: Long = 5_000L
) {
    private var recordedAtElapsedRealtime = 0L

    @Synchronized
    fun record(nowElapsedRealtime: Long) {
        recordedAtElapsedRealtime = nowElapsedRealtime
    }

    @Synchronized
    fun consume(nowElapsedRealtime: Long): Boolean {
        val recordedAt = recordedAtElapsedRealtime
        recordedAtElapsedRealtime = 0L
        if (recordedAt <= 0) return false
        val age = nowElapsedRealtime - recordedAt
        return age in 0..maxAgeMillis
    }

    @Synchronized
    fun clear() {
        recordedAtElapsedRealtime = 0L
    }
}

class TrustedNativeActionGrantStore(
    private val now: () -> Long = { SystemClock.elapsedRealtime() },
    private val ttlMillis: Long = 60_000L,
    private val capacity: Int = 8
) {
    private data class Grant(
        val action: String,
        val expiresAtElapsedRealtime: Long
    )

    private val grants = LinkedHashMap<String, Grant>()

    @Synchronized
    fun issue(action: String): String {
        require(action in SUPPORTED_ACTIONS) { "unsupported deferred native action" }
        pruneExpired()
        while (grants.size >= capacity.coerceAtLeast(1)) {
            grants.remove(grants.keys.first())
        }
        val token = UUID.randomUUID().toString()
        grants[token] = Grant(action, now() + ttlMillis)
        return token
    }

    @Synchronized
    fun consume(token: String, action: String): Boolean {
        pruneExpired()
        val grant = grants.remove(token) ?: return false
        return grant.action == action
    }

    @Synchronized
    fun clear() {
        grants.clear()
    }

    private fun pruneExpired() {
        val current = now()
        grants.entries.removeAll { it.value.expiresAtElapsedRealtime < current }
    }

    private companion object {
        val SUPPORTED_ACTIONS = setOf("image.share", "html.share", "speech.start")
    }
}
