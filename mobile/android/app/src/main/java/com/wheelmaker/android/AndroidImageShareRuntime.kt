package com.wheelmaker.android

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Looper
import android.util.Base64
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

private const val RESPONSE_IMAGE_MIME_TYPE = "image/png"
private const val RESPONSE_IMAGE_DATA_URL_PREFIX = "data:image/png;base64,"
private const val RESPONSE_IMAGE_SHARE_TIMEOUT_SECONDS = 2L

class AndroidImageShareRuntime(
    private val activity: MainActivity
) {
    fun shareResponseImage(rawJson: String): String {
        val input = try {
            JSONObject(rawJson)
        } catch (_: Exception) {
            return androidImageShareResultJson(false, "invalid_payload", "invalid_payload")
        }
        val fileName = sanitizeResponseImageFileName(input.optString("fileName"))
        val dataUrl = input.optString("dataUrl")
        if (dataUrl.isBlank()) {
            return androidImageShareResultJson(false, "invalid_payload", "missing_data_url")
        }
        if (!dataUrl.startsWith(RESPONSE_IMAGE_DATA_URL_PREFIX)) {
            return androidImageShareResultJson(false, "invalid_data_url", "invalid_data_url")
        }
        val bytes = try {
            Base64.decode(dataUrl.removePrefix(RESPONSE_IMAGE_DATA_URL_PREFIX), Base64.DEFAULT)
        } catch (_: Exception) {
            return androidImageShareResultJson(false, "decode_failed", "decode_failed")
        }
        val imageFile = try {
            writeResponseImage(fileName, bytes)
        } catch (error: Exception) {
            return androidImageShareResultJson(false, "write_failed", error.message ?: "write_failed")
        }
        return try {
            startShareChooser(imageFile)
            androidImageShareResultJson(true, "shared")
        } catch (_: ActivityNotFoundException) {
            androidImageShareResultJson(false, "no_share_target", "no_share_target")
        } catch (error: Exception) {
            androidImageShareResultJson(false, "share_failed", error.message ?: "share_failed")
        }
    }

    private fun writeResponseImage(fileName: String, bytes: ByteArray): File {
        val outputDir = File(activity.cacheDir, "image-shares")
        outputDir.mkdirs()
        val output = File(outputDir, fileName)
        output.writeBytes(bytes)
        return output
    }

    private fun startShareChooser(imageFile: File) {
        val imageUri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.apkprovider",
            imageFile
        )
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = RESPONSE_IMAGE_MIME_TYPE
            putExtra(Intent.EXTRA_STREAM, imageUri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(sendIntent, "Share response image").apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivityAndWaitForLaunch(chooser)
    }

    private fun startActivityAndWaitForLaunch(intent: Intent) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            activity.startActivity(intent)
            return
        }
        val latch = CountDownLatch(1)
        val errorRef = AtomicReference<Exception?>(null)
        activity.runOnUiThread {
            try {
                activity.startActivity(intent)
            } catch (error: Exception) {
                errorRef.set(error)
            } finally {
                latch.countDown()
            }
        }
        if (!latch.await(RESPONSE_IMAGE_SHARE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw IllegalStateException("share_start_timeout")
        }
        errorRef.get()?.let { throw it }
    }
}

private fun sanitizeResponseImageFileName(value: String): String {
    val cleaned = value.replace(Regex("[^A-Za-z0-9._-]"), "_")
    return if (cleaned.endsWith(".png") && cleaned != ".png") cleaned else "wheelmaker-response.png"
}

private fun androidImageShareResultJson(ok: Boolean, status: String, error: String = ""): String {
    val output = JSONObject()
        .put("ok", ok)
        .put("status", status)
    if (error.isNotBlank()) {
        output.put("error", error)
    }
    return output.toString()
}
