package com.wheelmaker.android

import android.net.Uri
import android.util.Log

private const val WEB_DIAG_TAG = "WheelMakerWeb"
private const val WEB_DIAG_PREFIX = "[WM-DIAG]"

fun logWebDiag(message: String) {
    Log.i(WEB_DIAG_TAG, "$WEB_DIAG_PREFIX $message")
}

fun shouldLogStableOriginRequest(uri: Uri): Boolean {
    if (uri.scheme != "https" || uri.host != "appassets.androidplatform.net") {
        return false
    }
    val assetName = assetNameForStablePath(uri.encodedPath ?: "/")
    return shouldLogStableOriginAsset(assetName)
}

fun shouldLogStableOriginAsset(assetName: String): Boolean {
    val baseName = assetName.substringAfterLast('/')
    return assetName == "index.html" ||
        baseName == "service-worker.js" ||
        baseName == "manifest.webmanifest" ||
        baseName.endsWith(".css") ||
        baseName.endsWith(".js") ||
        baseName.endsWith(".ttf") ||
        baseName.endsWith(".woff") ||
        baseName.endsWith(".woff2") ||
        baseName.endsWith(".eot")
}
