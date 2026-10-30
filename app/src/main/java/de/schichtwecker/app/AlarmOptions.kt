package de.schichtwecker.app

import android.content.Context
import org.json.JSONObject

/**
 * Weck-Verhalten (Schlummerzeit, ansteigende Lautstärke, nur Vibration).
 * Liegt im gerätegeschützten Speicher, damit der AlarmService es auch vor dem ersten
 * Entsperren nach einem Neustart lesen kann (Direct Boot).
 */
object AlarmOptions {
    private const val PREFS = "alarm_options"
    private const val KEY_SNOOZE = "snooze_minutes"
    private const val KEY_RISING = "rising_volume"
    private const val KEY_VIBRATE_ONLY = "vibrate_only"

    val SNOOZE_CHOICES = listOf(3, 5, 10, 15, 20)
    private const val DEFAULT_SNOOZE = 5

    /** Zeit bis zur vollen Lautstärke bei ansteigendem Ton. */
    const val RISING_DURATION_MS = 60_000L

    private fun prefs(context: Context) = context.applicationContext
        .createDeviceProtectedStorageContext()
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun snoozeMinutes(context: Context): Int =
        prefs(context).getInt(KEY_SNOOZE, DEFAULT_SNOOZE).takeIf { it in SNOOZE_CHOICES } ?: DEFAULT_SNOOZE

    fun risingVolume(context: Context): Boolean = prefs(context).getBoolean(KEY_RISING, false)

    fun vibrateOnly(context: Context): Boolean = prefs(context).getBoolean(KEY_VIBRATE_ONLY, false)

    fun toJson(context: Context): String = JSONObject().apply {
        put("snoozeMinutes", snoozeMinutes(context))
        put("risingVolume", risingVolume(context))
        put("vibrateOnly", vibrateOnly(context))
    }.toString()

    /** Übernimmt nur gültige Werte; unbekannte oder fehlerhafte Felder bleiben unverändert. */
    fun fromJson(context: Context, json: String): Boolean = try {
        val o = JSONObject(json)
        val edit = prefs(context).edit()
        if (o.has("snoozeMinutes")) {
            val m = o.optInt("snoozeMinutes", -1)
            if (m in SNOOZE_CHOICES) edit.putInt(KEY_SNOOZE, m)
        }
        if (o.has("risingVolume")) edit.putBoolean(KEY_RISING, o.optBoolean("risingVolume"))
        if (o.has("vibrateOnly")) edit.putBoolean(KEY_VIBRATE_ONLY, o.optBoolean("vibrateOnly"))
        edit.commit()
    } catch (_: Exception) {
        false
    }
}
