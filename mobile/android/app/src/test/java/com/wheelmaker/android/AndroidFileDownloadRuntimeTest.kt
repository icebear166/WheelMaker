package com.wheelmaker.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class AndroidFileDownloadRuntimeTest {
    private val validToken = "abcdefghijklmnopqrstuvwxyzABCDEFGH123456789"

    @Test
    fun acceptsOnlyExactConfiguredDownloadCapabilityUrl() {
        val valid = "https://example.com/app/ws/download/$validToken"
        assertTrue(isTrustedRegistryDownloadUrl("https://example.com/app/", valid))

        for (url in listOf(
            "http://example.com/app/ws/download/$validToken",
            "https://evil.example/app/ws/download/$validToken",
            "https://example.com:444/app/ws/download/$validToken",
            "https://user@example.com/app/ws/download/$validToken",
            "https://example.com/other/ws/download/$validToken",
            "https://example.com/app/download/$validToken",
            "https://example.com/app/ws/download/$validToken/extra",
            "https://example.com/app/ws/download/$validToken?query=1",
            "https://example.com/app/ws/download/$validToken#fragment",
            "https://example.com/app/ws/download/%2e%2e/$validToken",
            "https://example.com/app/ws/download/short"
        )) {
            assertFalse(url, isTrustedRegistryDownloadUrl("https://example.com/app/", url))
        }
    }

    @Test
    fun enqueuesCookieAuthenticatedPublicDownloadWithSafeMetadata() {
        val requests = mutableListOf<AndroidFileDownloadRequest>()
        val runtime = AndroidFileDownloadRuntime(
            configuredBaseUrl = { "https://example.com/app/" },
            cookieProvider = { "wm_session=session-1" },
            userAgentProvider = { "WheelMaker Android" },
            enqueue = {
                requests += it
                42L
            }
        )
        val url = "https://example.com/app/ws/download/$validToken"

        val downloadId = runtime.start(
            url = url,
            fileName = "../report\u0000.pdf",
            mimeType = "application/pdf",
            size = 12_345L
        )

        assertEquals(42L, downloadId)
        assertEquals(1, requests.size)
        assertEquals(
            AndroidFileDownloadRequest(
                url = url,
                fileName = "report.pdf",
                mimeType = "application/pdf",
                size = 12_345L,
                cookie = "wm_session=session-1",
                userAgent = "WheelMaker Android",
                destinationDirectory = "Downloads",
                notificationVisibleOnCompletion = true
            ),
            requests.single()
        )
    }

    @Test
    fun rejectsUntrustedUrlBeforeReadingCookiesOrEnqueueing() {
        var cookieCalls = 0
        var enqueueCalls = 0
        val runtime = AndroidFileDownloadRuntime(
            configuredBaseUrl = { "https://example.com/app/" },
            cookieProvider = {
                cookieCalls += 1
                "secret"
            },
            userAgentProvider = { "WheelMaker Android" },
            enqueue = {
                enqueueCalls += 1
                1L
            }
        )

        assertTrue(runCatching {
            runtime.start(
                "https://evil.example/app/ws/download/$validToken",
                "file.txt",
                "text/plain",
                10L
            )
        }.isFailure)
        assertEquals(0, cookieCalls)
        assertEquals(0, enqueueCalls)
    }

    @Test
    fun bridgeConsumesDownloadGrantAndMainActivityForwardsAuthenticatedRequest() {
        val bridge = source("src/main/java/com/wheelmaker/android/WheelMakerBridge.kt")
        val activity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")

        assertTrue(bridge.contains("\"file.download.start\" -> startFileDownload(payload)"))
        assertTrue(bridge.contains("\"file.download\""))
        assertTrue(bridge.contains("trustedNativeActionGrantStore.consume("))
        assertTrue(activity.contains("CookieManager.getInstance().getCookie(url)"))
        assertTrue(activity.contains("addRequestHeader(\"Cookie\", download.cookie)"))
        assertTrue(activity.contains("Environment.DIRECTORY_DOWNLOADS, download.fileName"))
        assertTrue(activity.contains("VISIBILITY_VISIBLE_NOTIFY_COMPLETED"))
    }

    private fun source(path: String): String = String(Files.readAllBytes(Paths.get(path)))
}
