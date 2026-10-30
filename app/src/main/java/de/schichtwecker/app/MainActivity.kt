package de.schichtwecker.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.Keep
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import de.schichtwecker.app.ui.theme.MyApplicationTheme
import java.util.Locale

class MainActivity : ComponentActivity() {

    companion object {
        private const val PREFS_NAME = "schichtplan_prefs"
        const val KEY_RINGTONE_URI = "ringtone_uri"
        const val KEY_RINGTONE_NAME = "ringtone_name"
        const val KEY_USE_CUSTOM_RINGTONE = "use_custom_ringtone"

        fun getRingtonePrefs(context: Context): SharedPreferences {
            return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        }

        fun getCustomRingtoneUri(context: Context): String? {
            return getRingtonePrefs(context).getString(KEY_RINGTONE_URI, null)
        }

        fun getCustomRingtoneName(context: Context): String? {
            return getRingtonePrefs(context).getString(KEY_RINGTONE_NAME, null)
        }

        fun usesCustomRingtone(context: Context): Boolean {
            return getRingtonePrefs(context).getBoolean(KEY_USE_CUSTOM_RINGTONE, false)
        }

        fun getFileNameFromUri(context: Context, uri: Uri): String? {
            var name: String? = null
            val cursor: Cursor? = context.contentResolver.query(uri, null, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val nameIndex = it.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIndex >= 0) name = it.getString(nameIndex)
                }
            }
            return name
        }
    }

    var pendingWebView: WebView? = null
        internal set

    private val notifPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        Log.d("SchichtplanAlarm", "POST_NOTIFICATIONS granted: $granted")
        checkFullScreenIntentPermission()
    }

    private val ringtonePicker = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        uri?.let {
            contentResolver.takePersistableUriPermission(
                it, Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
            val prefs = getRingtonePrefs(this)
            val fileName = getFileNameFromUri(this, it) ?: "Eigener Klingelton"
            prefs.edit()
                .putString(KEY_RINGTONE_URI, it.toString())
                .putString(KEY_RINGTONE_NAME, fileName)
                .putBoolean(KEY_USE_CUSTOM_RINGTONE, true)
                .apply()
            Log.d("SchichtplanAlarm", "Klingelton gespeichert: $fileName ($it)")
            toast("Klingelton gesetzt: $fileName")
            pendingWebView?.let { wv ->
                wv.post {
                    val safeName = fileName
                        .replace("\\", "\\\\")
                        .replace("'", "\\'")
                        .replace("\n", "\\n")
                        .replace("\r", "\\r")
                    wv.evaluateJavascript(
                        "if(typeof onRingtoneChanged==='function')onRingtoneChanged('$safeName');",
                        null
                    )
                }
            }
        }
    }

    private fun toast(text: String) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        requestPermissions()
        setContent {
            MyApplicationTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    WebViewScreen(
                        modifier = Modifier.padding(innerPadding)
                    )
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        pendingWebView = null
    }

    private fun requestPermissions() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            checkFullScreenIntentPermission()
        }
    }

    private fun checkFullScreenIntentPermission() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (!nm.canUseFullScreenIntent()) {
            Log.w("SchichtplanAlarm", "USE_FULL_SCREEN_INTENT not granted")
            AlertDialog.Builder(this)
                .setTitle("Vollbild-Wecker erlauben")
                .setMessage(
                    "Damit der Wecker auch bei gesperrtem Bildschirm als Vollbild erscheint, " +
                    "braucht die App die Berechtigung \u201EVollbild-Benachrichtigungen\u201C. " +
                    "Ohne sie klingelt der Wecker trotzdem, zeigt sich aber nur als Benachrichtigung."
                )
                .setPositiveButton("Einstellungen \u00F6ffnen") { _, _ ->
                    startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                        data = "package:$packageName".toUri()
                    })
                }
                .setNegativeButton("Sp\u00E4ter", null)
                .show()
        }
    }

    fun launchRingtonePicker() {
        try {
            ringtonePicker.launch(arrayOf("audio/*"))
        } catch (e: Exception) {
            Log.e("SchichtplanAlarm", "Ringtone picker fehlgeschlagen", e)
            toast("Datei-Auswahl nicht verfügbar")
        }
    }
}

@Keep
class WebAppInterface(private val mContext: Context, private val activity: MainActivity) {
    private val mainHandler = Handler(Looper.getMainLooper())

    private fun toast(text: String) {
        mainHandler.post { Toast.makeText(mContext, text, Toast.LENGTH_LONG).show() }
    }

    @JavascriptInterface
    @Keep
    fun setAlarmForDate(
        year: Int, month: Int, day: Int,
        hour: Int, minute: Int,
        alarmKey: String, message: String
    ): Boolean {
        return setAlarmForDateInternal(year, month, day, hour, minute, alarmKey, message, silent = false)
    }

