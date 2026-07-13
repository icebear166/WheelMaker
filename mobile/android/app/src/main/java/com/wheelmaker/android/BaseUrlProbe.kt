package com.wheelmaker.android

import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

data class BaseUrlProbeResult(
    val ok: Boolean,
    val error: String = ""
)

class BaseUrlProbe(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .callTimeout(PROBE_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS)
        .build()
) {
    fun probe(baseUrl: String): BaseUrlProbeResult {
        val normalized = normalizeHttpsBaseUrl(baseUrl)
            ?: return BaseUrlProbeResult(false, "Enter a valid HTTPS server address.")
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(PROBE_TIMEOUT_MILLIS)
        var current = normalized
        var redirectCount = 0

        while (true) {
            val remainingMillis = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime())
            if (remainingMillis <= 0) return BaseUrlProbeResult(false, "Connection timed out.")
            val request = Request.Builder()
                .url(current)
                .header("User-Agent", "WheelMakerAndroid/remote-shell")
                .get()
                .build()
            val callClient = client.newBuilder()
                .callTimeout(remainingMillis, TimeUnit.MILLISECONDS)
                .build()
            val response = try {
                callClient.newCall(request).execute()
            } catch (error: Exception) {
                return BaseUrlProbeResult(false, error.message ?: "Secure connection failed.")
            }
            response.use {
                val location = it.header("Location")
                if (it.code in 300..399 && !location.isNullOrBlank()) {
                    redirectCount += 1
                    val redirect = it.request.url.resolve(location)?.toString().orEmpty()
                    if (!isAllowedProbeRedirect(redirect, redirectCount)) {
                        return BaseUrlProbeResult(false, "Server redirected outside HTTPS policy.")
                    }
                    current = redirect
                    continue
                }
                return if (it.code in 200..399) {
                    BaseUrlProbeResult(true)
                } else {
                    BaseUrlProbeResult(false, "Server returned HTTP ${it.code}.")
                }
            }
        }
    }

    private companion object {
        const val PROBE_TIMEOUT_MILLIS = 3_000L
    }
}
