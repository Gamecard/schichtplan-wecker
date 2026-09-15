package de.schichtwecker.app

import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AlarmActivity : ComponentActivity() {

    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private var isDismissed = false
    private val autoDismissHandler = Handler(Looper.getMainLooper())
    private val AUTO_DISMISS_MS = 15 * 60 * 1000L

    private val autoDismissRunnable = Runnable {
        if (!isDismissed) {
            Log.w("SchichtplanAlarm", "Auto-Dismiss nach 15 Min")
            dismissAlarm()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d("SchichtplanAlarm", "AlarmActivity.onCreate()")

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            km.requestDismissKeyguard(this, null)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val message = intent.getStringExtra("message") ?: "Wecker!"

        startAlarmSound()
        startVibration()
        autoDismissHandler.postDelayed(autoDismissRunnable, AUTO_DISMISS_MS)

        setContent {
            AlarmScreen(
                message = message,
                onDismiss = { dismissAlarm() },
                onSnooze = { snoozeAlarm() }
            )
        }
    }

    private fun startAlarmSound() {
        try {
            val uri = AlarmReceiver.getAlarmSoundUri(this)
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(this@AlarmActivity, uri)
                setOnPreparedListener { it.start() }
                setOnCompletionListener { if (it.isLooping) it.start() }
                isLooping = true
                prepareAsync()
            }
        } catch (e: Exception) {
            Log.e("SchichtplanAlarm", "Alarm-Sound Fehler, Fallback auf Standard", e)
            try {
                val fallback = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                mediaPlayer = MediaPlayer().apply {
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    setDataSource(this@AlarmActivity, fallback)
                    isLooping = true
                    setOnPreparedListener { it.start() }
                    prepareAsync()
                }
            } catch (e2: Exception) {
                Log.e("SchichtplanAlarm", "Auch Fallback-Sound fehlgeschlagen", e2)
            }
        }
    }

    private fun startVibration() {
        vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val mgr = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
            mgr.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        val pattern = longArrayOf(0, 800, 400, 800, 400, 800)
        vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
    }

    private fun stopAlarm() {
        try { mediaPlayer?.let { if (it.isPlaying) it.stop(); it.release() } } catch (_: Exception) {}
        mediaPlayer = null
        try { vibrator?.cancel() } catch (_: Exception) {}
        vibrator = null
    }

    private fun dismissAlarm() {
        if (isDismissed) return
        isDismissed = true
        autoDismissHandler.removeCallbacks(autoDismissRunnable)
        stopAlarm()
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val requestCode = intent.getIntExtra("requestCode", 0)
        nm.cancel(requestCode)
        finish()
    }

    private fun snoozeAlarm() {
        if (isDismissed) return
        isDismissed = true
        autoDismissHandler.removeCallbacks(autoDismissRunnable)
        stopAlarm()
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val requestCode = intent.getIntExtra("requestCode", 0)
        nm.cancel(requestCode)
        val originalRequestCode = intent.getIntExtra("requestCode", 0)
        val snoozeRequestCode = 900000 + originalRequestCode
        val snoozeMessage = intent.getStringExtra("message") ?: "Wecker!"
        val alarmManager = getSystemService(AlarmManager::class.java)
        val snoozeIntent = Intent(this, AlarmReceiver::class.java).apply {
            putExtra("message", snoozeMessage)
            putExtra("requestCode", snoozeRequestCode)
        }
        val pi = PendingIntent.getBroadcast(
            this, snoozeRequestCode, snoozeIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val showPi = PendingIntent.getActivity(
            this, snoozeRequestCode,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        try {
            alarmManager.setAlarmClock(
                AlarmManager.AlarmClockInfo(
                    System.currentTimeMillis() + 5 * 60 * 1000,
                    showPi
                ),
                pi
            )
        } catch (e: SecurityException) {
            Log.e("SchichtplanAlarm", "Snooze-Alarm konnte nicht geplant werden", e)
            android.widget.Toast.makeText(this, "Schlummern fehlgeschlagen – keine Alarm-Berechtigung", android.widget.Toast.LENGTH_LONG).show()
        }
        finish()
    }
    override fun onDestroy() {
        autoDismissHandler.removeCallbacks(autoDismissRunnable)
        stopAlarm()
        val requestCode = intent.getIntExtra("requestCode", 0)
        AlarmReceiver.releaseWakeLock("schichtplan:alarm-$requestCode")
        super.onDestroy()
    }

    override fun onStop() {
        super.onStop()
        if (!isDismissed) {
            stopAlarm()
        }
    }

    override fun onRestart() {
        super.onRestart()
        if (!isDismissed) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val requestCode = intent.getIntExtra("requestCode", 0)
            nm.cancel(requestCode)
            startAlarmSound()
            startVibration()
        }
    }
}

@Composable
fun AlarmScreen(message: String, onDismiss: () -> Unit, onSnooze: () -> Unit) {
    val pulse = rememberInfiniteTransition(label = "pulse")
    val scale by pulse.animateFloat(
        initialValue = 0.95f,
        targetValue = 1.05f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200),
            repeatMode = RepeatMode.Reverse
        ),
        label = "scale"
    )
    val glowAlpha by pulse.animateFloat(
        initialValue = 0.08f,
        targetValue = 0.22f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200),
            repeatMode = RepeatMode.Reverse
        ),
        label = "glow"
    )
    var currentTime by remember { mutableStateOf(SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())) }
    val scope = rememberCoroutineScope()
    androidx.compose.runtime.LaunchedEffect(Unit) {
        while (true) {
            delay(30_000L)
            currentTime = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF12131A)),
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .size(300.dp)
                .background(
                    Color(0xFF3F5EC2).copy(alpha = glowAlpha),
                    CircleShape
                )
        )
        Box(
            modifier = Modifier
                .size(200.dp)
                .background(
                    Color(0xFF3F5EC2).copy(alpha = glowAlpha * 1.5f),
                    CircleShape
                )
        )
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "\u23F0",
                fontSize = 64.sp,
                modifier = Modifier.scale(scale)
            )
            Text(
                text = currentTime,
                fontSize = 56.sp,
                fontWeight = FontWeight.W400,
                color = Color(0xFFB8C5FF),
                letterSpacing = (-0.5).sp
            )
            Text(
                text = message,
                fontSize = 16.sp,
                color = Color(0xFF8F909A),
                textAlign = TextAlign.Center,
                fontWeight = FontWeight.W400,
                modifier = Modifier.padding(horizontal = 48.dp)
            )

            Spacer(modifier = Modifier.height(40.dp))

            Button(
                onClick = onDismiss,
                modifier = Modifier.size(136.dp),
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFBA1A1A))
            ) {
                Text("AUS", fontSize = 20.sp, fontWeight = FontWeight.W500, letterSpacing = (0.5).sp)
            }

            OutlinedButton(
                onClick = onSnooze,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .height(52.dp)
                    .width(220.dp),
                shape = RoundedCornerShape(26.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFB8C5FF)),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF45464F))
            ) {
                Text("Schlummern  5 Min", fontSize = 14.sp, fontWeight = FontWeight.W500)
            }
        }
    }
}
