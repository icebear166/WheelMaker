package com.wheelmaker.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class AndroidImageShareRuntimeTest {
    private fun source(path: String): String =
        String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun bridgeExposesResponseImageShareMethod() {
        val bridge = source("src/main/java/com/wheelmaker/android/WheelMakerBridge.kt")
        val mainActivity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")

        assertTrue(bridge.contains("private val androidImageShareRuntime: AndroidImageShareRuntime"))
        assertTrue(bridge.contains("\"image.share.begin\""))
        assertTrue(bridge.contains("\"image.share.chunk\""))
        assertTrue(bridge.contains("\"image.share.commit\""))
        assertTrue(bridge.contains("\"image.share.cancel\""))
        assertTrue(bridge.contains("androidImageShareRuntime.begin(payload.toString())"))
        assertTrue(bridge.contains("androidImageShareRuntime.append(payload.toString())"))
        assertTrue(bridge.contains("androidImageShareRuntime.commit(payload.toString())"))
        assertTrue(bridge.contains("androidImageShareRuntime.cancel(payload.toString())"))
        assertTrue(mainActivity.contains("private lateinit var androidImageShareRuntime: AndroidImageShareRuntime"))
        assertTrue(mainActivity.contains("AndroidImageShareRuntime(this)"))
    }

    @Test
    fun providerAllowsTemporaryResponseImageShares() {
        val providerPaths = source("src/main/res/xml/apk_update_paths.xml")

        assertTrue(providerPaths.contains("image_shares"))
        assertTrue(providerPaths.contains("image-shares/"))
    }

    @Test
    fun runtimeUsesSystemImageShareIntentWithoutLocalSaveFallback() {
        val runtime = source("src/main/java/com/wheelmaker/android/AndroidImageShareRuntime.kt")

        assertTrue(runtime.contains("MAX_RESPONSE_IMAGE_BYTES = 16 * 1024 * 1024"))
        assertTrue(runtime.contains("MAX_RESPONSE_IMAGE_CHUNK_BYTES = 128 * 1024"))
        assertTrue(runtime.contains("AndroidImageShareTransferStore"))
        assertTrue(runtime.contains("Intent.ACTION_SEND"))
        assertTrue(runtime.contains("image/png"))
        assertTrue(runtime.contains("Intent.EXTRA_STREAM"))
        assertTrue(runtime.contains("ClipData.newUri"))
        assertTrue(runtime.contains("clipData = ClipData.newUri"))
        assertTrue(runtime.contains("Intent.FLAG_GRANT_READ_URI_PERMISSION"))
        assertTrue(runtime.contains("Intent.createChooser"))
        assertTrue(runtime.contains("FileProvider.getUriForFile"))
        assertFalse(runtime.contains("DownloadManager"))
        assertFalse(runtime.contains("MediaStore"))
        assertFalse(runtime.contains("DIRECTORY_DOWNLOADS"))
    }

    @Test
    fun serverSwitchClearsAllTransientNativeBridgeState() {
        val mainActivity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")

        assertTrue(mainActivity.contains("androidSpeechRuntime.clearCredential()"))
        assertTrue(mainActivity.contains("trustedUserGestureGate.clear()"))
        assertTrue(mainActivity.contains("trustedNativeActionGrantStore.clear()"))
        assertTrue(mainActivity.contains("androidImageShareRuntime.clear()"))
        assertTrue(mainActivity.contains("androidWebDiagnostics.clear()"))
    }
}
