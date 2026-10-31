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
import androidx.activity.OnBackPressedCallback
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
import de.schichtwecker.app.ui.theme.SchichtweckerTheme
import org.json.JSONObject
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
            val fileName = getFileNameFromUri(this, it) ?: I18n.t(this, "native.ringtone.customName")
            prefs.edit()
                .putString(KEY_RINGTONE_URI, it.toString())
                .putString(KEY_RINGTONE_NAME, fileName)
                .putBoolean(KEY_USE_CUSTOM_RINGTONE, true)
                .apply()
            Log.d("SchichtplanAlarm", "Klingelton gespeichert: $fileName ($it)")
            toast(I18n.t(this, "native.toast.ringtoneSet", "name" to fileName))
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

    /* ── Profil-Sicherung: JSON-Datei über den System-Dateidialog ── */
    private var pendingExportText: String? = null

    /** Schreibt den vorgemerkten Text in die vom Nutzer gewählte Datei. */
    private fun writePendingExport(uri: Uri?, successText: String) {
        val text = pendingExportText
        pendingExportText = null
        if (uri == null || text == null) return
        try {
            contentResolver.openOutputStream(uri, "wt")?.use { it.write(text.toByteArray(Charsets.UTF_8)) }
                ?: throw IllegalStateException("Kein Ausgabestrom")
            toast(successText)
        } catch (e: Exception) {
            Log.e("SchichtplanAlarm", "Datei speichern fehlgeschlagen", e)
            toast(I18n.t(this, "native.toast.fileSaveFailed"))
        }
    }

    // CreateDocument legt den MIME-Typ bei der Registrierung fest → ein Dialog je Dateiart
    private val profileSaver = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri: Uri? -> writePendingExport(uri, I18n.t(this, "native.toast.profileSaved")) }

    private val calendarSaver = registerForActivityResult(
        ActivityResultContracts.CreateDocument("text/calendar")
    ) { uri: Uri? -> writePendingExport(uri, I18n.t(this, "native.toast.calendarSaved")) }

    private val profileOpener = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        if (uri == null) return@registerForActivityResult
        // Profile sind wenige KB groß – alles über 1 MB ist keine Profil-Datei
        val text = readLimited(uri, 1_000_000)
        if (text == null) {
            toast(I18n.t(this, "native.toast.fileReadFailed"))
            return@registerForActivityResult
        }
        pendingWebView?.let { wv ->
            wv.post {
                wv.evaluateJavascript(
                    "if(typeof onProfileImported==='function')onProfileImported(${JSONObject.quote(text)});",
                    null
                )
            }
        }
    }

    /** Liest höchstens [maxBytes] aus der Datei; null bei Fehler oder zu großer Datei. */
    private fun readLimited(uri: Uri, maxBytes: Int): String? = try {
        contentResolver.openInputStream(uri)?.use { input ->
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(8192)
            while (out.size() <= maxBytes) {
                val n = input.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
            }
            if (out.size() > maxBytes) null else out.toString("UTF-8")
        }
    } catch (e: Exception) {
        Log.e("SchichtplanAlarm", "Datei lesen fehlgeschlagen", e)
        null
    }

    /* ── Eigene Sprachdatei: prüfen, speichern, Ergebnis per onLanguageImported(ok, name) ── */
    private val languageOpener = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri: Uri? ->
        // Abbrechen im Dialog = keine Rückmeldung (wie beim Profil-Import)
        if (uri == null) return@registerForActivityResult
        val name = readLimited(uri, I18n.MAX_FILE_BYTES)?.let { I18n.importCustom(this, it) }
        if (name == null) Log.w("SchichtplanAlarm", "Sprachdatei abgelehnt (kein gültiges Sprach-JSON)")
        pendingWebView?.let { wv ->
            wv.post {
                val js = if (name != null) "true,${JSONObject.quote(name)}" else "false,\"\""
                wv.evaluateJavascript(
                    "if(typeof onLanguageImported==='function')onLanguageImported($js);",
                    null
                )
            }
        }
    }

    fun launchLanguageImport() {
        try {
            languageOpener.launch(arrayOf("application/json", "text/plain", "*/*"))
        } catch (e: Exception) {
            Log.e("SchichtplanAlarm", "Öffnen-Dialog fehlgeschlagen", e)
            toast(I18n.t(this, "native.toast.fileDialogUnavailable"))
        }
    }

    fun launchExport(text: String, fileName: String, mimeType: String) {
        pendingExportText = text
        try {
            (if (mimeType == "text/calendar") calendarSaver else profileSaver).launch(fileName)
        } catch (e: Exception) {
            Log.e("SchichtplanAlarm", "Speichern-Dialog fehlgeschlagen", e)
            toast(I18n.t(this, "native.toast.fileDialogUnavailable"))
        }
    }

    fun launchProfileImport() {
        try {
            profileOpener.launch(arrayOf("application/json", "text/plain", "application/octet-stream"))
        } catch (e: Exception) {
            Log.e("SchichtplanAlarm", "Öffnen-Dialog fehlgeschlagen", e)
            toast(I18n.t(this, "native.toast.fileDialogUnavailable"))
        }
    }

    /**
     * Zurück-Geste: zuerst offene Dialoge/Sheets/Einstellungen der Web-Oberfläche schließen,
     * erst danach die App verlassen.
     */
    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            val wv = pendingWebView ?: return leaveViaBack()
            wv.evaluateJavascript("(window.handleBack&&window.handleBack())?'1':'0'") { result ->
                if (result?.contains("1") != true) leaveViaBack()
            }
        }
    }

    private fun leaveViaBack() {
        backCallback.isEnabled = false
        onBackPressedDispatcher.onBackPressed()
        backCallback.isEnabled = true
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, backCallback)
        enableEdgeToEdge()
        requestPermissions()
        setContent {
            SchichtweckerTheme {
                Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
                    WebViewScreen(
                        modifier = Modifier.padding(innerPadding)
                    )
                }
            }
        }
    }

    // WebView im Hintergrund anhalten (Rendering, Animationen) – spart Strom.
    // Wecker hängen nicht an der WebView, sondern am AlarmManager.
    override fun onPause() {
        super.onPause()
        pendingWebView?.onPause()
    }

    override fun onResume() {
        super.onResume()
        pendingWebView?.onResume()
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
                .setTitle(I18n.t(this, "native.fullscreen.title"))
                .setMessage(I18n.t(this, "native.fullscreen.message"))
                .setPositiveButton(I18n.t(this, "native.fullscreen.openSettings")) { _, _ ->
                    startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                        data = "package:$packageName".toUri()
                    })
                }
                .setNegativeButton(I18n.t(this, "native.fullscreen.later"), null)
                .show()
        }
    }

    fun launchRingtonePicker() {
        try {
            ringtonePicker.launch(arrayOf("audio/*"))
        } catch (e: Exception) {
            Log.e("SchichtplanAlarm", "Ringtone picker fehlgeschlagen", e)
            toast(I18n.t(this, "native.toast.filePickerUnavailable"))
        }
    }
}

