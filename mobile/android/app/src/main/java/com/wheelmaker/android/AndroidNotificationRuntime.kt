package com.wheelmaker.android

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

private const val NOTIFICATION_TYPE_PROMPT_COMPLETED = "chat.prompt.completed"
private const val NOTIFICATION_CHANNEL_PROMPT_COMPLETION = "chat_prompt_completion"
private const val NOTIFICATION_TARGET_URL_EXTRA = "com.wheelmaker.android.NOTIFICATION_TARGET_URL"
private const val NOTIFICATION_PERMISSION_EVENT = "wheelmaker:android-notification-permission"

fun isSupportedWheelMakerNotificationType(type: String): Boolean {
    return type == NOTIFICATION_TYPE_PROMPT_COMPLETED
}

fun notificationTargetUrl(intent: Intent?): String? {
    return intent?.getStringExtra(NOTIFICATION_TARGET_URL_EXTRA)
}

class AndroidNotificationRuntime(
    private val activity: Activity,
    private val webView: WebView,
    private val notificationPermissionRequestCode: Int,
    private val baseUrlProvider: () -> String = { "" }
) {
    fun getPermissionState(): String {
        return permissionStateJson(permissionState())
    }

    fun requestPermission(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return permissionStateJson("granted")
        }
        if (permissionState() == "granted") {
            return permissionStateJson("granted")
        }
        activity.runOnUiThread {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                notificationPermissionRequestCode
            )
        }
        return permissionStateJson("default", pending = true)
    }

    @SuppressLint("MissingPermission")
    fun showNotification(rawJson: String): String {
        return try {
            val input = JSONObject(rawJson)
            val type = input.optString("type")
            if (!isSupportedWheelMakerNotificationType(type)) {
                return resultJson(false, "unsupported_type")
            }
            if (permissionState() != "granted") {
                return resultJson(false, "permission_denied")
            }
            val projectId = input.optString("projectId")
            val sessionId = input.optString("sessionId")
            if (projectId.isBlank() || sessionId.isBlank()) {
                return resultJson(false, "invalid_target")
            }
            createPromptCompletionChannel()
            val title = input.optString("title", "Prompt completed")
            val body = input.optString("body", "WheelMaker")
            val statusColor = when (input.optString("status")) {
                "failed" -> 0xFFFF453A.toInt()
                "cancelled", "interrupted" -> 0xFF8E8E93.toInt()
                else -> 0xFF34C759.toInt()
            }
            val notificationId = notificationId(projectId, sessionId)
            val pendingIntent = PendingIntent.getActivity(
                activity,
                notificationId,
                notificationIntent(projectId, sessionId),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val notification = NotificationCompat.Builder(activity, NOTIFICATION_CHANNEL_PROMPT_COMPLETION)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(statusColor)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()
            NotificationManagerCompat.from(activity).notify(notificationId, notification)
            resultJson(true)
        } catch (_: Exception) {
            resultJson(false, "invalid_payload")
        }
    }

    fun onRequestPermissionsResult(requestCode: Int, grantResults: IntArray): Boolean {
        if (requestCode != notificationPermissionRequestCode) {
            return false
        }
        val state = if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            "granted"
        } else {
            "denied"
        }
        dispatchPermissionStateEvent(state)
        return true
    }

    private fun permissionState(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return "granted"
        }
        return if (ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            "granted"
        } else {
            "default"
        }
    }

    private fun createPromptCompletionChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            NOTIFICATION_CHANNEL_PROMPT_COMPLETION,
            "Prompt completions",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "WheelMaker chat prompt completion notifications"
        }
        manager.createNotificationChannel(channel)
    }

    private fun notificationIntent(projectId: String, sessionId: String): Intent {
        return Intent(activity, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(NOTIFICATION_TARGET_URL_EXTRA, buildNotificationTargetUrl(projectId, sessionId))
        }
    }

    private fun dispatchPermissionStateEvent(state: String) {
        val detail = permissionStateJson(state)
        val script = """
            window.dispatchEvent(new CustomEvent('$NOTIFICATION_PERMISSION_EVENT', { detail: $detail }));
        """.trimIndent()
        webView.post {
            webView.evaluateJavascript(script, null)
        }
    }

    private fun buildNotificationTargetUrl(projectId: String, sessionId: String): String {
        val baseUrl = baseUrlProvider()
        val normalized = normalizeHttpsBaseUrl(baseUrl) ?: return baseUrl
        return Uri.parse(normalized)
            .buildUpon()
            .clearQuery()
            .fragment(null)
            .appendQueryParameter("wmProjectId", projectId)
            .appendQueryParameter("wmSessionId", sessionId)
            .build()
            .toString()
    }
}

private fun notificationId(projectId: String, sessionId: String): Int {
    return "$projectId:$sessionId".hashCode() and 0x7fffffff
}

private fun permissionStateJson(state: String, pending: Boolean = false): String {
    return JSONObject()
        .put("state", state)
        .put("pending", pending)
        .toString()
}

private fun resultJson(ok: Boolean, error: String = ""): String {
    val output = JSONObject().put("ok", ok)
    if (error.isNotBlank()) {
        output.put("error", error)
    }
    return output.toString()
}
