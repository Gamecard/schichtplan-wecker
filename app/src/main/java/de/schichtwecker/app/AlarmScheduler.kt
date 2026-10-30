package de.schichtwecker.app

import android.app.AlarmManager
import android.app.AlarmManager.AlarmClockInfo
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Zentrale Stelle für alle Wecker.
 *
 * Jeder geplante Wecker wird zusätzlich in SharedPreferences gespeichert ([AlarmStore]),
 * damit er nach Neustart, App-Update oder Zeitzonenwechsel neu eingeplant werden kann
 * ([rescheduleAll], aufgerufen vom [BootReceiver]). Der WebView-`localStorage` ist dafür
 * ungeeignet, weil nativer Code ihn nicht lesen kann.
 */
object AlarmScheduler {
    private const val TAG = "SchichtplanAlarm"
    const val EXTRA_KEY = "alarmKey"
    const val EXTRA_MESSAGE = "message"
    const val EXTRA_REQUEST_CODE = "requestCode"
    const val SNOOZE_SUFFIX = "#snooze"

    fun snoozeKeyOf(key: String): String =
        if (key.endsWith(SNOOZE_SUFFIX)) key else key + SNOOZE_SUFFIX

    /** Wecker zur Wanduhrzeit (bleibt bei Zeitzonenwechsel auf derselben Uhrzeit). */
    fun schedule(
        context: Context, key: String,
        year: Int, month: Int, day: Int, hour: Int, minute: Int,
        message: String
    ): Boolean {
        val millis = wallClockMillis(year, month, day, hour, minute)
        val entry = AlarmStore.Entry(
            key = key, message = message, millis = millis,
            year = year, month = month, day = day, hour = hour, minute = minute,
            requestCode = AlarmStore.requestCodeFor(context, key)
        )
        return place(context, entry)
    }

    /** Wecker zu einem festen Zeitpunkt (Schlummern, Test-Alarm). */
    fun scheduleAt(context: Context, key: String, millis: Long, message: String): Boolean {
        val entry = AlarmStore.Entry(
            key = key, message = message, millis = millis,
            requestCode = AlarmStore.requestCodeFor(context, key)
        )
        return place(context, entry)
    }

    /**
     * Android erlaubt höchstens 500 gleichzeitige Wecker pro App. Gespeichert werden alle,
     * beim AlarmManager „scharf“ sind nur die frühesten [MAX_ARMED]. Das Fenster rückt nach,
     * wenn ein Wecker auslöst, gelöscht wird, nach Neustart und nach Änderungen ([ensureWindow]).
     */
    const val MAX_ARMED = 350

    private fun futureSorted(context: Context, exceptKey: String? = null): List<AlarmStore.Entry> {
        val now = System.currentTimeMillis()
        return AlarmStore.all(context).filter { it.millis > now && it.key != exceptKey }.sortedBy { it.millis }
    }

    /** Speichert [entry] und stellt ihn scharf, wenn er zu den frühesten [MAX_ARMED] gehört. */
    private fun place(context: Context, entry: AlarmStore.Entry): Boolean {
        if (entry.millis <= System.currentTimeMillis()) {
            Log.w(TAG, "Zeit vorbei, Alarm nicht gesetzt: ${entry.key}")
            return false
        }
        val others = futureSorted(context, exceptKey = entry.key)
        val cutoff = others.getOrNull(MAX_ARMED - 1)
        val wasArmed = isArmed(context, entry.requestCode)
        if (cutoff == null || entry.millis < cutoff.millis) {
            if (!setSystemAlarm(context, entry)) return false
            // neu im Fenster → der bisher letzte scharfe Wecker fällt heraus
            if (cutoff != null && !wasArmed) cancelRequestCode(context, cutoff.requestCode)
        } else if (wasArmed && cancelRequestCode(context, entry.requestCode)) {
            // war scharf, liegt jetzt außerhalb → der nächste rückt ins Fenster
            setSystemAlarm(context, others[MAX_ARMED - 1])
        }
        AlarmStore.put(context, entry)
        return true
    }

    private fun setSystemAlarm(context: Context, entry: AlarmStore.Entry): Boolean {
        val alarmManager = context.getSystemService(AlarmManager::class.java)
        return try {
            alarmManager.setAlarmClock(
                AlarmClockInfo(entry.millis, showIntent(context, entry.requestCode)),
                firePendingIntent(context, entry)
            )
            Log.d(TAG, "Alarm geplant: ${entry.key} (rc=${entry.requestCode}) um ${java.util.Date(entry.millis)}")
            true
        } catch (e: Exception) {
            // SecurityException, aber auch IllegalStateException (Limit von 500 Weckern pro App)
            Log.e(TAG, "setAlarmClock fehlgeschlagen für ${entry.key}", e)
            false
        }
    }

    private fun isArmed(context: Context, requestCode: Int): Boolean = PendingIntent.getBroadcast(
        context, requestCode, Intent(context, AlarmReceiver::class.java),
        PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
    ) != null

