package com.wheelmaker.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class WindowInsetPaddingTest {
    @Test
    fun mergesSystemBarsAndDisplayCutoutByTakingLargestEdge() {
        val safeArea = mergedSafeAreaInsets(
            systemBars = EdgeInsets(left = 0, top = 44, right = 0, bottom = 24),
            displayCutout = EdgeInsets(left = 8, top = 88, right = 12, bottom = 0)
        )

        assertEquals(8, safeArea.left)
        assertEquals(88, safeArea.top)
        assertEquals(12, safeArea.right)
        assertEquals(24, safeArea.bottom)
    }

    @Test
    fun keepsZeroInsetsWhenNoSystemOverlapExists() {
        val safeArea = mergedSafeAreaInsets(
            systemBars = EdgeInsets(left = 0, top = 0, right = 0, bottom = 0),
            displayCutout = EdgeInsets(left = 0, top = 0, right = 0, bottom = 0)
        )

        assertEquals(EdgeInsets(left = 0, top = 0, right = 0, bottom = 0), safeArea)
    }

    @Test
    fun usesImeBottomInsetWhenKeyboardOverlapsContent() {
        val contentInsets = mergedContentInsets(
            systemBars = EdgeInsets(left = 0, top = 44, right = 0, bottom = 24),
            displayCutout = EdgeInsets(left = 8, top = 0, right = 12, bottom = 0),
            ime = EdgeInsets(left = 0, top = 0, right = 0, bottom = 312)
        )

        assertEquals(EdgeInsets(left = 8, top = 44, right = 12, bottom = 312), contentInsets)
    }

    @Test
    fun keepsNavigationBarBottomInsetWhenKeyboardIsHidden() {
        val contentInsets = mergedContentInsets(
            systemBars = EdgeInsets(left = 0, top = 44, right = 0, bottom = 24),
            displayCutout = EdgeInsets(left = 0, top = 0, right = 0, bottom = 0),
            ime = EdgeInsets(left = 0, top = 0, right = 0, bottom = 0)
        )

        assertEquals(EdgeInsets(left = 0, top = 44, right = 0, bottom = 24), contentInsets)
    }

    @Test
    fun mainActivityAppliesAndConsumesImeInsetsForWebViewResize() {
        val mainActivity = String(Files.readAllBytes(
            Paths.get("src/main/java/com/wheelmaker/android/MainActivity.kt")
        ))

        assertTrue(mainActivity.contains("WindowInsetsCompat.Type.ime()"))
        assertTrue(mainActivity.contains("mergedContentInsets("))
        assertTrue(mainActivity.contains(".setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)"))
    }

    @Test
    fun manifestRequestsResizeForSoftKeyboard() {
        val manifest = String(Files.readAllBytes(
            Paths.get("src/main/AndroidManifest.xml")
        ))

        assertTrue(manifest.contains("android:windowSoftInputMode=\"adjustResize\""))
    }
}
