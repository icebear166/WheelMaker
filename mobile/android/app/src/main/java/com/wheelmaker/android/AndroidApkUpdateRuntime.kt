package com.wheelmaker.android

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.WebView
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.net.URI
import java.security.MessageDigest

private const val ANDROID_APK_UPDATE_EVENT = "wheelmaker:android-apk-update"
private const val ANDROID_APK_MIME_TYPE = "application/vnd.android.package-archive"
private const val MAX_APK_UPDATE_BYTES = 200L * 1024L * 1024L
private const val MAX_APK_DOWNLOAD_REDIRECTS = 5
private const val APK_UPDATE_DIRECTORY = "apk-verified-updates"
private const val STALE_APK_AGE_MILLIS = 24L * 60L * 60L * 1_000L
internal const val ANDROID_APK_INSTALL_REQUEST_CODE = 1005

data class ApkDownloadExpectation(
    val downloadUrl: String,
    val sha256: String,
    val size: Long,
    val tagName: String
)

data class VerifiedApkDownload(val byteCount: Long, val sha256: String)

data class ApkArchiveIdentity(
    val packageName: String,
    val versionCode: Long,
    val signerSha256: Set<String>
)

fun normalizeApkSha256(value: String): String = value
    .removePrefix("sha256:")
    .removePrefix("SHA256:")
    .trim()
    .lowercase()

fun parseApkDownloadExpectation(rawJson: String): ApkDownloadExpectation? {
    val input = try {
        JSONObject(rawJson)
    } catch (_: Exception) {
        return null
    }
    val downloadUrl = input.optString("downloadUrl").trim()
    val uri = try {
        URI(downloadUrl)
    } catch (_: Exception) {
        return null
    }
    if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank() || uri.userInfo != null) {
        return null
    }
    val sha256 = normalizeApkSha256(input.optString("expectedSha256"))
    if (!sha256.matches(Regex("^[0-9a-f]{64}$"))) {
        return null
    }
    val size = input.optLong("expectedSize", -1L)
    if (size <= 0L || size > MAX_APK_UPDATE_BYTES) {
        return null
    }
    return ApkDownloadExpectation(downloadUrl, sha256, size, input.optString("tagName"))
}

