package io.github.munzzyy.sepia

import android.content.ContentValues
import android.content.Intent
import android.provider.MediaStore
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File

// The page's window into the platform. Only bundled app code can call this:
// the WebView never navigates off the asset origin, so every caller shipped
// in the APK.
class SepiaBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun platform(): String = "android"

    @JavascriptInterface
    fun version(): String = runCatching {
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName
    }.getOrNull() ?: "unknown"

    @JavascriptInterface
    fun sharedImageTokens(): String = activity.sharedTokensJson()

    // Scrubbed bytes to the system share sheet. The file lands in a scoped
    // cache directory only the FileProvider exposes, named by the scrubbed
    // name so the receiving app sees nothing the export screen did not show.
    @JavascriptInterface
    fun shareImage(b64: String, mime: String, name: String) {
        val bytes = runCatching { Base64.decode(b64, Base64.DEFAULT) }.getOrNull() ?: return
        // Everything filesystem-touching is guarded: an IOException on the
        // JavaBridge thread would otherwise take the whole process down.
        val uri = runCatching {
            val dir = File(activity.cacheDir, "shared_out").apply { mkdirs() }
            // A fresh directory per share; stale exports do not accumulate.
            dir.listFiles()?.forEach { it.delete() }
            val file = File(dir, sanitize(name))
            file.writeBytes(bytes)
            FileProvider.getUriForFile(activity, "io.github.munzzyy.sepia.files", file)
        }.getOrNull()
        activity.runOnUiThread {
            if (uri == null) {
                Toast.makeText(activity, activity.getString(R.string.save_failed), Toast.LENGTH_SHORT).show()
                return@runOnUiThread
            }
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mime
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            runCatching {
                activity.startActivity(Intent.createChooser(send, null))
            }
        }
    }

    // Scrubbed bytes into the gallery under Pictures/Sepia. MediaStore
    // needs no permission for app-created images on this minSdk.
    @JavascriptInterface
    fun saveImage(b64: String, mime: String, name: String) {
        val bytes = runCatching { Base64.decode(b64, Base64.DEFAULT) }.getOrNull() ?: return
        // Plain Pictures/: a gallery album literally named after a scrubbing
        // tool would advertise exactly which photos were sanitized.
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, sanitize(name))
            put(MediaStore.Images.Media.MIME_TYPE, mime)
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/")
        }
        val resolver = activity.contentResolver
        val ok = runCatching {
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: return@runCatching false
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return@runCatching false
            true
        }.getOrDefault(false)
        activity.runOnUiThread {
            Toast.makeText(
                activity,
                if (ok) activity.getString(R.string.saved_to_photos)
                else activity.getString(R.string.save_failed),
                Toast.LENGTH_SHORT,
            ).show()
        }
    }

    private fun sanitize(name: String): String {
        val safe = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(64)
        // A name of only dots or underscores would address the directory
        // itself or vanish; fall back to something boring.
        return if (safe.trim('.', '_').isEmpty()) "image.png" else safe
    }
}
