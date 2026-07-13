package com.wheelmaker.android

import android.Manifest
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import android.view.animation.AlphaAnimation
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.Toast
import androidx.core.graphics.Insets
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var rootView: FrameLayout
    private lateinit var webView: WebView
    private lateinit var baseUrlStore: BaseUrlStore
    private lateinit var baseUrlProbe: BaseUrlProbe
    private lateinit var navigationExecutor: ExecutorService
    @Volatile private var configuredBaseUrl: String = ""
    @Volatile private var bootstrapError: String = ""
    private lateinit var androidSpeechRuntime: AndroidSpeechRuntime
    private lateinit var androidNotificationRuntime: AndroidNotificationRuntime
    private lateinit var androidApkUpdateRuntime: AndroidApkUpdateRuntime
    private lateinit var androidImageShareRuntime: AndroidImageShareRuntime
    private lateinit var androidPortRelaySiteDataRuntime: AndroidPortRelaySiteDataRuntime
    private lateinit var androidWebDiagnostics: AndroidWebDiagnostics
    private lateinit var androidDiagnosticLogLevelStore: AndroidDiagnosticLogLevelStore
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private var pendingAudioPermissionRequest: PermissionRequest? = null
    private var systemBackCallback: OnBackInvokedCallback? = null
    private var splashOverlay: FrameLayout? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        baseUrlStore = BaseUrlStore(this)
        baseUrlProbe = BaseUrlProbe()
        navigationExecutor = Executors.newSingleThreadExecutor()
        configuredBaseUrl = baseUrlStore.load()
        androidDiagnosticLogLevelStore = SharedPreferencesAndroidDiagnosticLogLevelStore(this)
        androidWebDiagnostics = AndroidWebDiagnostics(logLevel = androidDiagnosticLogLevelStore.loadDiagnosticLogLevel())
        androidWebDiagnostics.record("startup_remote_shell", mapOf("baseUrl" to configuredBaseUrl))

        rootView = FrameLayout(this)
        rootView.setBackgroundColor(APP_BACKGROUND_COLOR)
        webView = WebView(this)
        androidSpeechRuntime = AndroidSpeechRuntime(this, webView, NATIVE_SPEECH_PERMISSION_REQUEST_CODE)
        androidNotificationRuntime = AndroidNotificationRuntime(
            this,
            webView,
            NOTIFICATION_PERMISSION_REQUEST_CODE,
            baseUrlProvider = { configuredBaseUrl }
        )
        androidApkUpdateRuntime = AndroidApkUpdateRuntime(this, webView)
        androidImageShareRuntime = AndroidImageShareRuntime(this)
        androidPortRelaySiteDataRuntime = AndroidPortRelaySiteDataRuntime(webView)
        webView.setBackgroundColor(APP_BACKGROUND_COLOR)
        configureWindowInsets(rootView)
        configureWebView(webView)
        rootView.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        splashOverlay = createSplashOverlay()
        rootView.addView(splashOverlay)
        setContentView(rootView)
        registerSystemBackCallback()
        startInitialNavigation(notificationTargetUrl(intent))
    }

    private fun createSplashOverlay(): FrameLayout {
        val overlay = FrameLayout(this)
        overlay.setBackgroundColor(APP_BACKGROUND_COLOR)
        val contentLayout = android.widget.LinearLayout(this)
        contentLayout.orientation = android.widget.LinearLayout.VERTICAL
        contentLayout.gravity = android.view.Gravity.CENTER
        val iconSize = (120 * resources.displayMetrics.density).toInt()
        val iconParams = android.widget.LinearLayout.LayoutParams(iconSize, iconSize)
        iconParams.gravity = android.view.Gravity.CENTER_HORIZONTAL
        val icon = ImageView(this)
        icon.setImageResource(R.drawable.ic_launcher_foreground)
        icon.layoutParams = iconParams
        contentLayout.addView(icon)
        val loadingSize = (40 * resources.displayMetrics.density).toInt()
        val loadingParams = android.widget.LinearLayout.LayoutParams(loadingSize, loadingSize)
        loadingParams.gravity = android.view.Gravity.CENTER_HORIZONTAL
        loadingParams.topMargin = (32 * resources.displayMetrics.density).toInt()
        val loading = ProgressBar(this)
        loading.indeterminateDrawable.setColorFilter(Color.WHITE, android.graphics.PorterDuff.Mode.SRC_IN)
        loading.layoutParams = loadingParams
        contentLayout.addView(loading)
        val overlayParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        overlay.addView(contentLayout, overlayParams)
        return overlay
    }

    private fun dismissSplashOverlay() {
        val overlay = splashOverlay ?: return
        splashOverlay = null
        val fadeOut = AlphaAnimation(1f, 0f)
        fadeOut.duration = 300
        fadeOut.setAnimationListener(object : android.view.animation.Animation.AnimationListener {
            override fun onAnimationStart(animation: android.view.animation.Animation?) {}
            override fun onAnimationRepeat(animation: android.view.animation.Animation?) {}
            override fun onAnimationEnd(animation: android.view.animation.Animation?) {
                rootView.removeView(overlay)
            }
        })
        overlay.startAnimation(fadeOut)
    }

    override fun onPause() {
        if (::androidSpeechRuntime.isInitialized) {
            androidSpeechRuntime.stopForAppBackground()
        }
        super.onPause()
    }

    override fun onDestroy() {
        unregisterSystemBackCallback()
        if (::androidSpeechRuntime.isInitialized) {
            androidSpeechRuntime.stopForAppBackground()
        }
        if (::navigationExecutor.isInitialized) {
            navigationExecutor.shutdownNow()
        }
        super.onDestroy()
    }

    override fun onBackPressed() {
        handleSystemBack()
    }

    private fun handleSystemBack() {
        webView.evaluateJavascript(ANDROID_BACK_SCRIPT) { rawResult ->
            val consumed = rawResult == "true"
            if (consumed) {
                return@evaluateJavascript
            }
            performDefaultBackNavigation()
        }
    }

    private fun registerSystemBackCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return
        }
        val callback = OnBackInvokedCallback {
            handleSystemBack()
        }
        systemBackCallback = callback
        onBackInvokedDispatcher.registerOnBackInvokedCallback(
            OnBackInvokedDispatcher.PRIORITY_DEFAULT,
            callback
        )
    }

    private fun unregisterSystemBackCallback() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return
        }
        systemBackCallback?.let { callback ->
            onBackInvokedDispatcher.unregisterOnBackInvokedCallback(callback)
        }
        systemBackCallback = null
    }

    private fun performDefaultBackNavigation() {
        if (webView.canGoBack()) {
            webView.goBack()
            return
        }
        super.onBackPressed()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleNotificationIntent(intent)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_CHOOSER_REQUEST_CODE) {
            deliverFileChooserResult(resultCode, data)
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (::androidSpeechRuntime.isInitialized && androidSpeechRuntime.onRequestPermissionsResult(requestCode, grantResults)) {
            return
        }
        if (::androidNotificationRuntime.isInitialized && androidNotificationRuntime.onRequestPermissionsResult(requestCode, grantResults)) {
            return
        }
        if (requestCode != AUDIO_PERMISSION_REQUEST_CODE) return
        val request = pendingAudioPermissionRequest ?: return
        pendingAudioPermissionRequest = null
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            request.deny()
        }
    }

    private fun configureWebView(target: WebView) {
        target.settings.javaScriptEnabled = true
        target.settings.domStorageEnabled = true
        target.settings.databaseEnabled = true
        target.settings.cacheMode = WebSettings.LOAD_DEFAULT
        target.settings.allowContentAccess = true
        target.settings.allowFileAccess = false
        target.settings.mediaPlaybackRequiresUserGesture = false
        target.settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(target, true)
        target.webViewClient = object : StableOriginWebViewClient(
            this,
            configuredBaseUrl = { configuredBaseUrl },
            onRemoteFailure = { message -> showBootstrap(message) }
        ) {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                dismissSplashOverlay()
            }
        }
        target.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                    handleAudioPermissionRequest(request)
                    return
                }
                request.deny()
            }

            override fun onShowFileChooser(
                webView: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback
                return try {
                    startActivityForResult(createAndroidFileChooserIntent(fileChooserParams), FILE_CHOOSER_REQUEST_CODE)
                    true
                } catch (_: ActivityNotFoundException) {
                    fileChooserCallback = null
                    filePathCallback.onReceiveValue(null)
                    false
                }
            }
        }
        target.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            enqueueDownload(url, userAgent, contentDisposition, mimeType)
        }
        target.addJavascriptInterface(
            WheelMakerBridge(
                androidSpeechRuntime,
                androidNotificationRuntime,
                androidApkUpdateRuntime,
                androidImageShareRuntime,
                androidPortRelaySiteDataRuntime,
                androidWebDiagnostics,
                androidDiagnosticLogLevelStore
            ),
            "WheelMakerAndroidNative"
        )
    }

    private fun handleNotificationIntent(intent: Intent?) {
        val targetUrl = notificationTargetUrl(intent) ?: return
        val baseUrl = configuredBaseUrl
        if (baseUrl.isNotBlank() && BaseUrlPolicy(baseUrl).contains(targetUrl)) {
            webView.loadUrl(targetUrl)
        }
    }

    private fun startInitialNavigation(notificationUrl: String?) {
        val baseUrl = configuredBaseUrl
        if (baseUrl.isBlank()) {
            showBootstrap("")
            return
        }
        probeAndLoad(baseUrl, notificationUrl)
    }

    private fun probeAndLoad(baseUrl: String, requestedUrl: String? = null) {
        navigationExecutor.execute {
            val result = baseUrlProbe.probe(baseUrl)
            runOnUiThread {
                if (isFinishing || isDestroyed || baseUrl != configuredBaseUrl) return@runOnUiThread
                if (!result.ok) {
                    showBootstrap(result.error)
                    return@runOnUiThread
                }
                bootstrapError = ""
                val policy = BaseUrlPolicy(baseUrl)
                val targetUrl = requestedUrl?.takeIf(policy::contains) ?: baseUrl
                loadConfiguredRemote(webView, targetUrl)
            }
        }
    }

    private fun loadConfiguredRemote(target: WebView, configuredBaseUrl: String) {
        target.loadUrl(configuredBaseUrl)
    }

    private fun showBootstrap(error: String) {
        bootstrapError = error
        if (::webView.isInitialized && webView.url != ANDROID_BOOTSTRAP_URL) {
            webView.loadUrl(ANDROID_BOOTSTRAP_URL)
        }
        dismissSplashOverlay()
    }

    private fun createAndroidFileChooserIntent(fileChooserParams: WebChromeClient.FileChooserParams): Intent {
        val acceptTypes = normalizeAndroidFileChooserAcceptTypes(fileChooserParams.acceptTypes)
        val allowMultiple = fileChooserParams.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        if (shouldUseAndroidPhotoPicker(acceptTypes, Build.VERSION.SDK_INT)) {
            return createAndroidPhotoPickerIntent(acceptTypes, allowMultiple)
        }
        return createAndroidDocumentFileChooserIntent(acceptTypes, allowMultiple)
    }

    private fun createAndroidDocumentFileChooserIntent(acceptTypes: List<String>, allowMultiple: Boolean): Intent {
        return Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = acceptTypes.singleOrNull() ?: "*/*"
            if (acceptTypes.size > 1) {
                putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes.toTypedArray())
            }
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, allowMultiple)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
    }

    private fun createAndroidPhotoPickerIntent(acceptTypes: List<String>, allowMultiple: Boolean): Intent {
        return Intent(MediaStore.ACTION_PICK_IMAGES).apply {
            photoPickerTypeForAcceptTypes(acceptTypes)?.let { type = it }
            if (allowMultiple) {
                putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, MediaStore.getPickImagesMaxLimit())
            }
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }

    private fun deliverFileChooserResult(resultCode: Int, data: Intent?) {
        val result = collectFileChooserResultUris(resultCode, data)
        fileChooserCallback?.onReceiveValue(result)
        fileChooserCallback = null
    }

    private fun collectFileChooserResultUris(resultCode: Int, data: Intent?): Array<Uri>? {
        if (resultCode != RESULT_OK) {
            return null
        }
        val uris = linkedSetOf<Uri>()
        val clipData = data?.clipData
        if (clipData != null) {
            for (index in 0 until clipData.itemCount) {
                clipData.getItemAt(index).uri?.let { uris.add(it) }
            }
        }
        data?.data?.let { uris.add(it) }
        WebChromeClient.FileChooserParams.parseResult(resultCode, data)?.forEach { uris.add(it) }
        if (uris.isEmpty()) {
            return null
        }
        persistFileChooserReadPermissions(uris, data)
        return uris.toTypedArray()
    }

    private fun persistFileChooserReadPermissions(uris: Set<Uri>, data: Intent?) {
        val flags = data?.flags ?: 0
        if ((flags and Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0) {
            return
        }
        if ((flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) == 0) {
            return
        }
        for (uri in uris) {
            try {
                contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } catch (_: SecurityException) {
                // Some providers grant temporary read access only; WebView can still consume those URIs immediately.
            }
        }
    }

    private fun configureWindowInsets(target: FrameLayout) {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val attributes = window.attributes
            attributes.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            window.attributes = attributes
        }
        WindowInsetsControllerCompat(window, target).isAppearanceLightStatusBars = false
        WindowInsetsControllerCompat(window, target).isAppearanceLightNavigationBars = false
        ViewCompat.setOnApplyWindowInsetsListener(target) { view, insets ->
            val contentInsets = mergedContentInsets(
                systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars()).toEdgeInsets(),
                displayCutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout()).toEdgeInsets(),
                ime = insets.getInsets(WindowInsetsCompat.Type.ime()).toEdgeInsets()
            )
            view.setPadding(contentInsets.left, contentInsets.top, contentInsets.right, contentInsets.bottom)
            WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.systemBars(), Insets.NONE)
                .setInsets(WindowInsetsCompat.Type.displayCutout(), Insets.NONE)
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                .build()
        }
        ViewCompat.requestApplyInsets(target)
    }

    private fun handleAudioPermissionRequest(request: PermissionRequest) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            return
        }
        pendingAudioPermissionRequest?.deny()
        pendingAudioPermissionRequest = request
        ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), AUDIO_PERMISSION_REQUEST_CODE)
    }

    private fun enqueueDownload(url: String, userAgent: String, contentDisposition: String, mimeType: String) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            Toast.makeText(this, "Download is not available for this file.", Toast.LENGTH_SHORT).show()
            return
        }
        val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
        val request = DownloadManager.Request(Uri.parse(url))
            .setMimeType(mimeType)
            .addRequestHeader("User-Agent", userAgent)
            .setTitle(fileName)
            .setDescription("WheelMaker")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
        val manager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        manager.enqueue(request)
        Toast.makeText(this, "Download started.", Toast.LENGTH_SHORT).show()
    }

    companion object {
        private const val AUDIO_PERMISSION_REQUEST_CODE = 1001
        private const val FILE_CHOOSER_REQUEST_CODE = 1002
        private const val NATIVE_SPEECH_PERMISSION_REQUEST_CODE = 1003
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1004
        private const val ANDROID_BACK_SCRIPT = "(function(){try{var handler=window.WheelMakerAndroidBack&&window.WheelMakerAndroidBack.handleBack;if(typeof handler==='function'){return handler()===true;}}catch(error){}return false;})()"
        private val APP_BACKGROUND_COLOR = Color.rgb(11, 18, 32)
    }
}

fun normalizeAndroidFileChooserAcceptTypes(acceptTypes: Array<String>?): List<String> {
    return acceptTypes
        .orEmpty()
        .flatMap { it.split(',') }
        .map { it.trim().lowercase(Locale.US) }
        .filter { it.isNotBlank() && (it == "*/*" || it.contains('/')) }
        .distinct()
}

fun shouldUseAndroidPhotoPicker(acceptTypes: List<String>, sdkInt: Int): Boolean {
    if (sdkInt < Build.VERSION_CODES.TIRAMISU || acceptTypes.isEmpty()) {
        return false
    }
    return acceptTypes.all { isAndroidPhotoPickerMimeType(it) }
}

fun photoPickerTypeForAcceptTypes(acceptTypes: List<String>): String? {
    val hasImages = acceptTypes.any { it.startsWith("image/") }
    val hasVideos = acceptTypes.any { it.startsWith("video/") }
    return when {
        hasImages && !hasVideos -> "image/*"
        hasVideos && !hasImages -> "video/*"
        else -> null
    }
}

private fun isAndroidPhotoPickerMimeType(mimeType: String): Boolean {
    return mimeType.startsWith("image/") || mimeType.startsWith("video/")
}
