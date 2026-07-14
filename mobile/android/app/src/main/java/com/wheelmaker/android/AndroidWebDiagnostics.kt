package com.wheelmaker.android

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.Locale

interface AndroidDiagnosticLogLevelStore {
    fun loadDiagnosticLogLevel(): String
    fun saveDiagnosticLogLevel(logLevel: String)
}

class SharedPreferencesAndroidDiagnosticLogLevelStore(context: Context) : AndroidDiagnosticLogLevelStore {
    private val prefs = context.getSharedPreferences("wheelmaker_debug", Context.MODE_PRIVATE)

    override fun loadDiagnosticLogLevel(): String =
        normalizedDiagnosticLogLevelSetting(prefs.getString("diagnosticLogLevel", null) ?: "warning")

    override fun saveDiagnosticLogLevel(logLevel: String) {
        prefs.edit()
            .putString("diagnosticLogLevel", normalizedDiagnosticLogLevelSetting(logLevel))
            .apply()
    }
}

class AndroidWebDiagnostics(
    private val capacity: Int = 120,
    logLevel: String = "warning",
    private val now: () -> Long = { System.currentTimeMillis() }
) {
    private val records = ArrayDeque<AndroidWebDiagnosticRecord>()
    private var logLevel: String = normalizedDiagnosticLogLevelSetting(logLevel)

    @Synchronized
    fun getLogLevel(): String = logLevel

    @Synchronized
    fun setLogLevel(logLevel: String) {
        this.logLevel = normalizedDiagnosticLogLevelSetting(logLevel)
    }

    @Synchronized
    fun record(nativeEvent: String, details: Map<String, Any?> = emptyMap(), level: String = "info") {
        val normalizedLevel = normalizedDiagnosticLevel(level)
        if (!shouldRecordDiagnosticLevel(normalizedLevel, logLevel)) {
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
                level = normalizedLevel,
                details = recordDetails
            )
        )
        while (records.size > maxOf(1, capacity)) {
            records.removeFirst()
        }
    }

    @Synchronized
    fun clear() {
        records.clear()
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
        "debug" -> "info"
        "warn" -> "warn"
        "warning" -> "warn"
        "error" -> "error"
        else -> "info"
    }
}

private fun normalizedDiagnosticLogLevelSetting(logLevel: String): String {
    return when (logLevel.lowercase(Locale.US)) {
        "debug" -> "debug"
        "info" -> "info"
        "warn" -> "warning"
        "warning" -> "warning"
        "error" -> "error"
        else -> "warning"
    }
}

private fun diagnosticLevelOrder(level: String): Int {
    return when (level) {
        "debug" -> 0
        "info" -> 1
        "warn" -> 2
        "warning" -> 2
        "error" -> 3
        else -> 2
    }
}

private fun shouldRecordDiagnosticLevel(recordLevel: String, logLevel: String): Boolean {
    return diagnosticLevelOrder(recordLevel) >= diagnosticLevelOrder(logLevel)
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
