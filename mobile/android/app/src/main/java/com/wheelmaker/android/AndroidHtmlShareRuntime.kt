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

private const val MARKDOWN_HTML_MIME_TYPE = "text/html"
private const val MARKDOWN_HTML_SHARE_TIMEOUT_SECONDS = 2L
private const val MAX_MARKDOWN_HTML_BYTES = 16 * 1024 * 1024
private const val MAX_MARKDOWN_HTML_CHUNK_BYTES = 128 * 1024
private const val MAX_MARKDOWN_HTML_ENCODED_CHUNK_LENGTH = 180_000

class AndroidHtmlShareRuntime(
    private val activity: MainActivity
) {
    private val transferStore = AndroidHtmlShareTransferStore(
        rootDirectory = File(activity.cacheDir, "html-shares"),
        maxTotalBytes = MAX_MARKDOWN_HTML_BYTES,
        maxChunkBytes = MAX_MARKDOWN_HTML_CHUNK_BYTES
    )

    fun begin(rawJson: String): String {
        val input = parseInput(rawJson)
            ?: return androidHtmlShareResultJson(false, "invalid_payload", "invalid_payload")
        val expectedBytes = input.optLong("size", -1)
        val fileName = input.optString("fileName")
        if (expectedBytes !in 1..MAX_MARKDOWN_HTML_BYTES.toLong() || fileName.isBlank()) {
            return androidHtmlShareResultJson(false, "invalid_size", "invalid_size")
        }
        val transferId = transferStore.begin(expectedBytes.toInt(), fileName)
            ?: return androidHtmlShareResultJson(false, "begin_failed", "begin_failed")
        return androidHtmlShareResultJson(true, "ready", extra = mapOf("transferId" to transferId))
    }

    fun append(rawJson: String): String {
        val input = parseInput(rawJson)
            ?: return androidHtmlShareResultJson(false, "invalid_payload", "invalid_payload")
        val transferId = input.optString("transferId")
        val index = input.optInt("index", -1)
        val encoded = input.optString("data")
        if (transferId.isBlank() || index < 0 || encoded.isBlank() || encoded.length > MAX_MARKDOWN_HTML_ENCODED_CHUNK_LENGTH) {
            return androidHtmlShareResultJson(false, "invalid_chunk", "invalid_chunk")
        }
        val bytes = try {
            Base64.decode(encoded, Base64.NO_WRAP)
        } catch (_: Exception) {
            return androidHtmlShareResultJson(false, "decode_failed", "decode_failed")
        }
        if (!transferStore.append(transferId, index, bytes)) {
            return androidHtmlShareResultJson(false, "chunk_rejected", "chunk_rejected")
        }
        return androidHtmlShareResultJson(true, "chunk_received")
    }

    fun commit(rawJson: String): String {
        val input = parseInput(rawJson)
            ?: return androidHtmlShareResultJson(false, "invalid_payload", "invalid_payload")
        val htmlFile = transferStore.commit(input.optString("transferId"))
            ?: return androidHtmlShareResultJson(false, "commit_rejected", "commit_rejected")
        return try {
            startShareChooser(htmlFile)
            androidHtmlShareResultJson(true, "shared")
        } catch (_: ActivityNotFoundException) {
            androidHtmlShareResultJson(false, "no_share_target", "no_share_target")
        } catch (error: Exception) {
            androidHtmlShareResultJson(false, "share_failed", error.message ?: "share_failed")
        }
    }

    fun cancel(rawJson: String): String {
        val input = parseInput(rawJson)
            ?: return androidHtmlShareResultJson(false, "invalid_payload", "invalid_payload")
        val cancelled = transferStore.cancel(input.optString("transferId"))
        return androidHtmlShareResultJson(cancelled, if (cancelled) "cancelled" else "not_found")
    }

    fun clear() {
        transferStore.clear()
    }

    private fun parseInput(rawJson: String): JSONObject? = try {
        JSONObject(rawJson)
    } catch (_: Exception) {
        null
    }

    private fun startShareChooser(htmlFile: File) {
        val htmlUri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.apkprovider",
            htmlFile
        )
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = MARKDOWN_HTML_MIME_TYPE
            putExtra(Intent.EXTRA_STREAM, htmlUri)
            putExtra(Intent.EXTRA_TITLE, htmlFile.name)
            clipData = ClipData.newUri(activity.contentResolver, htmlFile.name, htmlUri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(sendIntent, "Share HTML document").apply {
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
        if (!latch.await(MARKDOWN_HTML_SHARE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
            throw IllegalStateException("share_start_timeout")
        }
        errorRef.get()?.let { throw it }
    }
}

private fun androidHtmlShareResultJson(
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
