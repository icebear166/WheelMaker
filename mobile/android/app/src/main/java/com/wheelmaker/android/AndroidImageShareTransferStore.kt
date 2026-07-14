package com.wheelmaker.android

import android.os.SystemClock
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class AndroidImageShareTransferStore(
    private val rootDirectory: File,
    private val maxTotalBytes: Int = 16 * 1024 * 1024,
    private val maxChunkBytes: Int = 128 * 1024,
    private val ttlMillis: Long = 60_000L,
    private val now: () -> Long = { SystemClock.elapsedRealtime() }
) {
    private data class ActiveTransfer(
        val id: String,
        val file: File,
        val expectedBytes: Int,
        val expiresAtElapsedRealtime: Long,
        var receivedBytes: Int = 0,
        var nextIndex: Int = 0
    )

    private var activeTransfer: ActiveTransfer? = null

    @Synchronized
    fun begin(expectedBytes: Int): String? {
        if (expectedBytes !in 1..maxTotalBytes) return null
        clear()
        rootDirectory.mkdirs()
        val transferId = UUID.randomUUID().toString()
        val output = File(rootDirectory, "$transferId.png")
        if (!runCatching { output.createNewFile() }.getOrDefault(false)) return null
        activeTransfer = ActiveTransfer(
            id = transferId,
            file = output,
            expectedBytes = expectedBytes,
            expiresAtElapsedRealtime = now() + ttlMillis
        )
        return transferId
    }

    @Synchronized
    fun append(transferId: String, index: Int, bytes: ByteArray): Boolean {
        val transfer = active(transferId) ?: return false
        if (index != transfer.nextIndex || bytes.isEmpty() || bytes.size > maxChunkBytes) return false
        if (transfer.receivedBytes + bytes.size > transfer.expectedBytes) return false
        return try {
            FileOutputStream(transfer.file, true).use { it.write(bytes) }
            transfer.receivedBytes += bytes.size
            transfer.nextIndex += 1
            true
        } catch (_: Exception) {
            clear()
            false
        }
    }

    @Synchronized
    fun commit(transferId: String): File? {
        val transfer = active(transferId) ?: return null
        if (transfer.receivedBytes != transfer.expectedBytes || transfer.file.length() != transfer.expectedBytes.toLong()) {
            return null
        }
        activeTransfer = null
        return transfer.file
    }

    @Synchronized
    fun cancel(transferId: String): Boolean {
        val transfer = activeTransfer ?: return false
        if (transfer.id != transferId) return false
        clear()
        return true
    }

    @Synchronized
    fun clear() {
        activeTransfer = null
        if (rootDirectory.exists()) rootDirectory.deleteRecursively()
    }

    private fun active(transferId: String): ActiveTransfer? {
        val transfer = activeTransfer ?: return null
        if (transfer.id != transferId) return null
        if (now() > transfer.expiresAtElapsedRealtime) {
            clear()
            return null
        }
        return transfer
    }
}
