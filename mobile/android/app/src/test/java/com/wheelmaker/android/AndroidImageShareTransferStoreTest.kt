package com.wheelmaker.android

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AndroidImageShareTransferStoreTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun transferRequiresSequentialBoundedChunksAndExactCommitSize() {
        val root = temporaryFolder.newFolder("shares")
        val store = AndroidImageShareTransferStore(
            rootDirectory = root,
            maxTotalBytes = 8,
            maxChunkBytes = 4,
            now = { 1_000 }
        )

        val transferId = requireNotNull(store.begin(expectedBytes = 6))
        assertTrue(store.append(transferId, 0, byteArrayOf(1, 2, 3)))
        assertFalse(store.append(transferId, 2, byteArrayOf(4)))
        assertNull(store.commit(transferId))
        assertTrue(store.append(transferId, 1, byteArrayOf(4, 5, 6)))

        val committed = requireNotNull(store.commit(transferId))
        assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5, 6), committed.readBytes())
        assertNull(store.commit(transferId))
    }

    @Test
    fun transferRejectsOversizeChunksAndExpectedTotals() {
        val root = temporaryFolder.newFolder("bounded")
        val store = AndroidImageShareTransferStore(
            rootDirectory = root,
            maxTotalBytes = 4,
            maxChunkBytes = 2,
            now = { 1_000 }
        )

        assertNull(store.begin(expectedBytes = 0))
        assertNull(store.begin(expectedBytes = 5))
        val transferId = requireNotNull(store.begin(expectedBytes = 4))
        assertFalse(store.append(transferId, 0, byteArrayOf(1, 2, 3)))
        assertTrue(store.append(transferId, 0, byteArrayOf(1, 2)))
        assertFalse(store.append(transferId, 1, byteArrayOf(3, 4, 5)))
    }

    @Test
    fun transferExpiresCancelsAndClearsPartialFiles() {
        var now = 1_000L
        val root = temporaryFolder.newFolder("cleanup")
        val store = AndroidImageShareTransferStore(
            rootDirectory = root,
            maxTotalBytes = 8,
            maxChunkBytes = 4,
            ttlMillis = 60_000,
            now = { now }
        )

        val expired = requireNotNull(store.begin(expectedBytes = 4))
        assertTrue(store.append(expired, 0, byteArrayOf(1, 2)))
        now = 61_001
        assertFalse(store.append(expired, 1, byteArrayOf(3, 4)))
        assertFalse(root.walkTopDown().any { it.isFile })

        now = 70_000
        val cancelled = requireNotNull(store.begin(expectedBytes = 4))
        assertTrue(store.append(cancelled, 0, byteArrayOf(1, 2)))
        assertTrue(store.cancel(cancelled))
        assertFalse(store.cancel(cancelled))

        val cleared = requireNotNull(store.begin(expectedBytes = 2))
        assertTrue(store.append(cleared, 0, byteArrayOf(1, 2)))
        store.clear()
        assertFalse(root.walkTopDown().any { it.isFile })
    }
}