fun sha256Hex(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
    .digest(bytes)
    .joinToString("") { "%02x".format(it) }

fun resolveApkDownloadRedirect(currentUrl: String, location: String, hopCount: Int): String? {
    if (hopCount !in 1..MAX_APK_DOWNLOAD_REDIRECTS) {
        return null
    }
    val normalizedLocation = location.trim()
    if (normalizedLocation.isEmpty()) {
        return null
    }
    val base = try {
        URI(currentUrl)
    } catch (_: Exception) {
        return null
    }
    val resolved = try {
        base.resolve(normalizedLocation).normalize()
    } catch (_: Exception) {
        return null
    }
    if (
        resolved.isOpaque ||
        !resolved.scheme.equals("https", ignoreCase = true) ||
        resolved.host.isNullOrBlank() ||
        resolved.rawUserInfo != null
    ) {
        return null
    }
    return resolved.toString()
}

fun streamAndVerifyApk(
    input: InputStream,
    output: File,
    expectedSize: Long,
    contentLength: Long,
    expectedSha256: String
): VerifiedApkDownload {
    require(expectedSize in 1..MAX_APK_UPDATE_BYTES) { "invalid_apk_size" }
    require(contentLength < 0L || contentLength == expectedSize) { "content_length_mismatch" }
    val digest = MessageDigest.getInstance("SHA-256")
    var byteCount = 0L
    try {
        output.parentFile?.mkdirs()
        output.outputStream().buffered().use { sink ->
            input.use { source ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                while (true) {
                    val read = source.read(buffer)
                    if (read < 0) break
                    if (read == 0) continue
                    byteCount += read
                    if (byteCount > expectedSize || byteCount > MAX_APK_UPDATE_BYTES) {
                        throw IllegalStateException("apk_size_mismatch")
                    }
                    digest.update(buffer, 0, read)
                    sink.write(buffer, 0, read)
                }
            }
        }
        if (byteCount != expectedSize) {
            throw IllegalStateException("apk_size_mismatch")
        }
        val actualSha256 = digest.digest().joinToString("") { "%02x".format(it) }
        if (actualSha256 != expectedSha256) {
            throw IllegalStateException("sha256_mismatch")
        }
        return VerifiedApkDownload(byteCount, actualSha256)
    } catch (error: Exception) {
        output.delete()
        throw error
    }
}

fun isTrustedApkArchive(installed: ApkArchiveIdentity, candidate: ApkArchiveIdentity): Boolean =
    candidate.packageName == installed.packageName &&
        candidate.versionCode > installed.versionCode &&
        candidate.signerSha256.isNotEmpty() &&
        candidate.signerSha256 == installed.signerSha256

class AndroidApkUpdateRuntime(
    private val activity: MainActivity,
    private val webView: WebView
) {
    private val httpClient = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .build()
    @Volatile private var pendingInstallerFile: File? = null

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
        val expectation = parseApkDownloadExpectation(rawJson)
            ?: return androidApkUpdateResultJson(false, "invalid_payload", "invalid_update_metadata")
        if (!canRequestPackageInstalls()) {
            openInstallPermissionSettings()
            dispatchUpdateEvent("permission_required")
            return androidApkUpdateResultJson(true, "permission_required")
        }
        Thread {
            downloadAndInstall(expectation)
        }.start()
        dispatchUpdateEvent("downloading")
        return androidApkUpdateResultJson(true, "downloading")
    }

    fun onInstallerResult() {
        pendingInstallerFile?.delete()
        pendingInstallerFile = null
    }

    private fun downloadAndInstall(expectation: ApkDownloadExpectation) {
        var apkFile: File? = null
        try {
            dispatchUpdateEvent("downloading")
            val download = downloadApk(expectation)
            apkFile = download.first
            verifyArchiveIdentity(apkFile)
            dispatchUpdateEvent("downloaded", "", download.second.sha256, expectation.tagName)
            startPackageInstaller(apkFile, download.second.sha256, expectation.tagName)
            apkFile = null
        } catch (error: Exception) {
            apkFile?.delete()
            dispatchUpdateEvent("failed", error.message ?: "download_failed", "", expectation.tagName)
        }
    }

    private fun downloadApk(expectation: ApkDownloadExpectation): Pair<File, VerifiedApkDownload> {
        val outputDir = File(activity.cacheDir, APK_UPDATE_DIRECTORY)
        cleanupStaleApkFiles(outputDir)
        outputDir.mkdirs()
        val output = File.createTempFile("WheelMakerAndroid-", ".apk", outputDir)
        try {
            var currentUrl = expectation.downloadUrl
            var redirectCount = 0
            while (true) {
                val request = Request.Builder().url(currentUrl).build()
                var redirectUrl: String? = null
                httpClient.newCall(request).execute().use { response ->
                    if (!response.request.url.isHttps) {
                        throw IllegalStateException("download_redirect_rejected")
                    }
                    if (response.isRedirect) {
                        redirectCount += 1
                        redirectUrl = resolveApkDownloadRedirect(
                            currentUrl = response.request.url.toString(),
                            location = response.header("Location").orEmpty(),
                            hopCount = redirectCount
                        ) ?: throw IllegalStateException("download_redirect_rejected")
                        return@use
                    }
                    if (!response.isSuccessful) {
                        throw IllegalStateException("download_failed_${response.code}")
                    }
                    val body = response.body ?: throw IllegalStateException("download_empty")
                    val verified = streamAndVerifyApk(
                        input = body.byteStream(),
                        output = output,
                        expectedSize = expectation.size,
                        contentLength = body.contentLength(),
                        expectedSha256 = expectation.sha256
                    )
                    return output to verified
                }
                currentUrl = redirectUrl ?: throw IllegalStateException("download_redirect_rejected")
            }
        } catch (error: Exception) {
            output.delete()
            throw error
        }
    }

    private fun verifyArchiveIdentity(apkFile: File) {
        val installed = activity.packageManager.getInstalledPackageInfo(activity.packageName).toArchiveIdentity()
        val candidate = activity.packageManager.getArchivePackageInfo(apkFile)
            ?.toArchiveIdentity()
            ?: throw IllegalStateException("invalid_apk_archive")
        if (!isTrustedApkArchive(installed, candidate)) {
            throw IllegalStateException("apk_identity_mismatch")
        }
    }

    private fun startPackageInstaller(apkFile: File, apkSha256: String, tagName: String) {
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
        pendingInstallerFile?.delete()
        pendingInstallerFile = apkFile
        activity.runOnUiThread {
            try {
                activity.startActivityForResult(intent, ANDROID_APK_INSTALL_REQUEST_CODE)
                dispatchUpdateEvent("installing", "", apkSha256, tagName)
            } catch (error: Exception) {
                onInstallerResult()
                dispatchUpdateEvent("failed", error.message ?: "installer_failed", "", tagName)
            }
        }
    }

    private fun cleanupStaleApkFiles(directory: File) {
        val cutoff = System.currentTimeMillis() - STALE_APK_AGE_MILLIS
        directory.listFiles()?.forEach { file ->
            if (file != pendingInstallerFile && file.lastModified() < cutoff) {
                file.delete()
            }
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

private fun PackageInfo.toArchiveIdentity(): ApkArchiveIdentity = ApkArchiveIdentity(
    packageName = packageName,
    versionCode = longVersionCodeCompat(),
    signerSha256 = signingCertificateDigests()
)

@Suppress("DEPRECATION")
private fun PackageInfo.signingCertificateDigests(): Set<String> {
    val certificates = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        signingInfo?.apkContentsSigners?.toList().orEmpty()
    } else {
        signatures?.toList().orEmpty()
    }
    return certificates.map { signature -> sha256Hex(signature.toByteArray()) }.toSet()
}

@Suppress("DEPRECATION")
private fun PackageManager.getInstalledPackageInfo(packageName: String): PackageInfo {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()))
    } else {
        getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
    }
}

@Suppress("DEPRECATION")
private fun PackageManager.getArchivePackageInfo(apkFile: File): PackageInfo? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        getPackageArchiveInfo(
            apkFile.absolutePath,
            PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong())
        )
    } else {
        getPackageArchiveInfo(apkFile.absolutePath, PackageManager.GET_SIGNING_CERTIFICATES)
    }
}

@Suppress("DEPRECATION")
private fun PackageInfo.longVersionCodeCompat(): Long {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) longVersionCode else versionCode.toLong()
}
