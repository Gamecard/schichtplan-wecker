package com.mein.schichtplan

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

class AlarmReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SchichtplanAlarm"
        private const val CHANNEL_ID = "schichtplan_alarm_v3"
        private var wakeLock: PowerManager.WakeLock? = null

        fun releaseWakeLock() {
            wakeLock?.let {
                if (it.isHeld) it.release()
            }
            wakeLock = null
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.d(TAG, "AlarmReceiver.onReceive() aufgerufen")

        // WakeLock sofort erwerben damit das Gerät wach bleibt
        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "schichtplan:alarm"
        ).apply { acquire(60_000L) }
        Log.d(TAG, "WakeLock erworben")

        val message = intent.getStringExtra("message") ?: "Zeit aufzustehen!"
        val requestCode = intent.getIntExtra("requestCode", 1)

        val alarmIntent = Intent(context, AlarmActivity::class.java).apply {
            putExtra("message", message)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

        // Notification-Channel einrichten (muss VOR dem Posten der Notification existieren)
        ensureNotificationChannel(context)

        // Fullscreen-Notification = zuverlässigster Weg auf Android 14+/15
        showFullScreenNotification(context, message, alarmIntent, requestCode)
        Log.d(TAG, "Fullscreen-Notification gepostet (requestCode=$requestCode)")

        // Activity direkt starten als zweiter Weg
        try {
            context.startActivity(alarmIntent)
            Log.d(TAG, "AlarmActivity gestartet via startActivity()")
        } catch (e: Exception) {
            Log.e(TAG, "startActivity fehlgeschlagen: ${e.message}")
        }
    }

    private fun ensureNotificationChannel(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Alten Channel löschen falls vorhanden (Channel-Einstellungen lassen sich nicht updaten)
        nm.deleteNotificationChannel("alarm_channel")
        nm.deleteNotificationChannel("schichtplan_alarm_v2")

        val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val audioAttrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Schichtplan Wecker",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Alarmton und Vibration bei Schichtbeginn"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 800, 400, 800, 400, 800)
            setSound(alarmSound, audioAttrs)
            setBypassDnd(true)
            lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
        }
        nm.createNotificationChannel(channel)
        Log.d(TAG, "Notification-Channel '$CHANNEL_ID' erstellt")
    }

    private fun showFullScreenNotification(
        context: Context,
        message: String,
        alarmIntent: Intent,
        notificationId: Int
    ) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val fullScreenPi = PendingIntent.getActivity(
            context,
            notificationId,   // Einmaliger RequestCode pro Alarm!
            alarmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("⏰ Schicht-Wecker")
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSound(alarmSound)
            .setVibrate(longArrayOf(0, 800, 400, 800, 400, 800))
            .setFullScreenIntent(fullScreenPi, true)
            .setOngoing(true)
            .setAutoCancel(false)
            .build()

        nm.notify(notificationId, notification)
    }
}
