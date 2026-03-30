package com.mein.schichtplan

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.AlarmManager.AlarmClockInfo
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import com.mein.schichtplan.ui.theme.MyApplicationTheme
import java.util.Calendar
import java.util.Locale

class MainActivity : ComponentActivity() {

    private val notifPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        Log.d("SchichtplanAlarm", "POST_NOTIFICATIONS granted: $granted")
        checkExactAlarmPermission()
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

    private fun requestPermissions() {
        // POST_NOTIFICATIONS ist auf Android 13+ Pflicht
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            checkExactAlarmPermission()
        }
    }

    private fun checkExactAlarmPermission() {
        val alarmManager = getSystemService(ALARM_SERVICE) as AlarmManager
        if (!alarmManager.canScheduleExactAlarms()) {
            Log.w("SchichtplanAlarm", "SCHEDULE_EXACT_ALARM not granted – opening settings")
            startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                data = "package:$packageName".toUri()
            })
            return
        }

        checkFullScreenIntentPermission()
    }

    private fun checkFullScreenIntentPermission() {
        // USE_FULL_SCREEN_INTENT muss auf Android 14+ manuell erlaubt werden
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (!nm.canUseFullScreenIntent()) {
            Log.w("SchichtplanAlarm", "USE_FULL_SCREEN_INTENT not granted – opening settings")
            startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                data = "package:$packageName".toUri()
            })
        }
    }
}

@Keep
class WebAppInterface(private val mContext: Context) {
    private fun requestCodeFromKey(key: String): Int {
        return key.hashCode() and 0x7fffffff
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    private fun toast(text: String) {
        mainHandler.post { Toast.makeText(mContext, text, Toast.LENGTH_LONG).show() }
    }

    private fun openExactAlarmSettings() {
        runCatching {
            mContext.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                data = "package:${mContext.packageName}".toUri()
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
        }.onFailure {
            Log.e("SchichtplanAlarm", "Exact-Alarm-Einstellungen konnten nicht geöffnet werden", it)
        }
    }

    private fun scheduleAlarm(
        alarmTimeMillis: Long,
        requestCode: Int,
        toastText: String,
        message: String,
        silent: Boolean = false
    ): Boolean {
        val alarmManager = mContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        if (!alarmManager.canScheduleExactAlarms()) {
            Log.w("SchichtplanAlarm", "Exact alarms sind nicht erlaubt")
            if (!silent) toast("Bitte exakte Alarme fuer die App erlauben")
            openExactAlarmSettings()
            return false
        }

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
    fun setAlarm(hour: Int, minute: Int, message: String) {
        val calendar = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            // Falls die Zeit schon vergangen ist, plane für morgen
            if (timeInMillis <= System.currentTimeMillis()) {
                add(Calendar.DAY_OF_YEAR, 1)
            }
        }

        scheduleAlarm(
            alarmTimeMillis = calendar.timeInMillis,
            requestCode = requestCodeFromKey("legacy-${message}-${hour}-${minute}"),
            toastText = "Wecker gestellt für ${String.format(Locale.GERMAN, "%02d:%02d", hour, minute)}",
            message = message
        )
    }

    @JavascriptInterface
    @Keep
    fun setAlarmForDate(
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
        minute: Int,
        alarmKey: String,
        message: String
    ): Boolean {
        return setAlarmForDateInternal(year, month, day, hour, minute, alarmKey, message, silent = false)
    }

    @JavascriptInterface
    @Keep
    fun setAlarmForDateSilent(
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
        minute: Int,
        alarmKey: String,
        message: String
    ): Boolean {
        return setAlarmForDateInternal(year, month, day, hour, minute, alarmKey, message, silent = true)
    }

    private fun setAlarmForDateInternal(
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
        minute: Int,
        alarmKey: String,
        message: String,
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
            mContext,
            requestCode,
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        if (pendingIntent != null) {
            alarmManager.cancel(pendingIntent)
            pendingIntent.cancel()
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
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun WebViewScreen(modifier: Modifier = Modifier) {
    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { context ->
            WebView(context).apply {
                webViewClient = WebViewClient()
                webChromeClient = WebChromeClient()
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                addJavascriptInterface(WebAppInterface(context), "Android")
                loadUrl("file:///android_asset/index.html")
            }
        }
    )
}