    /** Stellt den Sollzustand her: die frühesten [MAX_ARMED] scharf, alle späteren nicht. */
    fun ensureWindow(context: Context): Int {
        var armed = 0
        futureSorted(context).forEachIndexed { i, e ->
            if (i < MAX_ARMED) {
                if (isArmed(context, e.requestCode) || setSystemAlarm(context, e)) armed++
            } else {
                cancelRequestCode(context, e.requestCode)
            }
        }
        return armed
    }

    /** Nach dem Entfernen eines scharfen Weckers den nächsten ins Fenster holen. */
    private fun refillWindow(context: Context) {
        val next = futureSorted(context).getOrNull(MAX_ARMED - 1) ?: return
        if (!isArmed(context, next.requestCode)) setSystemAlarm(context, next)
    }

    /** Löscht den Wecker und einen evtl. laufenden Schlummer-Wecker. true = es gab etwas zu löschen. */
    fun cancel(context: Context, key: String): Boolean {
        var found = cancelSingle(context, key)
        if (!key.endsWith(SNOOZE_SUFFIX)) {
            found = cancelSingle(context, snoozeKeyOf(key)) || found
            // Schlummer-Wecker aus Versionen vor dem AlarmStore: requestCode 900000 + hashCode
            found = cancelRequestCode(context, 900000 + (key.hashCode() and 0x7fffffff)) || found
        }
        return found
    }

    fun cancelAll(context: Context): Int {
        val keys = AlarmStore.all(context).map { it.key }
        keys.forEach { cancelSingle(context, it) }
        return keys.size
    }

    private fun cancelSingle(context: Context, key: String): Boolean {
        val stored = AlarmStore.get(context, key)
        val rc = stored?.requestCode ?: legacyRequestCode(key)
        val found = cancelRequestCode(context, rc)
        AlarmStore.remove(context, key)
        if (found) refillWindow(context)
        return found || stored != null
    }

    private fun cancelRequestCode(context: Context, requestCode: Int): Boolean {
        val pi = PendingIntent.getBroadcast(
            context, requestCode, Intent(context, AlarmReceiver::class.java),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        ) ?: return false
        context.getSystemService(AlarmManager::class.java).cancel(pi)
        pi.cancel()
        return true
    }

    /** Wecker hat ausgelöst – aus dem Speicher entfernen (einmalige Wecker). */
    fun onFired(context: Context, key: String?) {
        if (key != null) {
            AlarmStore.remove(context, key)
            refillWindow(context)
        }
    }

    /**
     * Plant alle gespeicherten Wecker neu ein (nach Neustart, App-Update, Zeit-/Zeitzonenwechsel).
     * Wanduhr-Wecker werden in der aktuellen Zeitzone neu berechnet. Wecker in der
     * Vergangenheit (Gerät war zur Weckzeit aus) werden verworfen.
     */
    fun rescheduleAll(context: Context): Int {
        val started = System.currentTimeMillis()
        // Store nur einmal am Ende schreiben – bei Hunderten Weckern läuft das im
        // BootReceiver, der nur wenige Sekunden Zeit hat.
        val now = System.currentTimeMillis()
        val kept = AlarmStore.all(context).mapNotNull { e ->
            val millis = if (e.isWallClock)
                wallClockMillis(e.year, e.month, e.day, e.hour, e.minute) else e.millis
            if (millis <= now) {
                Log.w(TAG, "Verpasster Wecker verworfen: ${e.key}")
                null
            } else e.copy(millis = millis)
        }.sortedBy { it.millis }
        // Zeiten können sich geändert haben (Zeitzone) → Fenster immer neu setzen
        kept.forEachIndexed { i, e ->
            if (i < MAX_ARMED) setSystemAlarm(context, e) else cancelRequestCode(context, e.requestCode)
        }
        AlarmStore.replaceAll(context, kept)
        Log.d(TAG, "rescheduleAll: ${kept.size} Wecker neu eingeplant in ${System.currentTimeMillis() - started} ms")
        return kept.size
    }

    fun legacyRequestCode(key: String): Int = key.hashCode() and 0x7fffffff

    private fun wallClockMillis(year: Int, month: Int, day: Int, hour: Int, minute: Int): Long =
        Calendar.getInstance().apply {
            clear()
            set(year, month - 1, day, hour, minute, 0)
        }.timeInMillis

