package io.github.munzzyy.sepia

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.security.SecureRandom
import java.util.ArrayDeque

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

    // The pending callback for an in-page <input type="file">, deliverable
    // exactly once: a second onShowFileChooser before this fires cancels it.
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val chooseFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = filePathCallback
        filePathCallback = null
        callback?.onReceiveValue(pickedUris(result.resultCode, result.data))
    }

    // A multi-select comes back as ClipData, which FileChooserParams.parseResult ignores.
    private fun pickedUris(resultCode: Int, data: Intent?): Array<Uri>? {
        val clip = data?.clipData
        if (resultCode == RESULT_OK && clip != null && clip.itemCount > 0) {
            val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
                .filter { it.scheme == "content" }
                .take(50)
            if (uris.isNotEmpty()) return uris.toTypedArray()
        }
        return WebChromeClient.FileChooserParams.parseResult(resultCode, data)
    }

    // Android 9 has no MediaStore write without a storage permission, so saves queue for the system picker, one at a time.
    private class PendingSave(val bytes: ByteArray, val mime: String, val name: String)

    private val pendingSaves = ArrayDeque<PendingSave>()
    private var pickerOpen = false

    private val createDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        pickerOpen = false
        val save = pendingSaves.pollFirst()
        val uri = result.data?.data
        if (save != null && result.resultCode == RESULT_OK && uri != null) {
            val ok = runCatching { contentResolver.openOutputStream(uri)?.use { it.write(save.bytes) } != null }.getOrDefault(false)
            Toast.makeText(this, getString(if (ok) R.string.saved else R.string.save_failed), Toast.LENGTH_SHORT).show()
        }
        openNextSavePicker()
    }

    fun saveWithPicker(bytes: ByteArray, mime: String, name: String) {
        pendingSaves.addLast(PendingSave(bytes, mime, name))
        openNextSavePicker()
    }

    private fun openNextSavePicker() {
        if (pickerOpen) return
        val next = pendingSaves.peekFirst() ?: return
        val pick = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = next.mime
            putExtra(Intent.EXTRA_TITLE, next.name)
        }
        try {
            createDocument.launch(pick)
            pickerOpen = true
        } catch (e: ActivityNotFoundException) {
            pendingSaves.clear()
            Toast.makeText(this, getString(R.string.save_failed), Toast.LENGTH_SHORT).show()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // The canvas holds the sensitive original. The app switcher would
        // otherwise thumbnail it, and that thumbnail outlives the session.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        if (SystemCheck.blockIfWebViewTooOld(this)) return

        webView = WebView(this)
        val root = FrameLayout(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )
        setContentView(root)

        // Android 15 and later lay every app out under the status bar, the camera
        // cutout and the navigation bar. Inset the container, not the WebView:
        // WebView padding moves its paint but not Chromium's hit-testing.
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            insets
        }

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

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                try {
                    chooseFile.launch(params.createIntent())
                } catch (e: ActivityNotFoundException) {
                    filePathCallback = null
                    callback.onReceiveValue(null)
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
        SystemCheck.noteAndroid9(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (!::webView.isInitialized) return
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
