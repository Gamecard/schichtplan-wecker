package de.schichtwecker.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.AlarmManager.AlarmClockInfo
import android.app.NotificationManager
import android.app.PendingIntent
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
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.Keep
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import de.schichtwecker.app.ui.theme.MyApplicationTheme
import java.util.Calendar
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
            Log.w("SchichtplanAlarm", "USE_FULL_SCREEN_INTENT not granted – opening settings")
            startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                data = "package:$packageName".toUri()
            })
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
    private fun requestCodeFromKey(key: String): Int {
        return key.hashCode() and 0x7fffffff
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private fun toast(text: String) {
        mainHandler.post { Toast.makeText(mContext, text, Toast.LENGTH_LONG).show() }
    }

    private fun scheduleAlarm(
        alarmTimeMillis: Long,
        requestCode: Int,
        toastText: String,
        message: String,
        silent: Boolean = false
    ): Boolean {
        val alarmManager = mContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager

        val intent = Intent(mContext, AlarmReceiver::class.java).apply {
            putExtra("message", message)
            putExtra("requestCode", requestCode)
        }

        val pendingIntent = PendingIntent.getBroadcast(
            mContext,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val showIntent = PendingIntent.getActivity(
            mContext,
            requestCode,
            Intent(mContext, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        try {
            alarmManager.setAlarmClock(
                AlarmClockInfo(alarmTimeMillis, showIntent),
                pendingIntent
            )
            Log.d("SchichtplanAlarm", "Alarm geplant: $message um ${java.text.SimpleDateFormat("dd.MM.yyyy HH:mm", java.util.Locale.GERMAN).format(java.util.Date(alarmTimeMillis))}")
            if (!silent) toast(toastText)
            return true
        } catch (e: SecurityException) {
            Log.e("SchichtplanAlarm", "setAlarmClock fehlgeschlagen", e)
            if (!silent) toast("Fehler: Wecker konnte nicht geplant werden")
            return false
        }
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
        Log.d("SchichtplanAlarm", "setAlarmForDate aufgerufen: $day.$month.$year $hour:$minute key=$alarmKey silent=$silent")

        val calendar = Calendar.getInstance().apply {
            set(Calendar.YEAR, year)
            set(Calendar.MONTH, month - 1)
            set(Calendar.DAY_OF_MONTH, day)
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        val now = System.currentTimeMillis()
        val diff = calendar.timeInMillis - now
        Log.d("SchichtplanAlarm", "Alarm-Zeit: ${calendar.time}, Jetzt: ${java.util.Date(now)}, Differenz: ${diff/1000}s")

        if (diff <= 0) {
            Log.w("SchichtplanAlarm", "Zeit vorbei, Alarm nicht gesetzt")
            if (!silent) toast("Hinweis: ${String.format(Locale.GERMAN, "%02d:%02d", hour, minute)} Uhr am ${String.format(Locale.GERMAN, "%02d.%02d.%04d", day, month, year)} liegt in der Vergangenheit!")
            return false
        }

        val requestCode = requestCodeFromKey(alarmKey)
        val dayText = String.format(Locale.GERMAN, "%02d.%02d.%04d", day, month, year)
        val diffMin = diff / 60_000
        val diffText = if (diffMin < 60) "${diffMin} Min."
            else "${diffMin / 60} Std. ${diffMin % 60} Min."

        return scheduleAlarm(
            alarmTimeMillis = calendar.timeInMillis,
            requestCode = requestCode,
            toastText = "\u23F0 Wecker: $dayText ${String.format(Locale.GERMAN, "%02d:%02d", hour, minute)} (in $diffText)",
            message = message,
            silent = silent
        )
    }

    @JavascriptInterface
    @Keep
    fun cancelAlarm(alarmKey: String) {
        val alarmManager = mContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val requestCode = requestCodeFromKey(alarmKey)
        val intent = Intent(mContext, AlarmReceiver::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            mContext, requestCode, intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        if (pendingIntent != null) {
            alarmManager.cancel(pendingIntent)
            pendingIntent.cancel()
        }
        val snoozeRequestCode = 900000 + requestCode
        val snoozeIntent = Intent(mContext, AlarmReceiver::class.java)
        val snoozePi = PendingIntent.getBroadcast(
            mContext, snoozeRequestCode, snoozeIntent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        if (snoozePi != null) {
            alarmManager.cancel(snoozePi)
            snoozePi.cancel()
            toast("Wecker + Schlummern gelöscht")
        } else if (pendingIntent != null) {
            toast("Wecker gelöscht")
        } else {
            toast("Kein aktiver Wecker gefunden")
        }
    }

    @JavascriptInterface
    @Keep
    fun testAlarm() {
        Log.d("SchichtplanAlarm", "testAlarm() aufgerufen – Alarm in 15 Sekunden")
        val alarmTimeMillis = System.currentTimeMillis() + 15_000L
        scheduleAlarm(
            alarmTimeMillis = alarmTimeMillis,
            requestCode = 777777,
            toastText = "⏰ TEST-Wecker in 15 Sekunden!",
            message = "TEST – Der Wecker funktioniert!"
        )
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
    val act = LocalContext.current as? MainActivity
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