    private fun firePendingIntent(context: Context, e: AlarmStore.Entry): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            putExtra(EXTRA_KEY, e.key)
            putExtra(EXTRA_MESSAGE, e.message)
            putExtra(EXTRA_REQUEST_CODE, e.requestCode)
        }
        return PendingIntent.getBroadcast(
            context, e.requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun showIntent(context: Context, requestCode: Int): PendingIntent =
        PendingIntent.getActivity(
            context, requestCode, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
}

/** Persistente Liste aller geplanten Wecker (SharedPreferences, JSON). */
object AlarmStore {
    private const val PREFS = "alarm_store"
    private const val KEY_ALARMS = "alarms"
    private const val KEY_MIGRATED = "migrated_v1"

    data class Entry(
        val key: String,
        val message: String,
        val millis: Long,
        val year: Int = 0, val month: Int = 0, val day: Int = 0,
        val hour: Int = 0, val minute: Int = 0,
        val requestCode: Int
    ) {
        val isWallClock get() = year > 0

        fun toJson() = JSONObject().apply {
            put("message", message); put("millis", millis); put("rc", requestCode)
            if (isWallClock) {
                put("y", year); put("mo", month); put("d", day); put("h", hour); put("mi", minute)
            }
        }

        companion object {
            fun fromJson(key: String, o: JSONObject) = Entry(
                key = key, message = o.optString("message"), millis = o.optLong("millis"),
                year = o.optInt("y"), month = o.optInt("mo"), day = o.optInt("d"),
                hour = o.optInt("h"), minute = o.optInt("mi"), requestCode = o.optInt("rc")
            )
        }
    }

    /**
     * Gerätegeschützter Speicher (Direct Boot): lesbar schon vor dem ersten Entsperren
     * nach einem Neustart – sonst klingelt nach einem nächtlichen Update-Neustart nichts,
     * bis das Handy entsperrt wird.
     */
    private fun prefs(context: Context): android.content.SharedPreferences {
        val app = context.applicationContext
        val device = app.createDeviceProtectedStorageContext()
        migrateToDeviceStorage(app, device)
        return device.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    @Volatile private var migrationChecked = false

    /** Einmalig: Liste aus dem alten (erst nach Entsperren lesbaren) Speicher übernehmen. */
    private fun migrateToDeviceStorage(app: Context, device: Context) {
        if (migrationChecked) return
        if (!app.getSystemService(android.os.UserManager::class.java).isUserUnlocked) return
        try {
            val old = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (old.contains(KEY_ALARMS) &&
                !device.getSharedPreferences(PREFS, Context.MODE_PRIVATE).contains(KEY_ALARMS)
            ) {
                device.moveSharedPreferencesFrom(app, PREFS)
            }
        } catch (e: Exception) {
            android.util.Log.e("SchichtplanAlarm", "AlarmStore-Migration fehlgeschlagen", e)
        }
        migrationChecked = true
    }

    private fun load(context: Context): JSONObject =
        try { JSONObject(prefs(context).getString(KEY_ALARMS, "{}")!!) } catch (_: Exception) { JSONObject() }

    @Synchronized
    fun put(context: Context, e: Entry) {
        val all = load(context)
        all.put(e.key, e.toJson())
        prefs(context).edit().putString(KEY_ALARMS, all.toString()).apply()
    }

    @Synchronized
    fun replaceAll(context: Context, entries: List<Entry>) {
        val all = JSONObject()
        entries.forEach { all.put(it.key, it.toJson()) }
        prefs(context).edit().putString(KEY_ALARMS, all.toString()).apply()
    }

    @Synchronized
    fun remove(context: Context, key: String) {
        val all = load(context)
        if (all.remove(key) != null) prefs(context).edit().putString(KEY_ALARMS, all.toString()).apply()
    }

    @Synchronized
    fun get(context: Context, key: String): Entry? =
        load(context).optJSONObject(key)?.let { Entry.fromJson(key, it) }

    @Synchronized
    fun all(context: Context): List<Entry> {
        val o = load(context)
        return o.keys().asSequence().mapNotNull { k -> o.optJSONObject(k)?.let { Entry.fromJson(k, it) } }.toList()
    }

    fun keysJson(context: Context): String = JSONArray(all(context).map { it.key }).toString()

    /** Alle Wanduhr-Wecker mit Datum/Uhrzeit (für den Abgleich mit der Web-Oberfläche). */
    fun entriesJson(context: Context): String = JSONArray(all(context).filter { it.isWallClock }.map { e ->
        JSONObject().apply {
            put("key", e.key); put("message", e.message)
            put("y", e.year); put("mo", e.month); put("d", e.day); put("h", e.hour); put("mi", e.minute)
        }
    }).toString()

    /**
     * requestCode für einen Schlüssel: vorhandener Wert, sonst hashCode (identisch zu älteren
     * Versionen → bestehende PendingIntents werden ersetzt statt verdoppelt). Bei einer
     * Kollision mit einem anderen Schlüssel wird weitergezählt.
     */
    @Synchronized
    fun requestCodeFor(context: Context, key: String): Int {
        get(context, key)?.let { return it.requestCode }
        val used = all(context).map { it.requestCode }.toHashSet()
        var rc = AlarmScheduler.legacyRequestCode(key)
        while (rc in used || rc == 0) rc = (rc + 1) and 0x7fffffff
        return rc
    }

    fun isMigrated(context: Context) = prefs(context).getBoolean(KEY_MIGRATED, false)
    fun setMigrated(context: Context) = prefs(context).edit().putBoolean(KEY_MIGRATED, true).apply()
}
