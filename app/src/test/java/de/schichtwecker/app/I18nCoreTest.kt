package de.schichtwecker.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/** Schlüsselauflösung, Platzhalter und Mehrzahl – ohne Android (PluralRules als Lambda nachgebaut). */
class I18nCoreTest {

    private val germanOrEnglish: (Long) -> String = { n -> if (n == 1L) "one" else "other" }
    // vereinfachte russische Regel: 1 → one, 2–4 → few, sonst many
    private val russian: (Long) -> String = { n ->
        val m10 = n % 10; val m100 = n % 100
        when {
            m10 == 1L && m100 != 11L -> "one"
            m10 in 2..4 && m100 !in 12..14 -> "few"
            else -> "many"
        }
    }

    private fun table(vararg p: Pair<String, String>, plural: (Long) -> String = germanOrEnglish) =
        I18nCore.Table(mapOf(*p), plural, Locale.ROOT)

    @Test
    fun kette_gewaehlt_dann_englisch_dann_deutsch() {
        val tr = table("a" to "tr-a")
        val en = table("a" to "en-a", "b" to "en-b")
        val de = table("a" to "de-a", "b" to "de-b", "c" to "de-c")
        val chain = listOf(tr, en, de)
        assertEquals("tr-a", I18nCore.lookup(chain, "a"))
        assertEquals("en-b", I18nCore.lookup(chain, "b"))
        assertEquals("de-c", I18nCore.lookup(chain, "c"))
        assertNull(I18nCore.lookup(chain, "fehlt"))
    }

    @Test
    fun platzhalter() {
        assertEquals("Heute: Früh", I18nCore.format("Heute: {shift}", mapOf("shift" to "Früh")))
        assertEquals("{x} 5", I18nCore.format("{x} {n}", mapOf("n" to 5)))
        assertEquals("ohne", I18nCore.format("ohne", mapOf("n" to 1)))
        assertEquals("a  b", I18nCore.format("a {v} b", mapOf("v" to null)))
    }

    @Test
    fun mehrzahl_je_sprache() {
        val ru = table("m_one" to "минута", "m_few" to "минуты", "m_many" to "минут", plural = russian)
        assertEquals("минута", I18nCore.lookupPlural(listOf(ru), "m", 21))
        assertEquals("минуты", I18nCore.lookupPlural(listOf(ru), "m", 3))
        assertEquals("минут", I18nCore.lookupPlural(listOf(ru), "m", 12))

        val en = table("m_one" to "{n} minute", "m_other" to "{n} minutes")
        assertEquals("{n} minute", I18nCore.lookupPlural(listOf(en), "m", 1))
        assertEquals("{n} minutes", I18nCore.lookupPlural(listOf(en), "m", 0))
    }

    @Test
    fun mehrzahl_fallback_other_dann_schluessel_dann_naechste_sprache() {
        val onlyOther = table("m_other" to "viele")
        assertEquals("viele", I18nCore.lookupPlural(listOf(onlyOther), "m", 1))
        val plain = table("m" to "ohne Suffix")
        assertEquals("ohne Suffix", I18nCore.lookupPlural(listOf(plain), "m", 7))
        val empty = table()
        val en = table("m_one" to "one", "m_other" to "other")
        assertEquals("other", I18nCore.lookupPlural(listOf(empty, en), "m", 2))
        assertNull(I18nCore.lookupPlural(listOf(empty), "m", 2))
    }

    @Test
    fun ueberwiegend_texte() {
        assertTrue(I18nCore.mostlyStrings(10, 0))
        assertTrue(I18nCore.mostlyStrings(9, 1))
        assertFalse(I18nCore.mostlyStrings(8, 2))
        assertFalse(I18nCore.mostlyStrings(0, 0))
    }
}
