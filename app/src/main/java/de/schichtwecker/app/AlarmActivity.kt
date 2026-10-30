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
import androidx.compose.runtime.collectAsState
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

        setContent {
            val ringing by AlarmService.ringing.collectAsState()
            AlarmScreen(
                message = ringing?.message ?: fallbackMessage ?: "Wecker!",
                snoozeMinutes = ringing?.snoozeMinutes ?: AlarmOptions.snoozeMinutes(this),
                onDismiss = { sendAction(AlarmService.ACTION_DISMISS) },
                onSnooze = { sendAction(AlarmService.ACTION_SNOOZE) }
            )
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
fun AlarmScreen(message: String, snoozeMinutes: Int, onDismiss: () -> Unit, onSnooze: () -> Unit) {
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
            // genau zum Minutenwechsel aktualisieren
            delay(60_000L - System.currentTimeMillis() % 60_000L + 50L)
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
                Text("Schlummern  $snoozeMinutes Min", fontSize = 14.sp, fontWeight = FontWeight.W500)
            }
        }
    }
}
