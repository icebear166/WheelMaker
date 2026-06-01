package com.wheelmaker.android

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
    fun webViewDoesNotLoadWorkspaceShellFromHttpCache() {
        val mainActivity = source

        assertTrue(mainActivity.contains("target.settings.cacheMode = WebSettings.LOAD_NO_CACHE"))
    }
}
