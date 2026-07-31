package com.wheelmaker.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class MainActivityWebCacheTest {
    private val source: String
        get() = String(Files.readAllBytes(
            Paths.get("src/main/java/com/wheelmaker/android/MainActivity.kt")
        ))

    @Test
    fun webViewKeepsHttpCacheForHashedRemoteAssets() {
        val mainActivity = source

        assertTrue(mainActivity.contains("target.settings.cacheMode = WebSettings.LOAD_DEFAULT"))
    }

    @Test
    fun savedServerLoadsWithoutPreflightProbe() {
        val body = source.substringAfter("private fun startInitialNavigation")
            .substringBefore("private fun probeAndLoad")

        assertTrue(body.contains("loadConfiguredRemote"))
        assertFalse(body.contains("probeAndLoad"))
    }
}
