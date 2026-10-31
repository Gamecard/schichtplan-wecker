package de.schichtwecker.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Feste Ziel-Liste von `openSystemSettings` – ohne Android (nur Konstanten). */
class ReliabilityTargetsTest {

    private val appDetails = "android.settings.APPLICATION_DETAILS_SETTINGS"

    @Test
    fun jedes_ziel_hat_seiten_und_endet_bei_den_app_details() {
        for (t in ReliabilityTargets.TARGETS) {
            val steps = ReliabilityTargets.steps(t)
            assertTrue("$t ohne Seiten", steps.isNotEmpty())
            assertEquals("$t: Rückfall", appDetails, steps.last().action)
            assertTrue("$t: App-Details mit package:", steps.last().packageData)
        }
    }

    @Test
    fun unbekannte_ziele_oeffnen_nichts() {
        listOf("", "settings", "android.settings.SETTINGS", "BATTERY_SAVER", "exact", "../x")
            .forEach { assertTrue(it, ReliabilityTargets.steps(it).isEmpty()) }
    }

    @Test
    fun erste_seite_je_ziel() {
        fun first(t: String, ch: Boolean = false) = ReliabilityTargets.steps(t, ch).first()
        assertEquals("android.settings.BATTERY_SAVER_SETTINGS", first("battery_saver").action)
        assertFalse(first("battery_saver").packageData)
        assertEquals("android.settings.VIEW_ADVANCED_POWER_USAGE_DETAIL", first("app_battery").action)
        assertTrue(first("app_battery").packageData)
        assertEquals("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS", first("battery_optimization").action)
        assertEquals("android.settings.APP_NOTIFICATION_SETTINGS", first("notifications").action)
        assertTrue(first("notifications").packageExtra)
        assertEquals("android.settings.CHANNEL_NOTIFICATION_SETTINGS", first("notifications", ch = true).action)
        assertTrue(first("notifications", ch = true).channelExtra)
        assertEquals("android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT", first("full_screen").action)
        assertEquals("android.settings.REQUEST_SCHEDULE_EXACT_ALARM", first("exact_alarm").action)
    }

    @Test
    fun keine_anfrage_zur_akku_ausnahme() {
        // Play-Richtlinie: REQUEST_IGNORE_BATTERY_OPTIMIZATIONS wird nie benutzt
        val all = ReliabilityTargets.TARGETS.flatMap { ReliabilityTargets.steps(it, true) + ReliabilityTargets.steps(it) }
        assertTrue(all.none { it.action == "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" })
    }

    @Test
    fun altes_berechtigungsformat() {
        assertEquals("exact_alarm", ReliabilityTargets.fromPermissionIssue("exact"))
        assertEquals("full_screen", ReliabilityTargets.fromPermissionIssue("fullscreen"))
        assertNull(ReliabilityTargets.fromPermissionIssue(""))
        assertNull(ReliabilityTargets.fromPermissionIssue("battery_saver"))
    }
}
