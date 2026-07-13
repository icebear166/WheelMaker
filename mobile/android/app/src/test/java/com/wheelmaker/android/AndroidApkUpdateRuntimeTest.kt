package com.wheelmaker.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import java.nio.file.Paths

class AndroidApkUpdateRuntimeTest {
    private fun source(path: String): String =
        String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun normalizesSha256DigestValues() {
        assertEquals("abcdef", normalizeApkSha256("sha256:ABCDEF"))
        assertEquals("abcdef", normalizeApkSha256(" ABCDEF "))
    }

	@Test
	fun installMetadataRequiresHttpsFullDigestAndBoundedPositiveSize() {
		val digest = "a".repeat(64)
		assertEquals(
			ApkDownloadExpectation("https://example.com/app.apk", digest, 1024, "v2"),
			parseApkDownloadExpectation("""{"downloadUrl":"https://example.com/app.apk","expectedSha256":"$digest","expectedSize":1024,"tagName":"v2"}""")
		)
		assertNull(parseApkDownloadExpectation("""{"downloadUrl":"http://example.com/app.apk","expectedSha256":"$digest","expectedSize":1024}"""))
		assertNull(parseApkDownloadExpectation("""{"downloadUrl":"https://example.com/app.apk","expectedSize":1024}"""))
		assertNull(parseApkDownloadExpectation("""{"downloadUrl":"https://example.com/app.apk","expectedSha256":"abcd","expectedSize":1024}"""))
		assertNull(parseApkDownloadExpectation("""{"downloadUrl":"https://example.com/app.apk","expectedSha256":"$digest","expectedSize":0}"""))
		assertNull(parseApkDownloadExpectation("""{"downloadUrl":"https://example.com/app.apk","expectedSha256":"$digest","expectedSize":${201L * 1024L * 1024L}}"""))
	}

	@Test
	fun streamingVerifierRejectsLengthAndDigestMismatchesAndDeletesOutput() {
		val bytes = "verified-apk".toByteArray()
		val digest = sha256Hex(bytes)
		val tempDir = Files.createTempDirectory("apk-verifier").toFile()
		val valid = File(tempDir, "valid.apk")

		val verified = streamAndVerifyApk(
			input = ByteArrayInputStream(bytes),
			output = valid,
			expectedSize = bytes.size.toLong(),
			contentLength = bytes.size.toLong(),
			expectedSha256 = digest
		)
		assertEquals(bytes.size.toLong(), verified.byteCount)
		assertEquals(digest, verified.sha256)
		assertTrue(valid.exists())

		for ((name, expectedSize, contentLength, expectedSha) in listOf(
			listOf("short", bytes.size.toLong() + 1, bytes.size.toLong(), digest),
			listOf("long", bytes.size.toLong() - 1, bytes.size.toLong(), digest),
			listOf("content-length", bytes.size.toLong(), bytes.size.toLong() + 1, digest),
			listOf("digest", bytes.size.toLong(), bytes.size.toLong(), "0".repeat(64))
		)) {
			val output = File(tempDir, "$name.apk")
			val result = runCatching {
				streamAndVerifyApk(
					ByteArrayInputStream(bytes),
					output,
					expectedSize as Long,
					contentLength as Long,
					expectedSha as String
				)
			}
			assertTrue("$name should fail", result.isFailure)
			assertFalse("$name output should be deleted", output.exists())
		}
	}

	@Test
	fun archiveIdentityRequiresPackageUpgradeAndExactSignerSet() {
		val installed = ApkArchiveIdentity("com.wheelmaker.android", 7, setOf("signer-a"))
		assertTrue(isTrustedApkArchive(
			installed,
			ApkArchiveIdentity("com.wheelmaker.android", 8, setOf("signer-a"))
		))
		assertFalse(isTrustedApkArchive(installed, ApkArchiveIdentity("evil.package", 8, setOf("signer-a"))))
		assertFalse(isTrustedApkArchive(installed, ApkArchiveIdentity("com.wheelmaker.android", 7, setOf("signer-a"))))
		assertFalse(isTrustedApkArchive(installed, ApkArchiveIdentity("com.wheelmaker.android", 6, setOf("signer-a"))))
		assertFalse(isTrustedApkArchive(installed, ApkArchiveIdentity("com.wheelmaker.android", 8, setOf("debug-signer"))))
		assertFalse(isTrustedApkArchive(installed, ApkArchiveIdentity("com.wheelmaker.android", 8, emptySet())))
	}

    @Test
    fun bridgeExposesAndroidApkUpdateMethods() {
        val bridge = source("src/main/java/com/wheelmaker/android/WheelMakerBridge.kt")
        val mainActivity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")

        assertTrue(bridge.contains("\"apk.getReleaseState\""))
        assertTrue(bridge.contains("\"apk.install\""))
        assertTrue(bridge.contains("androidApkUpdateRuntime.getReleaseState()"))
        assertTrue(bridge.contains("androidApkUpdateRuntime.installRelease(payload.toString())"))
        assertTrue(mainActivity.contains("private lateinit var androidApkUpdateRuntime: AndroidApkUpdateRuntime"))
        assertTrue(mainActivity.contains("AndroidApkUpdateRuntime(this, webView)"))
    }

    @Test
    fun manifestAllowsUserConfirmedApkInstallViaFileProvider() {
        val manifest = source("src/main/AndroidManifest.xml")
        val providerPaths = source("src/main/res/xml/apk_update_paths.xml")

        assertTrue(manifest.contains("android.permission.REQUEST_INSTALL_PACKAGES"))
        assertTrue(manifest.contains("androidx.core.content.FileProvider"))
        assertTrue(manifest.contains('"' + "\${applicationId}.apkprovider" + '"'))
        assertTrue(manifest.contains("@xml/apk_update_paths"))
        assertTrue(providerPaths.contains("<cache-path"))
		assertTrue(providerPaths.contains("apk-verified-updates/"))
    }

    @Test
    fun runtimeDownloadsVerifiesAndStartsSystemInstaller() {
        val runtime = source("src/main/java/com/wheelmaker/android/AndroidApkUpdateRuntime.kt")

        assertTrue(runtime.contains("OkHttpClient"))
		assertTrue(runtime.contains("followRedirects(false)"))
        assertTrue(runtime.contains("expectedSha256"))
        assertTrue(runtime.contains("fileSha256"))
        assertTrue(runtime.contains("ACTION_MANAGE_UNKNOWN_APP_SOURCES"))
        assertTrue(runtime.contains("canRequestPackageInstalls"))
        assertTrue(runtime.contains("FileProvider.getUriForFile"))
		assertTrue(runtime.contains("getPackageArchiveInfo"))
		assertTrue(runtime.contains("GET_SIGNING_CERTIFICATES"))
        assertTrue(runtime.contains("Intent.ACTION_INSTALL_PACKAGE"))
        assertTrue(runtime.contains("FLAG_GRANT_READ_URI_PERMISSION"))
        assertTrue(runtime.contains("wheelmaker:android-apk-update"))
        assertTrue(!runtime.contains("web-build.json"))
    }
}
