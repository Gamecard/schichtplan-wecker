package de.schichtwecker.app

import android.app.Activity
import android.app.ActivityManager
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import androidx.core.net.toUri
import org.json.JSONObject

/**
 * Zuverlässigkeits-Check: Systemeinstellungen, die Wecker verhindern oder verzögern können
 * (Benachrichtigungen, exakte Wecker, Vollbild, Akku-Einschränkungen, Energiesparmodus).
 *
 * Eine Quelle für alle Prüfungen – `getAlarmPermissionIssue`, der Vollbild-Dialog beim Start
 * und `getReliabilityStatus` (Karte „Zuverlässigkeit“ im Bereich Wecker) lesen von hier.
 *
 * Nicht prüfbar: der EXTREME Energiesparmodus (Pixel u. a.) – er pausiert alle Apps außer den
 * vom Nutzer gewählten „wichtigen Apps“. Das kann die App weder erkennen noch umgehen; die
 * Oberfläche zeigt dazu einen festen Hinweis.
 */
object Reliability {

    /** Standby-Gruppe als Name; 5 (EXEMPTED) und 50 (NEVER) sind im SDK versteckt. */
    fun bucketName(bucket: Int): String = when (bucket) {
        5 -> "exempted"
        UsageStatsManager.STANDBY_BUCKET_ACTIVE -> "active"
        UsageStatsManager.STANDBY_BUCKET_WORKING_SET -> "working_set"
        UsageStatsManager.STANDBY_BUCKET_FREQUENT -> "frequent"
        UsageStatsManager.STANDBY_BUCKET_RARE -> "rare"
        UsageStatsManager.STANDBY_BUCKET_RESTRICTED -> "restricted"
        50 -> "never"
        else -> "unknown"
    }

    fun canScheduleExactAlarms(context: Context): Boolean =
        context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    fun canUseFullScreenIntent(context: Context): Boolean =
        context.getSystemService(NotificationManager::class.java).canUseFullScreenIntent()

    /** Benachrichtigungen der App insgesamt an (ab 13 = POST_NOTIFICATIONS erteilt). */
    fun appNotificationsEnabled(context: Context): Boolean =
        context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    /** Wecker-Kanal nicht auf „aus“ (IMPORTANCE_NONE). Fehlt er noch, legt die App ihn beim ersten Wecker an. */
    fun alarmChannelEnabled(context: Context): Boolean {
        val ch = context.getSystemService(NotificationManager::class.java)
            .getNotificationChannel(AlarmReceiver.CHANNEL_ID) ?: return true
        return ch.importance != NotificationManager.IMPORTANCE_NONE
    }

    /**
     * Fehlende Berechtigung für den roten Hinweis über dem Kalender: "exact", "fullscreen" oder "".
     * (Älteres Format, bleibt für `getAlarmPermissionIssue` erhalten.)
     */
    fun alarmPermissionIssue(context: Context): String = when {
        !canScheduleExactAlarms(context) -> "exact"
        !canUseFullScreenIntent(context) -> "fullscreen"
        else -> ""
    }

    /**
     * Alle Prüfpunkte als JSON. Schlägt eine einzelne Abfrage fehl, fehlt nur dieser Schlüssel
     * (die Oberfläche blendet den Punkt dann aus) – nie eine Ausnahme nach außen.
     */
    fun statusJson(context: Context): String {
        val o = JSONObject()
        fun put(key: String, value: () -> Any) {
            try { o.put(key, value()) } catch (e: Exception) {
                Log.w("SchichtplanAlarm", "Zuverlässigkeit: $key nicht lesbar", e)
            }
        }
        val pm = context.getSystemService(PowerManager::class.java)
        put("powerSave") { pm.isPowerSaveMode }
        put("ignoringBatteryOptimizations") { pm.isIgnoringBatteryOptimizations(context.packageName) }
        put("backgroundRestricted") { context.getSystemService(ActivityManager::class.java).isBackgroundRestricted }
        try {
            val bucket = context.getSystemService(UsageStatsManager::class.java).appStandbyBucket
            o.put("standbyBucket", bucket)
            o.put("standbyBucketName", bucketName(bucket))
        } catch (e: Exception) {
            Log.w("SchichtplanAlarm", "Zuverlässigkeit: Standby-Gruppe nicht lesbar", e)
        }
        put("canScheduleExactAlarms") { canScheduleExactAlarms(context) }
        var app: Boolean? = null
        var channel: Boolean? = null
        put("appNotificationsEnabled") { appNotificationsEnabled(context).also { app = it } }
        put("alarmChannelEnabled") { alarmChannelEnabled(context).also { channel = it } }
        if (app != null && channel != null) o.put("notificationsEnabled", app == true && channel == true)
        put("fullScreenIntentAllowed") { canUseFullScreenIntent(context) }
        return o.toString()
    }

