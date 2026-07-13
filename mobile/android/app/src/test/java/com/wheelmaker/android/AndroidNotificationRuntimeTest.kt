package com.wheelmaker.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class AndroidNotificationRuntimeTest {
    private fun source(path: String): String =
        String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun bridgeExposesNotificationMethods() {
        val bridge = source("src/main/java/com/wheelmaker/android/WheelMakerBridge.kt")

        assertTrue(bridge.contains("\"notification.requestPermission\""))
        assertTrue(bridge.contains("\"notification.getPermissionState\""))
        assertTrue(bridge.contains("\"notification.show\""))
    }

    @Test
    fun runtimeOnlyAllowsPromptCompletionNotifications() {
        assertTrue(isSupportedWheelMakerNotificationType("chat.prompt.completed"))
        assertFalse(isSupportedWheelMakerNotificationType("chat.message"))
        assertFalse(isSupportedWheelMakerNotificationType("update.completed"))

        val runtime = source("src/main/java/com/wheelmaker/android/AndroidNotificationRuntime.kt")
        assertTrue(runtime.contains("chat_prompt_completion"))
        assertTrue(runtime.contains("NotificationChannel("))
        assertTrue(runtime.contains("NotificationCompat.Builder("))
        assertTrue(runtime.contains("PendingIntent.getActivity("))
        assertTrue(runtime.contains("wheelmaker:android-notification-permission"))
        assertTrue(runtime.contains("activity.runOnUiThread"))
    }

    @Test
    fun mainActivityRoutesNotificationIntentsIntoExistingWebView() {
        val mainActivity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")
        val manifest = source("src/main/AndroidManifest.xml")

        assertTrue(mainActivity.contains("private lateinit var androidNotificationRuntime: AndroidNotificationRuntime"))
        assertTrue(mainActivity.contains("onNewIntent(intent: Intent)"))
        assertTrue(mainActivity.contains("handleNotificationIntent(intent)"))
        assertTrue(manifest.contains("android:launchMode=\"singleTop\""))
    }
}
