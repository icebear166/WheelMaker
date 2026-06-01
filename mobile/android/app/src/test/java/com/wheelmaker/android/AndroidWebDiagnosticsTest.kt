package com.wheelmaker.android

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class AndroidWebDiagnosticsTest {
    private fun source(path: String): String =
        String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun drainsNativeWebEventsAsUploadableDiagnostics() {
        val diagnostics = AndroidWebDiagnostics(capacity = 3, now = { 1234L })

        diagnostics.record(
            "remote_asset_success",
            mapOf(
                "asset" to "index.html",
                "status" to 200,
                "remoteBase" to "https://workspace.example.com/"
            )
        )

        val records = JSONObject(diagnostics.drainJson()).getJSONArray("records")
        assertEquals(1, records.length())

        val record = records.getJSONObject(0)
        assertEquals("info", record.getString("level"))
        assertEquals("android_web", record.getString("event"))

        val details = record.getJSONObject("details")
        assertEquals("remote_asset_success", details.getString("nativeEvent"))
        assertEquals(1234L, details.getLong("nativeTimestamp"))
        assertEquals("index.html", details.getString("asset"))
        assertEquals(200, details.getInt("status"))
        assertEquals("https://workspace.example.com/", details.getString("remoteBase"))

        assertEquals(0, JSONObject(diagnostics.drainJson()).getJSONArray("records").length())
    }

    @Test
    fun keepsMostRecentNativeWebDiagnosticsWithinCapacity() {
        val diagnostics = AndroidWebDiagnostics(capacity = 2, now = { 1000L })

        diagnostics.record("first")
        diagnostics.record("second")
        diagnostics.record("third")

        val records = JSONObject(diagnostics.drainJson()).getJSONArray("records")
        assertEquals(2, records.length())
        assertEquals("second", records.getJSONObject(0).getJSONObject("details").getString("nativeEvent"))
        assertEquals("third", records.getJSONObject(1).getJSONObject("details").getString("nativeEvent"))
    }

    @Test
    fun recordsOnlyStableOriginAssetsThatHelpDiagnoseNativeWebSource() {
        assertTrue(shouldRecordStableOriginDiagnosticAsset("index.html"))
        assertTrue(shouldRecordStableOriginDiagnosticAsset("settings/update"))
        assertTrue(shouldRecordStableOriginDiagnosticAsset("bundle.abc123.js"))
        assertTrue(shouldRecordStableOriginDiagnosticAsset("styles.abc123.css"))
        assertTrue(shouldRecordStableOriginDiagnosticAsset("service-worker.js"))
        assertFalse(shouldRecordStableOriginDiagnosticAsset("font.abc123.woff2"))
        assertFalse(shouldRecordStableOriginDiagnosticAsset("image.abc123.png"))
    }

    @Test
    fun mainActivitySharesNativeWebDiagnosticsBetweenClientAndBridge() {
        val mainActivity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")
        val bridge = source("src/main/java/com/wheelmaker/android/WheelMakerBridge.kt")

        assertTrue(mainActivity.contains("private lateinit var androidWebDiagnostics: AndroidWebDiagnostics"))
        assertTrue(mainActivity.contains("StableOriginWebViewClient(this, webSourceRuntime, androidWebDiagnostics)"))
        assertTrue(mainActivity.contains("WheelMakerBridge("))
        assertTrue(mainActivity.contains("androidWebDiagnostics"))
        assertTrue(bridge.contains("fun drainWebDiagnostics(): String"))
    }
}
