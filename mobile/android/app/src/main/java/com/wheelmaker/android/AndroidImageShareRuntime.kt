package com.wheelmaker.android

import android.content.ActivityNotFoundException
import android.content.ClipData
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
private const val RESPONSE_IMAGE_SHARE_TIMEOUT_SECONDS = 2L
private const val MAX_RESPONSE_IMAGE_BYTES = 16 * 1024 * 1024
private const val MAX_RESPONSE_IMAGE_CHUNK_BYTES = 128 * 1024
private const val MAX_RESPONSE_IMAGE_ENCODED_CHUNK_LENGTH = 180_000

class AndroidImageShareRuntime(
    private val activity: MainActivity
) {
    private val transferStore = AndroidImageShareTransferStore(
        rootDirectory = File(activity.cacheDir, "image-shares"),
        maxTotalBytes = MAX_RESPONSE_IMAGE_BYTES,
        maxChunkBytes = MAX_RESPONSE_IMAGE_CHUNK_BYTES
    )

    fun begin(rawJson: String): String {
        val input = parseInput(rawJson)
            ?: return androidImageShareResultJson(false, "invalid_payload", "invalid_payload")
        val expectedBytes = input.optLong("size", -1)
        if (expectedBytes !in 1..MAX_RESPONSE_IMAGE_BYTES.toLong()) {
            return androidImageShareResultJson(false, "invalid_size", "invalid_size")
        }
        val transferId = transferStore.begin(expectedBytes.toInt())
            ?: return androidImageShareResultJson(false, "begin_failed", "begin_failed")
        return androidImageShareResultJson(true, "ready", extra = mapOf("transferId" to transferId))
    }

    fun append(rawJson: String): String {
        val input = parseInput(rawJson)
            ?: return androidImageShareResultJson(false, "invalid_payload", "invalid_payload")
        val transferId = input.optString("transferId")
        val index = input.optInt("index", -1)
        val encoded = input.optString("data")
        if (transferId.isBlank() || index < 0 || encoded.isBlank() || encoded.length > MAX_RESPONSE_IMAGE_ENCODED_CHUNK_LENGTH) {
            return androidImageShareResultJson(false, "invalid_chunk", "invalid_chunk")
        }
        val bytes = try {
            Base64.decode(encoded, Base64.NO_WRAP)
        } catch (_: Exception) {
            return androidImageShareResultJson(false, "decode_failed", "decode_failed")
        }
        if (!transferStore.append(transferId, index, bytes)) {
            return androidImageShareResultJson(false, "chunk_rejected", "chunk_rejected")
        }
        return androidImageShareResultJson(true, "chunk_received")
    }

    fun commit(rawJson: String): String {
        val input = parseInput(rawJson)
            ?: return androidImageShareResultJson(false, "invalid_payload", "invalid_payload")
        val imageFile = transferStore.commit(input.optString("transferId"))
            ?: return androidImageShareResultJson(false, "commit_rejected", "commit_rejected")
        return try {
            startShareChooser(imageFile)
            androidImageShareResultJson(true, "shared")
        } catch (_: ActivityNotFoundException) {
            androidImageShareResultJson(false, "no_share_target", "no_share_target")
        } catch (error: Exception) {
            androidImageShareResultJson(false, "share_failed", error.message ?: "share_failed")
        }
    }

    fun cancel(rawJson: String): String {
        val input = parseInput(rawJson)
            ?: return androidImageShareResultJson(false, "invalid_payload", "invalid_payload")
        val cancelled = transferStore.cancel(input.optString("transferId"))
        return androidImageShareResultJson(cancelled, if (cancelled) "cancelled" else "not_found")
    }

    fun clear() {
        transferStore.clear()
    }

    private fun parseInput(rawJson: String): JSONObject? = try {
        JSONObject(rawJson)
    } catch (_: Exception) {
        null
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
            putExtra(Intent.EXTRA_TITLE, "WheelMaker response image")
            clipData = ClipData.newUri(activity.contentResolver, "WheelMaker response image", imageUri)
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

private fun androidImageShareResultJson(
    ok: Boolean,
    status: String,
    error: String = "",
    extra: Map<String, String> = emptyMap()
): String {
    val output = JSONObject()
        .put("ok", ok)
        .put("status", status)
    if (error.isNotBlank()) output.put("error", error)
    for ((key, value) in extra) output.put(key, value)
    return output.toString()
}
