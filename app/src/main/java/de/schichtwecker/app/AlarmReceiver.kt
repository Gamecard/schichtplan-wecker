package de.schichtwecker.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat

class AlarmReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "SchichtplanAlarm"
        private const val CHANNEL_ID = "schichtplan_alarm_v3"
        private const val CHANNEL_ID_CUSTOM = "schichtplan_alarm_custom"
        private val wakeLocks = mutableMapOf<String, PowerManager.WakeLock>()

        fun releaseWakeLock() {
            synchronized(wakeLocks) {
                wakeLocks.values.forEach { if (it.isHeld) it.release() }
                wakeLocks.clear()
            }
        }

        fun releaseWakeLock(tag: String) {
            synchronized(wakeLocks) {
                wakeLocks.remove(tag)?.let { if (it.isHeld) it.release() }
            }
        }

        fun getAlarmSoundUri(context: Context): Uri {
            if (MainActivity.usesCustomRingtone(context)) {
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
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.d(TAG, "AlarmReceiver.onReceive() aufgerufen")

        val requestCode = intent.getIntExtra("requestCode", 0)
        val wakeLockTag = "schichtplan:alarm-$requestCode"

        val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, wakeLockTag).apply { acquire(60_000L) }
        synchronized(wakeLocks) { wakeLocks[wakeLockTag] = wl }
        Log.d(TAG, "WakeLock erworben: $wakeLockTag")

        val message = intent.getStringExtra("message") ?: "Zeit aufzustehen!"

        val alarmIntent = Intent(context, AlarmActivity::class.java).apply {
            putExtra("message", message)
            putExtra("requestCode", requestCode)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

        ensureNotificationChannel(context)

        showFullScreenNotification(context, message, alarmIntent, requestCode)
        Log.d(TAG, "Fullscreen-Notification gepostet (requestCode=$requestCode)")

        try {
            context.startActivity(alarmIntent)
            Log.d(TAG, "AlarmActivity gestartet via startActivity()")
        } catch (e: Exception) {
            Log.e(TAG, "startActivity fehlgeschlagen: ${e.message}")
        }
    }

    private fun ensureNotificationChannel(context: Context) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val usesCustom = MainActivity.usesCustomRingtone(context)
        val channelId = if (usesCustom) CHANNEL_ID_CUSTOM else CHANNEL_ID

        if (nm.getNotificationChannel(channelId) != null && !usesCustom) return

        if (usesCustom) nm.deleteNotificationChannel(CHANNEL_ID_CUSTOM)
        nm.deleteNotificationChannel("alarm_channel")
        nm.deleteNotificationChannel("schichtplan_alarm_v2")

        val alarmSound = getAlarmSoundUri(context)
        val audioAttrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val channel = NotificationChannel(
            channelId,
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
        Log.d(TAG, "Notification-Channel '$channelId' erstellt (custom=$usesCustom)")
    }

    private fun showFullScreenNotification(
        context: Context,
        message: String,
        alarmIntent: Intent,
        notificationId: Int
    ) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val usesCustom = MainActivity.usesCustomRingtone(context)
        val channelId = if (usesCustom) CHANNEL_ID_CUSTOM else CHANNEL_ID

        val fullScreenPi = PendingIntent.getActivity(
            context,
            notificationId,
            alarmIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("⏰ Schicht-Wecker")
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(fullScreenPi, true)
            .setOngoing(true)
            .setAutoCancel(false)
            .build()

        nm.notify(notificationId, notification)
    }
}