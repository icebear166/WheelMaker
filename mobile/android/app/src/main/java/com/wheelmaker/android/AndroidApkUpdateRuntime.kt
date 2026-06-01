package com.wheelmaker.android

import android.content.Intent
import android.content.pm.PackageInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

private const val ANDROID_APK_UPDATE_EVENT = "wheelmaker:android-apk-update"
private const val ANDROID_APK_MIME_TYPE = "application/vnd.android.package-archive"

fun normalizeApkSha256(value: String): String {
    return value.removePrefix("sha256:")
        .removePrefix("SHA256:")
        .trim()
        .lowercase()
}

class AndroidApkUpdateRuntime(
    private val activity: MainActivity,
    private val webView: WebView
) {
    private val httpClient = OkHttpClient()

    fun getReleaseState(): String {
        return try {
            val packageInfo = activity.packageManager.getInstalledPackageInfo(activity.packageName)
            val sourceApk = File(activity.applicationInfo.sourceDir)
            JSONObject()
                .put("supported", true)
                .put("packageName", activity.packageName)
                .put("versionName", packageInfo.versionName ?: "")
                .put("versionCode", packageInfo.longVersionCodeCompat())
                .put("apkSha256", fileSha256(sourceApk))
                .put("buildSha", "")
                .put("builtAt", "")
                .put("canRequestPackageInstalls", canRequestPackageInstalls())
                .toString()
        } catch (error: Exception) {
            JSONObject()
                .put("supported", true)
                .put("error", error.message ?: "release_state_failed")
                .toString()
        }
    }

    fun installRelease(rawJson: String): String {
        val input = try {
            JSONObject(rawJson)
        } catch (_: Exception) {
            return androidApkUpdateResultJson(false, "invalid_payload", "invalid_payload")
        }
        val downloadUrl = input.optString("downloadUrl")
        if (downloadUrl.isBlank()) {
            return androidApkUpdateResultJson(false, "invalid_payload", "missing_download_url")
        }
        if (!canRequestPackageInstalls()) {
            openInstallPermissionSettings()
            dispatchUpdateEvent("permission_required")
            return androidApkUpdateResultJson(true, "permission_required")
        }
        val expectedSha256 = normalizeApkSha256(input.optString("expectedSha256"))
        val tagName = input.optString("tagName")
        Thread {
            downloadAndInstall(downloadUrl, expectedSha256, tagName)
        }.start()
        dispatchUpdateEvent("downloading")
        return androidApkUpdateResultJson(true, "downloading")
    }

    private fun downloadAndInstall(downloadUrl: String, expectedSha256: String, tagName: String) {
        try {
            dispatchUpdateEvent("downloading")
            val apkFile = downloadApk(downloadUrl)
            val actualSha256 = fileSha256(apkFile)
            if (expectedSha256.isNotBlank() && actualSha256 != expectedSha256) {
                dispatchUpdateEvent("failed", "sha256_mismatch", actualSha256, tagName)
                return
            }
            dispatchUpdateEvent("downloaded", "", actualSha256, tagName)
            startPackageInstaller(apkFile)
            dispatchUpdateEvent("installing", "", actualSha256, tagName)
        } catch (error: Exception) {
            dispatchUpdateEvent("failed", error.message ?: "download_failed", "", tagName)
        }
    }

    private fun downloadApk(downloadUrl: String): File {
        val request = Request.Builder().url(downloadUrl).build()
        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("download_failed_${response.code}")
            }
            val body = response.body ?: throw IllegalStateException("download_empty")
            val outputDir = File(activity.cacheDir, "apk-updates")
            outputDir.mkdirs()
            val output = File(outputDir, "WheelMakerAndroid.apk")
            output.outputStream().use { stream ->
                body.byteStream().use { input ->
                    input.copyTo(stream)
                }
            }
            return output
        }
    }

    private fun startPackageInstaller(apkFile: File) {
        val apkUri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.apkprovider",
            apkFile
        )
        val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            setDataAndType(apkUri, ANDROID_APK_MIME_TYPE)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
            putExtra(Intent.EXTRA_RETURN_RESULT, true)
        }
        activity.runOnUiThread {
            activity.startActivity(intent)
        }
    }

    private fun canRequestPackageInstalls(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return true
        }
        return activity.packageManager.canRequestPackageInstalls()
    }

    private fun openInstallPermissionSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${activity.packageName}")
        )
        activity.runOnUiThread {
            activity.startActivity(intent)
        }
    }

    private fun dispatchUpdateEvent(
        status: String,
        error: String = "",
        apkSha256: String = "",
        tagName: String = ""
    ) {
        val detail = JSONObject()
            .put("status", status)
            .put("error", error)
            .put("apkSha256", apkSha256)
            .put("tagName", tagName)
        val script = """
            window.dispatchEvent(new CustomEvent('$ANDROID_APK_UPDATE_EVENT', { detail: $detail }));
        """.trimIndent()
        webView.post {
            webView.evaluateJavascript(script, null)
        }
    }
}

private fun androidApkUpdateResultJson(ok: Boolean, status: String, error: String = ""): String {
    val output = JSONObject()
        .put("ok", ok)
        .put("status", status)
    if (error.isNotBlank()) {
        output.put("error", error)
    }
    return output.toString()
}

private fun fileSha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { stream ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val read = stream.read(buffer)
            if (read <= 0) break
            digest.update(buffer, 0, read)
        }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
}

@Suppress("DEPRECATION")
private fun android.content.pm.PackageManager.getInstalledPackageInfo(packageName: String): PackageInfo {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        getPackageInfo(packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
    } else {
        getPackageInfo(packageName, 0)
    }
}

@Suppress("DEPRECATION")
private fun PackageInfo.longVersionCodeCompat(): Long {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) longVersionCode else versionCode.toLong()
}
