package de.schichtwecker.app

import android.app.KeyguardManager
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AlarmActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d("SchichtplanAlarm", "AlarmActivity.onCreate()")

        setShowWhenLocked(true)
        setTurnScreenOn(true)
        getSystemService(KeyguardManager::class.java).requestDismissKeyguard(this, null)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Fallback-Pfad (AlarmReceiver konnte den Service nicht starten): jetzt aus dem
        // Vordergrund starten – das erlaubt Android immer.
        val fallbackMessage = intent.getStringExtra(AlarmScheduler.EXTRA_MESSAGE)
        if (AlarmService.ringing.value == null && fallbackMessage != null) {
            startForegroundService(AlarmService.startIntent(this, "fallback", fallbackMessage, 0))
        }

        // Design der Web-Oberfläche (verstecktes Extra „Anime“), gerätegeschützt gespeichert
        val anime = I18n.design(this) == I18n.DESIGN_ANIME
        setContent {
            val ringing by AlarmService.ringing.collectAsState()
            val snooze = ringing?.snoozeMinutes ?: AlarmOptions.snoozeMinutes(this)
            val message = ringing?.message ?: fallbackMessage ?: I18n.t(this, "native.alarm.fallbackTitle")
            val dismissLabel = I18n.t(this, "native.alarm.dismiss").uppercase(I18n.locale(this))
            val snoozeLabel = I18n.plural(this, "native.alarm.snooze", snooze)
            if (anime) {
                AnimeAlarmScreen(
                    message = message, dismissLabel = dismissLabel, snoozeLabel = snoozeLabel,
                    onDismiss = { sendAction(AlarmService.ACTION_DISMISS) },
                    onSnooze = { sendAction(AlarmService.ACTION_SNOOZE) }
                )
            } else {
                AlarmScreen(
                    message = message, dismissLabel = dismissLabel, snoozeLabel = snoozeLabel,
                    onDismiss = { sendAction(AlarmService.ACTION_DISMISS) },
                    onSnooze = { sendAction(AlarmService.ACTION_SNOOZE) }
                )
            }
        }

        // Der Ton gehört dem AlarmService: Ist er vorbei (Aus/Schlummern über die
        // Benachrichtigung, Auto-Dismiss), schließt sich die Activity.
        lifecycleScope.launch {
            var seenRinging = AlarmService.ringing.value != null
            AlarmService.ringing.collect { r ->
                if (r != null) seenRinging = true
                else if (seenRinging || fallbackMessage == null) finish()
            }
        }
    }

    private fun sendAction(action: String) {
        startService(AlarmService.actionIntent(this, action))
        finish()
    }
}

@Composable
fun AlarmScreen(
    message: String,
    dismissLabel: String,
    snoozeLabel: String,
    onDismiss: () -> Unit,
    onSnooze: () -> Unit
) {
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
    val currentTime = rememberMinuteClock()

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
                Text(dismissLabel, fontSize = 20.sp, fontWeight = FontWeight.W500, letterSpacing = (0.5).sp)
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
                Text(snoozeLabel, fontSize = 14.sp, fontWeight = FontWeight.W500)
            }
        }
    }
}

/** Uhrzeit „HH:mm“, die sich genau zum Minutenwechsel aktualisiert. */
@Composable
private fun rememberMinuteClock(): String {
    var currentTime by remember { mutableStateOf(SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())) }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        while (true) {
            delay(60_000L - System.currentTimeMillis() % 60_000L + 50L)
            currentTime = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
        }
    }
    return currentTime
}

/**
 * Wecker-Bildschirm im Anime-Design („Nacht-Sakura“): das Maskottchen „Weckerchen“ (aufgeregt,
 * R.drawable.mascot_excited) wackelt wie ein klingelnder Wecker, solange der Bildschirm offen ist;
 * Pastellfarben auf dunklem Violett (blendet nachts nicht). Bedienung wie im klassischen Design.
 * Kontrast: Uhrzeit/Text ≥ 12:1 auf dem Hintergrund, „Aus“-Beschriftung 8:1 auf Rosa.
 */
@Composable
fun AnimeAlarmScreen(
    message: String,
    dismissLabel: String,
    snoozeLabel: String,
    onDismiss: () -> Unit,
    onSnooze: () -> Unit
) {
    val wiggle = rememberInfiniteTransition(label = "wiggle")
    val angle by wiggle.animateFloat(
        initialValue = -7f,
        targetValue = 7f,
        animationSpec = infiniteRepeatable(animation = tween(280), repeatMode = RepeatMode.Reverse),
        label = "angle"
    )
    val currentTime = rememberMinuteClock()
    val rand = Color(0xFF8A5BA8)

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF2A1C48), Color(0xFF17122B)))),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Image(
                painter = painterResource(R.drawable.mascot_excited),
                contentDescription = null,
                modifier = Modifier
                    .width(192.dp)
                    .height(180.dp)
                    .rotate(angle)
            )
            Text(
                text = currentTime,
                fontSize = 56.sp,
                fontWeight = FontWeight.W700,
                color = Color(0xFFFFD9EA),
                letterSpacing = (-0.5).sp
            )
            // Nachricht als Sprechblase
            Text(
                text = message,
                fontSize = 16.sp,
                color = Color(0xFFF4EAF8),
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .padding(horizontal = 40.dp)
                    .background(Color(0xFF251D42), RoundedCornerShape(20.dp))
                    .border(2.dp, rand, RoundedCornerShape(20.dp))
                    .padding(horizontal = 18.dp, vertical = 10.dp)
            )

            Spacer(modifier = Modifier.height(28.dp))

            Button(
                onClick = onDismiss,
                modifier = Modifier.size(136.dp),
                shape = CircleShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFFFF9FCB),
                    contentColor = Color(0xFF4A0A2B)
                )
            ) {
                Text(dismissLabel, fontSize = 20.sp, fontWeight = FontWeight.W700, letterSpacing = (0.5).sp)
            }

            OutlinedButton(
                onClick = onSnooze,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .height(52.dp)
                    .width(220.dp),
                shape = RoundedCornerShape(26.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFCDBDFF)),
                border = BorderStroke(2.dp, rand)
            ) {
                Text(snoozeLabel, fontSize = 14.sp, fontWeight = FontWeight.W600)
            }
        }
    }
}
