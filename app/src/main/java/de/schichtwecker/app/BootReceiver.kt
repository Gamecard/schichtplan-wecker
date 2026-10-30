package de.schichtwecker.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Android löscht alle AlarmManager-Wecker beim Neustart. Dieser Receiver plant sie aus dem
 * [AlarmStore] neu ein – ebenso nach App-Update und Zeit-/Zeitzonenwechsel.
 * LOCKED_BOOT_COMPLETED kommt schon vor dem ersten Entsperren (Direct Boot).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            Intent.ACTION_TIME_CHANGED,
            Intent.ACTION_TIMEZONE_CHANGED -> {
                val n = AlarmScheduler.rescheduleAll(context)
                ShiftWidget.refresh(context)
                Log.d("SchichtplanAlarm", "BootReceiver (${intent.action}): $n Wecker eingeplant")
            }
        }
    }
}
