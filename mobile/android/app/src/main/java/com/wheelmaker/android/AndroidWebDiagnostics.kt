package com.wheelmaker.android

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.Locale

interface AndroidDebugLoggingStore {
    fun loadDebugLoggingEnabled(): Boolean
    fun saveDebugLoggingEnabled(enabled: Boolean)
}

class SharedPreferencesAndroidDebugLoggingStore(context: Context) : AndroidDebugLoggingStore {
    private val prefs = context.getSharedPreferences("wheelmaker_debug", Context.MODE_PRIVATE)

    override fun loadDebugLoggingEnabled(): Boolean = prefs.getBoolean("debugLoggingEnabled", false)

    override fun saveDebugLoggingEnabled(enabled: Boolean) {
        prefs.edit()
            .putBoolean("debugLoggingEnabled", enabled)
            .apply()
    }
}

class AndroidWebDiagnostics(
    private val capacity: Int = 120,
    enabled: Boolean = false,
    private val now: () -> Long = { System.currentTimeMillis() }
) {
    private val records = ArrayDeque<AndroidWebDiagnosticRecord>()
    private var enabled: Boolean = enabled

    @Synchronized
    fun isEnabled(): Boolean = enabled

    @Synchronized
    fun setEnabled(enabled: Boolean) {
        this.enabled = enabled
        if (!enabled) {
            records.clear()
        }
    }

    @Synchronized
    fun record(nativeEvent: String, details: Map<String, Any?> = emptyMap(), level: String = "info") {
        if (!enabled) {
            return
        }
        val timestamp = now()
        val recordDetails = linkedMapOf<String, Any?>(
            "nativeEvent" to cleanNativeEvent(nativeEvent),
            "nativeTimestamp" to timestamp
        )
        for ((key, value) in details) {
            if (key.isBlank() || key == "nativeEvent" || key == "nativeTimestamp") {
                continue
            }
            recordDetails[key] = value
        }
        records.addLast(
            AndroidWebDiagnosticRecord(
                level = normalizedDiagnosticLevel(level),
                details = recordDetails
            )
        )
        while (records.size > maxOf(1, capacity)) {
            records.removeFirst()
        }
    }

    @Synchronized
    fun drainJson(): String {
        val snapshot = records.toList()
        records.clear()

        val output = JSONArray()
        for (record in snapshot) {
            output.put(
                JSONObject()
                    .put("level", record.level)
                    .put("event", "android_web")
                    .put("details", detailsToJson(record.details))
            )
        }
        return JSONObject()
            .put("records", output)
            .toString()
    }
}

private data class AndroidWebDiagnosticRecord(
    val level: String,
    val details: Map<String, Any?>
)

private fun cleanNativeEvent(nativeEvent: String): String {
    return nativeEvent.takeIf { it.isNotBlank() } ?: "unknown"
}

private fun normalizedDiagnosticLevel(level: String): String {
    return when (level.lowercase(Locale.US)) {
        "warn" -> "warn"
        "error" -> "error"
        else -> "info"
    }
}

private fun detailsToJson(details: Map<String, Any?>): JSONObject {
    val output = JSONObject()
    for ((key, value) in details) {
        output.put(key, diagnosticJsonValue(value))
    }
    return output
}

private fun diagnosticJsonValue(value: Any?): Any {
    return when (value) {
        null -> JSONObject.NULL
        is String -> value
        is Number -> value
        is Boolean -> value
        else -> value.toString()
    }
}
