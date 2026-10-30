package de.schichtwecker.app

import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Spielt den Weckton als Foreground-Service. Die [AlarmActivity] ist nur noch die Oberfläche:
 * Schließt sie sich (Ein/Aus-Taste, Home), klingelt der Wecker weiter, bis „Aus“ oder
 * „Schlummern“ gedrückt wird (Activity oder Benachrichtigung) oder nach 15 Minuten.
 */
class AlarmService : Service() {

    data class Ringing(val key: String, val message: String, val snoozeMinutes: Int)

    companion object {
        private const val TAG = "SchichtplanAlarm"
        private const val ACTION_START = "de.schichtwecker.app.action.START"
        const val ACTION_DISMISS = "de.schichtwecker.app.action.DISMISS"
        const val ACTION_SNOOZE = "de.schichtwecker.app.action.SNOOZE"
        private const val NOTIFICATION_ID_BASE = 4711
        private var notificationCounter = 0
        private const val AUTO_DISMISS_MS = 15 * 60 * 1000L
        private const val RISING_START = 0.05f

        private val _ringing = MutableStateFlow<Ringing?>(null)
        /** Aktuell klingelnder Wecker (null = Ruhe) – die AlarmActivity beobachtet das. */
        val ringing: StateFlow<Ringing?> = _ringing.asStateFlow()

        fun startIntent(context: Context, key: String, message: String, requestCode: Int) =
            Intent(context, AlarmService::class.java).apply {
                action = ACTION_START
                putExtra(AlarmScheduler.EXTRA_KEY, key)
                putExtra(AlarmScheduler.EXTRA_MESSAGE, message)
                putExtra(AlarmScheduler.EXTRA_REQUEST_CODE, requestCode)
            }

        fun actionIntent(context: Context, action: String) =
            Intent(context, AlarmService::class.java).setAction(action)
    }

    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val handler = Handler(Looper.getMainLooper())
    private val autoDismiss = Runnable {
        Log.w(TAG, "Auto-Dismiss nach 15 Min")
        stopRinging()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start(
                intent.getStringExtra(AlarmScheduler.EXTRA_KEY) ?: "unbekannt",
                intent.getStringExtra(AlarmScheduler.EXTRA_MESSAGE) ?: "Zeit aufzustehen!"
            )
            ACTION_SNOOZE -> snooze()
            ACTION_DISMISS -> stopRinging()
            else -> if (_ringing.value == null) stopSelf()
        }
        return START_NOT_STICKY
    }

    /** ID der aktuellen Wecker-Benachrichtigung. Jeder Wecker bekommt eine neue, damit
     *  SystemUI ihn als NEUE Benachrichtigung behandelt und den Vollbild-Wecker zeigt –
     *  auch wenn der vorige (z. B. Vorwecker) noch klingelt. */
    private var notificationId = NOTIFICATION_ID_BASE

    private fun start(key: String, message: String) {
        AlarmReceiver.ensureNotificationChannel(this)
        val previousId = notificationId
        notificationCounter = (notificationCounter + 1) % 1000
        notificationId = NOTIFICATION_ID_BASE + notificationCounter
        // startForeground muss nach startForegroundService() sofort erfolgen
        try {
            startForeground(
                notificationId, buildNotification(message),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } catch (e: Exception) {
            // Lieber ohne Vordergrund-Status klingeln als gar nicht
            Log.e(TAG, "startForeground fehlgeschlagen", e)
        }
        // Benachrichtigung eines noch laufenden Weckers entfernen (die neue hat eine neue ID)
        if (previousId != notificationId) getSystemService(NotificationManager::class.java)?.cancel(previousId)
        // Ein neuer Wecker ersetzt einen noch laufenden
        stopSound()
        _ringing.value = Ringing(key, message, AlarmOptions.snoozeMinutes(this))

        if (wakeLock?.isHeld != true) {
            wakeLock = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "schichtplan:alarm")
                .apply { acquire(AUTO_DISMISS_MS + 60_000L) }
        }
        // „Nur Vibration“: kein Ton (Vibration läuft immer)
        if (!AlarmOptions.vibrateOnly(this)) startSound()
        startVibration()
        handler.removeCallbacks(autoDismiss)
        handler.postDelayed(autoDismiss, AUTO_DISMISS_MS)

        try {
            startActivity(alarmActivityIntent())
        } catch (e: Exception) {
            // Kein Problem: Die Vollbild-Benachrichtigung zeigt die Activity bzw. Heads-up.
            Log.w(TAG, "AlarmActivity nicht direkt startbar: ${e.message}")
        }
    }

    private fun snooze() {
        val current = _ringing.value
        if (current != null) {
            val ok = AlarmScheduler.scheduleAt(
                this, AlarmScheduler.snoozeKeyOf(current.key),
                System.currentTimeMillis() + current.snoozeMinutes * 60_000L,
                current.message
            )
            if (!ok) Log.e(TAG, "Schlummern konnte nicht geplant werden")
            ShiftWidget.refresh(this)
        }
        stopRinging()
    }

    private fun stopRinging() {
        handler.removeCallbacks(autoDismiss)
        stopSound()
        _ringing.value = null
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacks(autoDismiss)
        stopSound()
        _ringing.value = null
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    private fun alarmActivityIntent() = Intent(this, AlarmActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

    private fun buildNotification(message: String): android.app.Notification {
        val fullScreen = PendingIntent.getActivity(
            this, NOTIFICATION_ID_BASE, alarmActivityIntent(),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        fun servicePi(action: String, rc: Int) = PendingIntent.getService(
            this, rc, actionIntent(this, action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, AlarmReceiver.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("⏰ Schicht-Wecker")
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(fullScreen, true)
            .setContentIntent(fullScreen)
            .setOngoing(true)
            .addAction(0, "Aus", servicePi(ACTION_DISMISS, 1))
            .addAction(0, "Schlummern ${AlarmOptions.snoozeMinutes(this)} Min", servicePi(ACTION_SNOOZE, 2))
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }

    private fun createPlayer(uri: android.net.Uri) = MediaPlayer().apply {
        setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        )
        setDataSource(this@AlarmService, uri)
        isLooping = true
        val rising = AlarmOptions.risingVolume(this@AlarmService)
        if (rising) setVolume(RISING_START, RISING_START)
        setOnPreparedListener {
            it.start()
            if (rising) startRisingVolume(it)
        }
        prepareAsync()
    }

    /** Lautstärke in Schritten von leise auf voll (innerhalb der Alarm-Lautstärke des Systems). */
    private fun startRisingVolume(player: MediaPlayer) {
        val steps = 30
        val stepMs = AlarmOptions.RISING_DURATION_MS / steps
        for (i in 1..steps) {
            handler.postDelayed({
                if (mediaPlayer === player) {
                    val v = RISING_START + (1f - RISING_START) * i / steps
                    try { player.setVolume(v, v) } catch (_: Exception) {}
                }
            }, stepMs * i)
        }
    }

    private fun startSound() {
        mediaPlayer = try {
            createPlayer(AlarmReceiver.getAlarmSoundUri(this))
        } catch (e: Exception) {
            Log.e(TAG, "Alarm-Sound Fehler, Fallback auf Standard", e)
            try {
                createPlayer(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                )
            } catch (e2: Exception) {
                Log.e(TAG, "Auch Fallback-Sound fehlgeschlagen", e2)
                null
            }
        }
    }

    private fun startVibration() {
        vibrator = getSystemService(VibratorManager::class.java).defaultVibrator
        val effect = VibrationEffect.createWaveform(longArrayOf(0, 800, 400, 800, 400, 800), 0)
        // Als Wecker-Vibration kennzeichnen – sonst kann Android sie im Lautlos-/„Bitte nicht
        // stören“-Modus oder bei reduzierter Vibration unterdrücken (wichtig bei „Nur vibrieren“)
        vibrator?.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
    }

    private fun stopSound() {
        // Laufende Lautstärke-Rampe und Auto-Dismiss verwerfen (start() setzt Auto-Dismiss neu)
        handler.removeCallbacksAndMessages(null)
        try { mediaPlayer?.let { if (it.isPlaying) it.stop(); it.release() } } catch (_: Exception) {}
        mediaPlayer = null
        try { vibrator?.cancel() } catch (_: Exception) {}
        vibrator = null
    }
}