    /**
     * Öffnet die Systemseite zu [target] (feste Liste, siehe [ReliabilityTargets]). Probiert die
     * Kandidaten der Reihe nach, zuletzt die App-Details. Unbekanntes Ziel → false, nichts passiert.
     * Muss auf dem Hauptthread laufen.
     */
    fun open(activity: Activity, target: String): Boolean {
        val channelOnly = target == "notifications" &&
            runCatching { appNotificationsEnabled(activity) && !alarmChannelEnabled(activity) }.getOrDefault(false)
        for (step in ReliabilityTargets.steps(target, channelOnly)) {
            val intent = Intent(step.action)
            if (step.packageData) intent.data = "package:${activity.packageName}".toUri()
            if (step.packageExtra) intent.putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
            if (step.channelExtra) intent.putExtra(Settings.EXTRA_CHANNEL_ID, AlarmReceiver.CHANNEL_ID)
            try {
                activity.startActivity(intent)
                return true
            } catch (e: Exception) {
                // ActivityNotFoundException (Hersteller ohne diese Seite) oder SecurityException
                Log.w("SchichtplanAlarm", "Einstellungsseite ${step.action} nicht verfügbar", e)
            }
        }
        return false
    }
}

/**
 * Feste Ziel-Liste für `openSystemSettings` (ohne Android-Klassen außer Konstanten → JVM-Test).
 * KEIN ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: braucht die gleichnamige Berechtigung, die
 * Google Play nur sehr eingeschränkt erlaubt. Stattdessen die Übersichtsseite der Akku-Optimierung.
 */
object ReliabilityTargets {

    /** Eine Einstellungsseite: Action + ob `package:<id>` als Data bzw. Paket/Kanal als Extra dazugehört. */
    data class Step(
        val action: String,
        val packageData: Boolean = false,
        val packageExtra: Boolean = false,
        val channelExtra: Boolean = false
    )

    val TARGETS = setOf("battery_saver", "app_battery", "battery_optimization", "notifications", "full_screen", "exact_alarm")

    /** Seite „Akkunutzung der App“ (Nicht eingeschränkt/Optimiert/Eingeschränkt) – im SDK versteckt. */
    const val ACTION_APP_BATTERY_USAGE = "android.settings.VIEW_ADVANCED_POWER_USAGE_DETAIL"

    /** Altes Format von `openAlarmPermissionSettings` → Ziel. */
    fun fromPermissionIssue(issue: String): String? = when (issue) {
        "exact" -> "exact_alarm"
        "fullscreen" -> "full_screen"
        else -> null
    }

    private val APP_DETAILS = Step(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageData = true)
    private val APP_NOTIFICATIONS = Step(Settings.ACTION_APP_NOTIFICATION_SETTINGS, packageExtra = true)

    /**
     * Kandidaten für [target] in dieser Reihenfolge, letzter Rückfall immer die App-Details.
     * [channelOnly] = App-Benachrichtigungen an, nur der Wecker-Kanal aus → direkt die Kanal-Seite.
     * Unbekanntes Ziel → leere Liste.
     */
    fun steps(target: String, channelOnly: Boolean = false): List<Step> = when (target) {
        "battery_saver" -> listOf(
            Step(Settings.ACTION_BATTERY_SAVER_SETTINGS),
            Step(Intent.ACTION_POWER_USAGE_SUMMARY),
            APP_DETAILS
        )
        "app_battery" -> listOf(
            Step(ACTION_APP_BATTERY_USAGE, packageData = true),
            APP_DETAILS
        )
        "battery_optimization" -> listOf(
            Step(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            Step(ACTION_APP_BATTERY_USAGE, packageData = true),
            APP_DETAILS
        )
        "notifications" -> (if (channelOnly) listOf(
            Step(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, packageExtra = true, channelExtra = true)
        ) else emptyList()) + listOf(APP_NOTIFICATIONS, APP_DETAILS)
        "full_screen" -> listOf(
            Step(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, packageData = true),
            APP_DETAILS
        )
        "exact_alarm" -> listOf(
            Step(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, packageData = true),
            APP_DETAILS
        )
        else -> emptyList()
    }
}