@Keep
class WebAppInterface(private val mContext: Context, private val activity: MainActivity) {
    private companion object {
        const val STATE_PREFS = "app_state"
        const val STATE_KEY = "state"
        /** Erlaubte Lizenztexte (Kennung → Datei in assets). */
        val LICENSE_ASSETS = mapOf(
            "apache-2.0" to "licenses/apache-2.0.txt",
            "ofl-1.1" to "anime/fonts/OFL.txt",
            "polyform-nc-1.0.0" to "licenses/polyform-noncommercial-1.0.0.txt"
        )
        const val PRIVACY_POLICY_URL = "https://gamecard.github.io/schichtplan-wecker/datenschutz.html"
        /** Englische Fassung für alle Sprachen außer Deutsch. */
        const val PRIVACY_POLICY_URL_EN = "https://gamecard.github.io/schichtplan-wecker/privacy.html"
    }

    private fun tr(key: String, vararg args: Pair<String, Any?>) = I18n.t(mContext, key, *args)

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
        val time = String.format(Locale.ROOT, "%02d:%02d", hour, minute)
        val dayText = I18n.formatDate(
            mContext, "native.format.date",
            java.util.Calendar.getInstance().apply { clear(); set(year, month - 1, day) }
        )
        val ok = AlarmScheduler.schedule(mContext, alarmKey, year, month, day, hour, minute, message)
        if (!silent) {
            if (ok) {
                val millis = AlarmStore.get(mContext, alarmKey)?.millis ?: 0L
                val diffMin = (millis - System.currentTimeMillis()) / 60_000
                val diffText = if (diffMin < 60) I18n.plural(mContext, "native.duration.minutes", diffMin)
                else tr("native.duration.hoursMinutes", "h" to diffMin / 60, "m" to diffMin % 60)
                toast(tr("native.toast.alarmSet", "date" to dayText, "time" to time, "duration" to diffText))
            } else {
                toast(tr("native.toast.alarmFailed", "date" to dayText, "time" to time))
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

    /**
     * Speichert den App-Zustand SOFORT (commit, synchron). Der localStorage der WebView
     * schreibt verzögert – wird die App direkt nach einer Änderung beendet, ginge sie verloren.
     */
    @JavascriptInterface
    @Keep
    fun saveState(json: String): Boolean =
        mContext.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE)
            .edit().putString(STATE_KEY, json).commit()

    @JavascriptInterface
    @Keep
    fun loadState(): String =
        mContext.getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE).getString(STATE_KEY, "") ?: ""

