package de.schichtwecker.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.RingtoneManager
import android.net.Uri
import android.util.Log
import androidx.core.app.NotificationCompat

class AlarmReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SchichtplanAlarm"
        const val CHANNEL_ID = "schichtplan_alarm_v4"

        fun getAlarmSoundUri(context: Context): Uri {
            // Vor dem ersten Entsperren sind eigene Einstellungen und Dateien nicht lesbar
            // → Standard-Weckton
            val unlocked = context.getSystemService(android.os.UserManager::class.java).isUserUnlocked
            if (unlocked && MainActivity.usesCustomRingtone(context)) {
                val custom = MainActivity.getCustomRingtoneUri(context)
                if (!custom.isNullOrEmpty()) {
                    try {
                        val parsed = Uri.parse(custom)
                        context.contentResolver.openInputStream(parsed)?.close()
                        return parsed
                    } catch (e: Exception) {
                        Log.w(TAG, "Eigener Klingelton nicht lesbar, falle auf Standard zurück", e)
                    }
                }
            }
            return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        }

        /**
         * Ein einziger Kanal OHNE Sound/Vibration: den Ton spielt [AlarmService] selbst
         * (looping MediaPlayer) – sonst doppelter Alarm-Ton.
         */
        fun ensureNotificationChannel(context: Context) {
            val nm = context.getSystemService(NotificationManager::class.java)
            listOf("alarm_channel", "schichtplan_alarm_v2", "schichtplan_alarm_v3", "schichtplan_alarm_custom")
                .forEach { nm.deleteNotificationChannel(it) }
            if (nm.getNotificationChannel(CHANNEL_ID) != null) return
            val channel = NotificationChannel(
                CHANNEL_ID, "Schichtplan Wecker", NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Wecker bei Schichtbeginn"
                setSound(null, null)
                enableVibration(false)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }
            nm.createNotificationChannel(channel)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val key = intent.getStringExtra(AlarmScheduler.EXTRA_KEY)
        val message = intent.getStringExtra(AlarmScheduler.EXTRA_MESSAGE) ?: "Zeit aufzustehen!"
        val requestCode = intent.getIntExtra(AlarmScheduler.EXTRA_REQUEST_CODE, 0)
        Log.d(TAG, "AlarmReceiver.onReceive() key=$key rc=$requestCode")

        AlarmScheduler.onFired(context, key)
        ShiftWidget.refresh(context)

        // Der Ton läuft im Foreground-Service: unabhängig davon, ob die Activity sichtbar ist,
        // ob Android den Activity-Start aus dem Hintergrund zulässt oder ob der Nutzer die
        // Ein/Aus-Taste drückt. setAlarmClock()-Wecker dürfen einen FGS aus dem Hintergrund starten.
        try {
            context.startForegroundService(
                AlarmService.startIntent(context, key ?: "legacy-$requestCode", message, requestCode)
            )
        } catch (e: Exception) {
            Log.e(TAG, "AlarmService konnte nicht gestartet werden – Fallback auf Activity", e)
            fallback(context, message, requestCode)
        }
    }

    /** Notlösung ohne Service: Vollbild-Benachrichtigung + direkter Activity-Start. */
    private fun fallback(context: Context, message: String, requestCode: Int) {
        ensureNotificationChannel(context)
        val alarmIntent = Intent(context, AlarmActivity::class.java).apply {
            putExtra(AlarmScheduler.EXTRA_MESSAGE, message)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        val pi = PendingIntent.getActivity(
            context, requestCode, alarmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("⏰ Schicht-Wecker")
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(pi, true)
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(requestCode, notification)
        try { context.startActivity(alarmIntent) } catch (e: Exception) {
            Log.e(TAG, "startActivity fehlgeschlagen: ${e.message}")
        }
    }
}
