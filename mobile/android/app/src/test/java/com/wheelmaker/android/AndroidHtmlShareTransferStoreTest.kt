package com.wheelmaker.android

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class AndroidHtmlShareTransferStoreTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun transferKeepsTheRequestedHtmlFileNameAndRequiresExactBytes() {
        val root = temporaryFolder.newFolder("html-shares")
        val store = AndroidHtmlShareTransferStore(
            rootDirectory = root,
            maxTotalBytes = 16,
            maxChunkBytes = 8,
            now = { 1_000 }
        )

        val transferId = requireNotNull(store.begin(expectedBytes = 6, fileName = "README.html"))
        assertTrue(store.append(transferId, 0, byteArrayOf(1, 2, 3)))
        assertNull(store.commit(transferId))
        assertTrue(store.append(transferId, 1, byteArrayOf(4, 5, 6)))

        val committed = requireNotNull(store.commit(transferId))
        assertTrue(committed.name == "README.html")
        assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5, 6), committed.readBytes())
    }

    @Test
    fun transferRejectsUnsafeNamesAndClearsPartialFiles() {
        val root = temporaryFolder.newFolder("html-cleanup")
        val store = AndroidHtmlShareTransferStore(
            rootDirectory = root,
            maxTotalBytes = 8,
            maxChunkBytes = 4,
            now = { 1_000 }
        )

        assertNull(store.begin(expectedBytes = 2, fileName = "../escape.html"))
        assertNull(store.begin(expectedBytes = 2, fileName = "report.txt"))
        val transferId = requireNotNull(store.begin(expectedBytes = 2, fileName = "report.html"))
        assertTrue(store.append(transferId, 0, byteArrayOf(1, 2)))
        assertTrue(store.cancel(transferId))
        assertFalse(root.walkTopDown().any { it.isFile })
    }
}