    /**
     * Fehlende Berechtigung, die den Wecker beeinträchtigt: "exact" (keine exakten Wecker –
     * dank USE_EXACT_ALARM eigentlich ausgeschlossen, Absicherung), "fullscreen" (kein Vollbild
     * über dem Sperrbildschirm) oder "".
     */
    @JavascriptInterface
    @Keep
    fun getAlarmPermissionIssue(): String {
        if (!mContext.getSystemService(android.app.AlarmManager::class.java).canScheduleExactAlarms()
        ) return "exact"
        if (!mContext.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()
        ) return "fullscreen"
        return ""
    }

    /** Öffnet die passende Systemeinstellung zu [getAlarmPermissionIssue]. */
    @JavascriptInterface
    @Keep
    fun openAlarmPermissionSettings(issue: String) {
        val action = when {
            issue == "exact" ->
                Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM
            issue == "fullscreen" ->
                Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT
            else -> return
        }
        mainHandler.post {
            try {
                activity.startActivity(Intent(action).apply { data = "package:${mContext.packageName}".toUri() })
            } catch (e: Exception) {
                Log.e("SchichtplanAlarm", "Einstellungen nicht verfügbar", e)
            }
        }
    }

    /** Nach einem Sammel-Abgleich: frühesten Wecker scharf stellen, spätere zurückhalten. */
    @JavascriptInterface
    @Keep
    fun syncAlarmWindow(): Int = AlarmScheduler.ensureWindow(mContext)

    /** JSON-Array aller geplanten Wanduhr-Wecker mit Datum/Uhrzeit. */
    @JavascriptInterface
    @Keep
    fun getScheduledAlarms(): String = AlarmStore.entriesJson(mContext)

    /** Schichten der nächsten Tage für das Widget: {"YYYY-MM-DD": "Früh", …}. */
    @JavascriptInterface
    @Keep
    fun updateWidget(json: String) = ShiftWidget.saveShiftData(mContext, json)

    /** Weck-Verhalten als JSON: {snoozeMinutes, risingVolume, vibrateOnly}. */
    @JavascriptInterface
    @Keep
    fun getAlarmOptions(): String = AlarmOptions.toJson(mContext)

    @JavascriptInterface
    @Keep
    fun setAlarmOptions(json: String): Boolean = AlarmOptions.fromJson(mContext, json)