    @JavascriptInterface
    @Keep
    fun setAlarmForDateSilent(
        year: Int, month: Int, day: Int,
        hour: Int, minute: Int,
        alarmKey: String, message: String
    ): Boolean {
        return setAlarmForDateInternal(year, month, day, hour, minute, alarmKey, message, silent = true)
    }

    private fun setAlarmForDateInternal(
        year: Int, month: Int, day: Int,
        hour: Int, minute: Int,
        alarmKey: String, message: String,
        silent: Boolean
    ): Boolean {
        Log.d("SchichtplanAlarm", "setAlarmForDate: $day.$month.$year $hour:$minute key=$alarmKey silent=$silent")
        val time = String.format(Locale.GERMAN, "%02d:%02d", hour, minute)
        val dayText = String.format(Locale.GERMAN, "%02d.%02d.%04d", day, month, year)
        val ok = AlarmScheduler.schedule(mContext, alarmKey, year, month, day, hour, minute, message)
        if (!silent) {
            if (ok) {
                val millis = AlarmStore.get(mContext, alarmKey)?.millis ?: 0L
                val diffMin = (millis - System.currentTimeMillis()) / 60_000
                val diffText = if (diffMin < 60) "$diffMin Min." else "${diffMin / 60} Std. ${diffMin % 60} Min."
                toast("\u23F0 Wecker: $dayText $time (in $diffText)")
            } else {
                toast("Wecker $time Uhr am $dayText konnte nicht gesetzt werden (Vergangenheit?)")
            }
        }
        return ok
    }

    /** Löscht Wecker + Schlummer-Wecker. Ohne Toast – die Meldung zeigt die Web-Oberfläche. */
    @JavascriptInterface
    @Keep
    fun cancelAlarm(alarmKey: String): Boolean = AlarmScheduler.cancel(mContext, alarmKey)

    /** Löscht alle nativ bekannten Wecker (für „Alles zurücksetzen“). */
    @JavascriptInterface
    @Keep
    fun cancelAllAlarms(): Int = AlarmScheduler.cancelAll(mContext)

    /** JSON-Array der Schlüssel aller noch geplanten Wecker (Abgleich mit der Web-Oberfläche). */
    @JavascriptInterface
    @Keep
    fun getScheduledKeys(): String = AlarmStore.keysJson(mContext)

    /** false, solange die Wecker aus Versionen vor dem AlarmStore noch nicht übernommen wurden. */
    @JavascriptInterface
    @Keep
    fun isStoreMigrated(): Boolean = AlarmStore.isMigrated(mContext)

    @JavascriptInterface
    @Keep
    fun setStoreMigrated() = AlarmStore.setMigrated(mContext)

    @JavascriptInterface
    @Keep
    fun testAlarm() {
        Log.d("SchichtplanAlarm", "testAlarm() aufgerufen – Alarm in 15 Sekunden")
        val ok = AlarmScheduler.scheduleAt(
            mContext, "test-alarm", System.currentTimeMillis() + 15_000L,
            "TEST \u2013 Der Wecker funktioniert!"
        )
        toast(if (ok) "\u23F0 TEST-Wecker in 15 Sekunden!" else "Fehler: Wecker konnte nicht geplant werden")
    }

    @JavascriptInterface
    @Keep
    fun getCustomRingtoneName(): String {
        return MainActivity.getCustomRingtoneName(mContext) ?: ""
    }

    @JavascriptInterface
    @Keep
    fun usesCustomRingtone(): Boolean {
        return MainActivity.usesCustomRingtone(mContext)
    }

    @JavascriptInterface
    @Keep
    fun pickRingtone() {
        mainHandler.post { activity.launchRingtonePicker() }
    }

    @JavascriptInterface
    @Keep
    fun resetRingtone() {
        MainActivity.getRingtonePrefs(mContext).edit()
            .putBoolean(MainActivity.KEY_USE_CUSTOM_RINGTONE, false)
            .remove(MainActivity.KEY_RINGTONE_URI)
            .remove(MainActivity.KEY_RINGTONE_NAME)
            .apply()
        toast("Klingelton zurückgesetzt auf Standard")
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebViewScreen(modifier: Modifier = Modifier) {
    val act = LocalActivity.current as? MainActivity
    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { context ->
            WebView(context).apply {
                webViewClient = WebViewClient()
                webChromeClient = WebChromeClient()
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                val iface = if (act != null) WebAppInterface(context, act) else null
                if (iface != null) {
                    addJavascriptInterface(iface, "Android")
                    act!!.pendingWebView = this
                }
                loadUrl("file:///android_asset/index.html")
            }
        },
        update = { _ -> }
    )
}