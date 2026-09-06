package io.github.munzzyy.sepia

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.webkit.WebViewAssetLoader
import java.security.SecureRandom

// One screen: the bundled web app in a WebView on the fixed asset origin.
// The APK carries no INTERNET permission, so the only bytes this WebView can
// ever load are the ones intercepted below: bundled assets, and the one
// image a share intent handed over.
class MainActivity : ComponentActivity() {

    companion object {
        const val ASSET_HOST = "appassets.androidplatform.net"
        const val START_URL = "https://$ASSET_HOST/index.html"
    }

    lateinit var webView: WebView
        private set

    private lateinit var assetLoader: WebViewAssetLoader

    // The image a share intent handed over, held in RAM as a (token, uri)
    // pair. The page fetches /shared/<token> over the asset origin, which
    // streams the content resolver straight into the renderer: no base64
    // through the bridge, no copy on disk.
    private var sharedUri: Uri? = null
    private var sharedToken: String = ""

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // The canvas holds the sensitive original. The app switcher would
        // otherwise thumbnail it, and that thumbnail outlives the session.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        webView = WebView(this)
        setContentView(webView)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/shared/") { path -> serveShared(path) }
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            // The system font-size setting reaches WebView content only
            // through textZoom, and it scales px-sized text too.
            textZoom = (resources.configuration.fontScale * 100).toInt()
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
        }

        webView.addJavascriptInterface(SepiaBridge(this), "SepiaNative")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            // The WebView only ever navigates inside the bundled app; any
            // link out (the about page, the privacy page on the site) goes
            // to the system browser, which has its own network access.
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                if (request.url.host == ASSET_HOST) return false
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        takeShared(intent)
        webView.loadUrl(START_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (takeShared(intent)) {
            // The page is live; hand the new token over as a call.
            webView.evaluateJavascript(
                "globalThis.__sepiaShared && __sepiaShared(\"$sharedToken\")",
                null,
            )
        }
    }

    fun sharedToken(): String = sharedToken

    private fun takeShared(intent: Intent?): Boolean {
        val uri: Uri? = when (intent?.action) {
            Intent.ACTION_SEND ->
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(Intent.EXTRA_STREAM)
            Intent.ACTION_VIEW -> intent.data
            else -> null
        }
        if (uri == null) return false
        sharedUri = uri
        // Unguessable and single-session: the token only exists in RAM.
        val raw = ByteArray(16)
        SecureRandom().nextBytes(raw)
        sharedToken = raw.joinToString("") { "%02x".format(it) }
        return true
    }

    private fun serveShared(path: String): WebResourceResponse? {
        val uri = sharedUri ?: return null
        if (sharedToken.isEmpty() || path != sharedToken) return null
        return runCatching {
            val mime = contentResolver.getType(uri) ?: "image/*"
            WebResourceResponse(mime, null, contentResolver.openInputStream(uri))
        }.getOrNull()
    }

    override fun onDestroy() {
        sharedUri = null
        sharedToken = ""
        super.onDestroy()
    }
}