    /** Versionsname der installierten App, z. B. "1.3". */
    @JavascriptInterface
    @Keep
    fun getAppVersion(): String = try {
        mContext.packageManager.getPackageInfo(mContext.packageName, 0).versionName ?: ""
    } catch (_: Exception) { "" }

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
            tr("native.alarm.testMessage")
        )
        toast(if (ok) tr("native.toast.testAlarm") else tr("native.toast.testAlarmFailed"))
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

    /** Öffnet den Speichern-Dialog für eine Profil-Datei (JSON vom Web-Teil). */
    @JavascriptInterface
    @Keep
    fun exportProfile(json: String, fileName: String) {
        mainHandler.post { activity.launchExport(json, fileName, "application/json") }
    }

    /** Speichern-Dialog für eine Textdatei (z. B. .ics-Kalender). */
    @JavascriptInterface
    @Keep
    fun exportFile(content: String, fileName: String, mimeType: String) {
        mainHandler.post { activity.launchExport(content, fileName, mimeType) }
    }

    /** Öffnet den Datei-Dialog; das Ergebnis kommt per onProfileImported(text) zurück. */
    @JavascriptInterface
    @Keep
    fun importProfile() {
        mainHandler.post { activity.launchProfileImport() }
    }

    /**
     * Öffnet die Datenschutzerklärung im Browser (feste Adresse, kein Internet in der App nötig).
     * Deutsch → datenschutz.html, jede andere Sprache → englische Fassung privacy.html.
     */
    @JavascriptInterface
    @Keep
    fun openPrivacyPolicy() {
        val url = if (I18n.baseLanguage(mContext) == "de") PRIVACY_POLICY_URL else PRIVACY_POLICY_URL_EN
        mainHandler.post {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
            } catch (_: Exception) {
                toast(tr("native.toast.noBrowser", "url" to url))
            }
        }
    }

    /** Lizenztext für die Seite „Open-Source-Lizenzen“ – nur feste Kennungen, keine Pfade von außen. */
    @JavascriptInterface
    @Keep
    fun getLicenseText(id: String): String {
        val asset = LICENSE_ASSETS[id] ?: return ""
        return try {
            mContext.assets.open(asset).bufferedReader().use { it.readText() }
        } catch (_: Exception) {
            ""
        }
    }

    /* ── Sprache ── */

    /** JSON-Array `[{"code":"de","name":"Deutsch"}, …]`, plus `{"code":"custom",…}` nach einem Import. */
    @JavascriptInterface
    @Keep
    fun listLanguages(): String = I18n.listLanguagesJson(mContext)

    /** Inhalt der Sprachdatei (eingebaut oder "custom"); "" wenn unbekannt oder Code unzulässig. */
    @JavascriptInterface
    @Keep
    fun getLanguageFile(code: String): String = I18n.languageFile(mContext, code)

    /** "auto" (Systemsprache), "custom" oder ein Sprachcode. */
    @JavascriptInterface
    @Keep
    fun getLanguageSetting(): String = I18n.languageSetting(mContext)

    /** Speichert die Sprache; Benachrichtigungskanal und Widget folgen sofort. */
    @JavascriptInterface
    @Keep
    fun setLanguageSetting(code: String): Boolean = I18n.setLanguageSetting(mContext, code)

    /** Design der Oberfläche ("classic"/"anime") – der Wecker-Bildschirm folgt ihm. */
    @JavascriptInterface
    @Keep
    fun setDesign(design: String): Boolean = I18n.setDesign(mContext, design)

    /** Sprache des Systems, z. B. "de" (für „automatisch“). */
    @JavascriptInterface
    @Keep
    fun getSystemLanguage(): String = I18n.systemLanguage()

    /** Datei-Dialog für eine eigene Sprachdatei; Ergebnis per onLanguageImported(ok, name). */
    @JavascriptInterface
    @Keep
    fun importLanguageFile() {
        mainHandler.post { activity.launchLanguageImport() }
    }

    @JavascriptInterface
    @Keep
    fun resetRingtone() {
        MainActivity.getRingtonePrefs(mContext).edit()
            .putBoolean(MainActivity.KEY_USE_CUSTOM_RINGTONE, false)
            .remove(MainActivity.KEY_RINGTONE_URI)
            .remove(MainActivity.KEY_RINGTONE_NAME)
            .apply()
        toast(tr("native.toast.ringtoneReset"))
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