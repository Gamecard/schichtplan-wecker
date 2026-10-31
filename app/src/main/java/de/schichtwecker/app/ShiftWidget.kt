package de.schichtwecker.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Startbildschirm-Widget: heutige und morgige Schicht + nächster Wecker.
 *
 * Die Schichten liefert die Web-Oberfläche bei jedem Speichern ([saveShiftData]), der nächste
 * Wecker kommt direkt aus dem [AlarmStore]. Aktualisiert wird nur bei Änderungen und einmal um
 * Mitternacht per nicht weckendem Alarm – das Widget weckt das Handy nie auf.
 */
class ShiftWidget : AppWidgetProvider() {

    companion object {
        private const val TAG = "SchichtplanAlarm"
        private const val PREFS = "widget"
        private const val KEY_DAYS = "days"
        const val ACTION_MIDNIGHT = "de.schichtwecker.app.action.WIDGET_MIDNIGHT"

        private fun prefs(context: Context) = context.applicationContext
            .createDeviceProtectedStorageContext()
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        /** JSON {"YYYY-MM-DD": "Früh", …} für die nächsten Tage; aktualisiert das Widget. */
        fun saveShiftData(context: Context, json: String) {
            try {
                JSONObject(json) // nur gültiges JSON übernehmen
                prefs(context).edit().putString(KEY_DAYS, json).apply()
            } catch (e: Exception) {
                Log.w(TAG, "Widget-Daten ungültig", e)
                return
            }
            refresh(context)
        }

        /** Alle Widgets neu zeichnen – nur wenn überhaupt eines auf dem Startbildschirm liegt. */
        fun refresh(context: Context) {
            val app = context.applicationContext
            val mgr = AppWidgetManager.getInstance(app) ?: return
            val ids = mgr.getAppWidgetIds(ComponentName(app, ShiftWidget::class.java))
            if (ids.isEmpty()) return
            val views = buildViews(app)
            ids.forEach { mgr.updateAppWidget(it, views) }
            scheduleMidnight(app)
        }

        private fun dayKey(offsetDays: Int): String {
            val c = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, offsetDays) }
            return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.time)
        }

        private fun buildViews(context: Context): RemoteViews {
            val days = try { JSONObject(prefs(context).getString(KEY_DAYS, "{}")!!) } catch (_: Exception) { JSONObject() }
            fun shift(offset: Int) = days.optString(dayKey(offset)).ifEmpty { "–" }.let { localizedName(context, it) }

            val views = RemoteViews(context.packageName, R.layout.widget_shift)
            views.setTextViewText(R.id.widget_today, I18n.t(context, "native.widget.today", "shift" to shift(0)))
            views.setTextViewText(R.id.widget_tomorrow, I18n.t(context, "native.widget.tomorrow", "shift" to shift(1)))
            views.setTextViewText(R.id.widget_alarm, nextAlarmText(context))

            val open = PendingIntent.getActivity(
                context, 0, Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_root, open)
            return views
        }

        private fun nextAlarmText(context: Context): String {
            val now = System.currentTimeMillis()
            val next = AlarmStore.all(context)
                .filter { it.millis > now && it.key != "test-alarm" }
                .minByOrNull { it.millis } ?: return I18n.t(context, "native.widget.noAlarm")
            val target = Calendar.getInstance().apply { timeInMillis = next.millis }
            val today = Calendar.getInstance()
            val dayDiff = ((startOfDay(target) - startOfDay(today)) / 86_400_000L).toInt()
            val day = when (dayDiff) {
                0 -> I18n.t(context, "native.widget.dayToday")
                1 -> I18n.t(context, "native.widget.dayTomorrow")
                else -> I18n.formatDate(context, "native.widget.date", target)
            }
            val time = SimpleDateFormat("HH:mm", Locale.ROOT).format(Date(next.millis))
            // Nachricht ist z. B. "Früh (02.11.2026)" – nur den Namen zeigen
            val name = next.message.substringBefore(" (").ifEmpty { I18n.t(context, "native.widget.alarmName") }
            return I18n.t(context, "native.widget.nextAlarm", "day" to day, "time" to time, "name" to localizedName(context, name))
        }

        /**
         * Die Web-Oberfläche liefert Schichtnamen als Text (bisher deutsch: "Früh", "Urlaub" …).
         * Bekannte Namen werden in der App-Sprache angezeigt – so stimmt das Widget auch direkt
         * nach einem Sprachwechsel, bevor die Oberfläche neue Daten schickt. Unbekannte Namen
         * (schon übersetzt oder eigene) bleiben, wie sie sind.
         */
        private fun localizedName(context: Context, name: String): String {
            val key = when (name) {
                "Frei", "1" -> "shift.1"
                "Fr\u00FCh", "2" -> "shift.2"
                "Sp\u00E4t", "3" -> "shift.3"
                "Nacht", "4" -> "shift.4"
                "kein Eintrag" -> "native.widget.noEntry"
                "Urlaub" -> "native.exception.vacation"
                "Krank" -> "native.exception.sick"
                "Schulung" -> "native.exception.training"
                else -> return name
            }
            return I18n.tOrNull(context, key) ?: name
        }

        private fun startOfDay(c: Calendar): Long = (c.clone() as Calendar).apply {
            set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }.timeInMillis

        private fun midnightIntent(context: Context) = PendingIntent.getBroadcast(
            context, 0,
            Intent(context, ShiftWidget::class.java).setAction(ACTION_MIDNIGHT),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        /** Nicht weckender Alarm kurz nach Mitternacht: wird erst ausgeliefert, wenn das Handy ohnehin wach ist. */
        private fun scheduleMidnight(context: Context) {
            val c = Calendar.getInstance().apply {
                add(Calendar.DAY_OF_YEAR, 1)
                set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 5); set(Calendar.MILLISECOND, 0)
            }
            context.getSystemService(AlarmManager::class.java)
                .set(AlarmManager.RTC, c.timeInMillis, midnightIntent(context))
        }
    }

    override fun onUpdate(context: Context, mgr: AppWidgetManager, appWidgetIds: IntArray) {
        refresh(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_MIDNIGHT) refresh(context)
    }

    override fun onDisabled(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(midnightIntent(context))
    }
}
