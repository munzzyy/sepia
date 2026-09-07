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

    // Images a share intent handed over, held in RAM as (token, uri) pairs.
    // The page fetches /shared/<token> over the asset origin, which streams
    // the content resolver straight into the renderer: no base64 through
    // the bridge, no copy on disk. Each token serves exactly once.
    private val shared = mutableListOf<Pair<String, Uri>>()

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

            // The WebView only ever navigates inside the bundled app; a
            // link out (the about link) goes to the system browser. Gated
            // hard: main-frame https navigations carrying a real user
            // gesture, nothing else. Anything less and this method is a
            // relay that hands arbitrary URLs (and query strings) to a
            // process that does have network access.
            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                if (request.url.host == ASSET_HOST) return false
                if (request.isForMainFrame && request.hasGesture() && request.url.scheme == "https") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
                }
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })

        // The previous session's shared export has served its purpose; the
        // privacy page promises it does not outlive the next app start.
        runCatching { java.io.File(cacheDir, "shared_out").deleteRecursively() }

        takeShared(intent)
        webView.loadUrl(START_URL)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (takeShared(intent)) {
            // The page is live; hand over EVERY outstanding token, or a
            // multi-share to a warm instance would drop all but one image.
            // The JSON is hex strings and brackets, safe to embed.
            webView.evaluateJavascript(
                "globalThis.__sepiaShared && __sepiaShared(${sharedTokensJson()})",
                null,
            )
        }
    }

    fun sharedTokensJson(): String =
        shared.joinToString(prefix = "[", postfix = "]", separator = ",") { "\"${it.first}\"" }

    private fun takeShared(intent: Intent?): Boolean {
        val uris: List<Uri> = when (intent?.action) {
            Intent.ACTION_SEND ->
                listOfNotNull(
                    androidx.core.content.IntentCompat.getParcelableExtra(
                        intent, Intent.EXTRA_STREAM, Uri::class.java,
                    ),
                )
            Intent.ACTION_SEND_MULTIPLE ->
                androidx.core.content.IntentCompat.getParcelableArrayListExtra(
                    intent, Intent.EXTRA_STREAM, Uri::class.java,
                )?.filterNotNull() ?: emptyList()
            Intent.ACTION_VIEW -> listOfNotNull(intent.data)
            else -> emptyList()
        }
        // content:// only: a hostile sender must not make this process open
        // file:// paths (least of all Sepia's own cache) or exotic schemes.
        val safe = uris.filter { it.scheme == "content" && it.authority != "io.github.munzzyy.sepia.files" }
        if (safe.isEmpty()) return false
        val rng = SecureRandom()
        for (uri in safe.take(50)) {
            val raw = ByteArray(16)
            rng.nextBytes(raw)
            shared.add(raw.joinToString("") { "%02x".format(it) } to uri)
        }
        return true
    }

    // One-shot: a successful serve removes the entry, so the unredacted
    // original does not stay fetchable for the activity's life.
    private fun serveShared(path: String): WebResourceResponse? {
        val idx = shared.indexOfFirst { it.first == path }
        if (idx == -1) return null
        val (_, uri) = shared[idx]
        return runCatching {
            val mime = contentResolver.getType(uri) ?: "image/*"
            val stream = contentResolver.openInputStream(uri)
            shared.removeAt(idx)
            WebResourceResponse(mime, null, stream)
        }.getOrNull()
    }

    override fun onDestroy() {
        shared.clear()
        super.onDestroy()
    }
}
