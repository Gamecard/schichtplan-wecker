package de.schichtwecker.app

import android.content.Context
import android.icu.text.PluralRules
import android.util.Log
import androidx.core.content.edit
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import java.util.Locale

/**
 * Mehrsprachigkeit für den Kotlin-Teil (Benachrichtigung, Wecker-Bildschirm, Widget, Toasts).
 *
 * Quelle sind dieselben Sprachdateien wie für die Web-Oberfläche: `assets/lang/<code>.json`,
 * flaches JSON-Objekt `{"_meta":{…}, "schluessel":"Text mit {platzhalter}", "x_one":…}`.
 * Zusätzlich wird `assets/lang/native.<code>.json` eingemischt, falls vorhanden (vorläufige
 * Ablage der `native.*`-Schlüssel – schadet nicht, wenn sie später in `<code>.json` stehen).
 *
 * Auflösung: gewählte Sprache → en → de → Schlüssel selbst.
 * Einstellung "auto" = Systemsprache (falls eingebaut, sonst en), "custom" = vom Nutzer
 * importierte Datei.
 *
 * Direct Boot: Einstellung UND importierte Datei liegen im gerätegeschützten Speicher – der
 * Wecker kann vor dem ersten Entsperren klingeln und soll dann schon die richtige Sprache zeigen.
 * Assets sind ohnehin immer lesbar. Geht trotzdem etwas schief, gilt die Systemsprache.
 */
object I18n {
    private const val TAG = "SchichtplanAlarm"
    private const val PREFS = "ui_prefs"
    private const val KEY_LANGUAGE = "language"
    private const val ASSET_DIR = "lang"
    private const val CUSTOM_FILE = "custom.json"

    const val AUTO = "auto"
    const val CUSTOM = "custom"
    const val FALLBACK = "en"
    const val SOURCE = "de"

    /** Größte importierbare Sprachdatei (eine vollständige Übersetzung hat wenige 10 KB). */
    const val MAX_FILE_BYTES = 512 * 1024

    /** Erlaubte Sprachcodes: "de", "tr", "pt-BR", "zh-Hans" … – kein Pfad, kein Punkt. */
    private val CODE_RE = Regex("^[a-z]{2,3}(-[A-Za-z]{2,4})?$")

    fun isValidCode(code: String) = CODE_RE.matches(code)

    /* ── Zustand (Cache) ── */

    private class State(
        val setting: String,
        val systemTag: String,
        val effective: String,
        val locale: Locale,
        val chain: List<I18nCore.Table>
    )

    @Volatile private var state: State? = null
    @Volatile private var assetCodes: Set<String>? = null

    /** Cache verwerfen – nach Sprachwechsel oder neuer importierter Datei. */
    fun reset() {
        state = null
    }

    private fun deviceContext(context: Context): Context =
        context.applicationContext.createDeviceProtectedStorageContext()

    private fun prefs(context: Context) =
        deviceContext(context).getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun customFile(context: Context) = File(File(deviceContext(context).filesDir, ASSET_DIR), CUSTOM_FILE)

    private fun systemTag(): String = Locale.getDefault().toLanguageTag()

    /** Sprache des Systems (nur Sprachteil, z. B. "de"; "he" statt veraltetem "iw"). */
    fun systemLanguage(): String = systemTag().substringBefore('-').ifEmpty { FALLBACK }

    /** Rohe Einstellung: "auto", "custom" oder ein Sprachcode. */
    fun languageSetting(context: Context): String = try {
        prefs(context).getString(KEY_LANGUAGE, AUTO) ?: AUTO
    } catch (e: Exception) {
        // z. B. Speicher nicht lesbar – dann eben Systemsprache
        Log.w(TAG, "Spracheinstellung nicht lesbar", e)
        AUTO
    }

    /** Speichert die Einstellung (synchron) und aktualisiert Kanal-Namen und Widget. */
    fun setLanguageSetting(context: Context, code: String): Boolean {
        if (code != AUTO && code != CUSTOM && !isValidCode(code)) return false
        val ok = try {
            // synchron schreiben: direkt danach liest der Wecker/das Widget die Einstellung
            prefs(context).edit(commit = true) { putString(KEY_LANGUAGE, code) }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Spracheinstellung nicht speicherbar", e)
            false
        }
        onLanguageChanged(context)
        return ok
    }

    /* ── Erscheinungsbild (klassisch/Anime) ──
       Liegt hier, weil es dieselben gerätegeschützten "ui_prefs" nutzt: Der Wecker-Bildschirm
       kann vor dem ersten Entsperren erscheinen und soll dann schon das gewählte Design zeigen. */
    private const val KEY_DESIGN = "design"
    const val DESIGN_CLASSIC = "classic"
    const val DESIGN_ANIME = "anime"

    /** "classic" oder "anime" (verstecktes Extra der Web-Oberfläche). */
    fun design(context: Context): String = try {
        if (prefs(context).getString(KEY_DESIGN, DESIGN_CLASSIC) == DESIGN_ANIME) DESIGN_ANIME else DESIGN_CLASSIC
    } catch (e: Exception) {
        Log.w(TAG, "Design-Einstellung nicht lesbar", e)
        DESIGN_CLASSIC
    }

    /** Merkt sich das Design der Web-Oberfläche (nur bekannte Werte, synchron). */
    fun setDesign(context: Context, design: String): Boolean {
        if (design != DESIGN_CLASSIC && design != DESIGN_ANIME) return false
        return try {
            if (design(context) != design) prefs(context).edit(commit = true) { putString(KEY_DESIGN, design) }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Design-Einstellung nicht speicherbar", e)
            false
        }
    }

    /**
     * Nach einem Sprachwechsel: Cache leeren, Namen des Benachrichtigungskanals in der neuen
     * Sprache setzen (gleiche ID → nur Name/Beschreibung ändern sich) und das Widget neu zeichnen.
     */
    fun onLanguageChanged(context: Context) {
        reset()
        try { AlarmReceiver.ensureNotificationChannel(context) } catch (e: Exception) {
            Log.w(TAG, "Kanal-Name nicht aktualisiert", e)
        }
        ShiftWidget.refresh(context)
    }

    /** Tatsächlich benutzte Sprache: Code einer eingebauten Sprache oder "custom". */
    fun currentLanguage(context: Context): String = state(context).effective

    /** Locale der aktuellen Sprache (Großschreibung, Mehrzahl, Datumsformat). */
    fun locale(context: Context): Locale = state(context).locale

    /** Sprachteil der aktuellen Sprache – bei "custom" aus `_meta.code` der Datei, sonst "en". */
    fun baseLanguage(context: Context): String = locale(context).language.ifEmpty { FALLBACK }

    /* ── Texte ── */

    /** Text zum Schlüssel, Platzhalter `{name}` werden ersetzt. Wirft nie. */
    fun t(context: Context, key: String, vararg args: Pair<String, Any?>): String = t(context, key, args.toMap())

    fun t(context: Context, key: String, args: Map<String, Any?>): String {
        val template = try { I18nCore.lookup(state(context).chain, key) } catch (e: Exception) {
            Log.w(TAG, "Übersetzung fehlgeschlagen: $key", e); null
        }
        if (template == null) Log.w(TAG, "Fehlender Text: $key")
        return I18nCore.format(template ?: key, args)
    }

    /** Wie [t], aber null statt Schlüssel, wenn es den Text nirgends gibt. */
    fun tOrNull(context: Context, key: String, vararg args: Pair<String, Any?>): String? = try {
        I18nCore.lookup(state(context).chain, key)?.let { I18nCore.format(it, args.toMap()) }
    } catch (_: Exception) { null }

    /**
     * Mehrzahl: `key_zero/_one/_two/_few/_many/_other` nach den Regeln der jeweiligen Sprache
     * (android.icu PluralRules), Fallback `_other`, dann `key`. `{n}` ist immer gesetzt.
     */
    fun plural(context: Context, key: String, n: Long, vararg args: Pair<String, Any?>): String {
        val all = args.toMap() + ("n" to n)
        val template = try { I18nCore.lookupPlural(state(context).chain, key, n) } catch (e: Exception) {
            Log.w(TAG, "Übersetzung fehlgeschlagen: $key", e); null
        }
        if (template == null) Log.w(TAG, "Fehlender Text: $key")
        return I18nCore.format(template ?: key, all)
    }

    fun plural(context: Context, key: String, n: Int, vararg args: Pair<String, Any?>): String =
        plural(context, key, n.toLong(), *args)

    /**
     * Datum nach einer Vorlage aus der Sprachdatei. Platzhalter: {d} {dd} {M} {MM} {yyyy},
     * {weekday} (weekday.short.0 = Montag) und {month} (month.long.0 = Januar). Fehlen die
     * gemeinsamen Schlüssel, liefert die Locale den Namen.
     */
    fun formatDate(context: Context, templateKey: String, cal: Calendar): String {
        val loc = locale(context)
        val d = cal.get(Calendar.DAY_OF_MONTH)
        val m = cal.get(Calendar.MONTH) // 0..11
        val wd = (cal.get(Calendar.DAY_OF_WEEK) + 5) % 7 // Mo = 0 … So = 6
        val weekday = tOrNull(context, "weekday.short.$wd")
            ?: cal.getDisplayName(Calendar.DAY_OF_WEEK, Calendar.SHORT, loc) ?: ""
        val month = tOrNull(context, "month.long.$m")
            ?: cal.getDisplayName(Calendar.MONTH, Calendar.LONG_STANDALONE, loc) ?: ""
        // Monatsname im Datum (pl/ru Genitiv, z. B. „2 listopada“); fehlt month.gen.*, gilt month.long.*
        val monthGen = tOrNull(context, "month.gen.$m") ?: month
        return t(
            context, templateKey,
            "d" to d, "dd" to String.format(Locale.ROOT, "%02d", d),
            "M" to m + 1, "MM" to String.format(Locale.ROOT, "%02d", m + 1),
            "yyyy" to cal.get(Calendar.YEAR), "weekday" to weekday, "month" to month, "month_gen" to monthGen
        )
    }

    /* ── Laden ── */

    private fun state(context: Context): State {
        val setting = languageSetting(context)
        val sys = systemTag()
        state?.let { if (it.setting == setting && it.systemTag == sys) return it }
        synchronized(this) {
            state?.let { if (it.setting == setting && it.systemTag == sys) return it }
            val built = build(context, setting, sys)
            state = built
            Log.d(TAG, "Sprache: Einstellung=$setting → ${built.effective} (${built.chain.size} Dateien)")
            return built
        }
    }

    private fun build(context: Context, setting: String, sys: String): State {
        val available = availableCodes(context)
        var custom: I18nCore.Table? = null
        var effective = when {
            setting == CUSTOM -> {
                custom = loadCustom(context)
                if (custom != null) CUSTOM else null
            }
            setting != AUTO && setting in available -> setting
            else -> null
        }
        if (effective == null) {
            // auto (oder gewählte Sprache fehlt): Systemsprache mit Region, ohne Region, sonst en
            val lang = sys.substringBefore('-')
            val regionTag = sys.split('-').let { p -> if (p.size >= 2) "${p[0]}-${p.last()}" else "" }
            effective = listOf(sys, regionTag, lang).firstOrNull { it.isNotEmpty() && it in available } ?: FALLBACK
        }
        val chain = mutableListOf<I18nCore.Table>()
        if (custom != null) chain += custom
        for (code in listOf(effective, FALLBACK, SOURCE).distinct()) {
            if (code == CUSTOM) continue
            loadAsset(context, code)?.let { chain += it }
        }
        val locale = chain.firstOrNull()?.locale ?: Locale.forLanguageTag(FALLBACK)
        return State(setting, sys, effective, locale, chain)
    }

    /** Alle Codes, zu denen es `<code>.json` oder `native.<code>.json` gibt. */
    private fun availableCodes(context: Context): Set<String> {
        assetCodes?.let { return it }
        val names = try { context.assets.list(ASSET_DIR)?.toList() ?: emptyList() } catch (_: Exception) { emptyList() }
        val codes = names.filter { it.endsWith(".json") }
            .map { it.removeSuffix(".json").removePrefix("native.") }
            .filter { isValidCode(it) }
            .toSet()
        assetCodes = codes
        return codes
    }

    /** Eingebaute Sprachen für die Auswahl: nur `<code>.json` (ohne `native.*`). */
    private fun builtinCodes(context: Context): List<String> {
        val names = try { context.assets.list(ASSET_DIR)?.toList() ?: emptyList() } catch (_: Exception) { emptyList() }
        return names.filter { it.endsWith(".json") && !it.startsWith("native.") }
            .map { it.removeSuffix(".json") }
            .filter { isValidCode(it) }
            .sorted()
    }

    private fun readAsset(context: Context, name: String): String? = try {
        context.assets.open("$ASSET_DIR/$name").use { it.readBytes().toString(Charsets.UTF_8) }
    } catch (_: Exception) { null }

    private fun parseTexts(json: String): Pair<Map<String, String>, JSONObject?>? = try {
        val o = JSONObject(json)
        val texts = HashMap<String, String>()
        val keys = o.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            if (k == "_meta") continue
            val v = o.opt(k)
            if (v is String) texts[k] = v
        }
        texts to o.optJSONObject("_meta")
    } catch (e: Exception) {
        Log.w(TAG, "Sprachdatei ungültig", e)
        null
    }

    private fun pluralFor(locale: Locale): (Long) -> String {
        val rules = try { PluralRules.forLocale(locale) } catch (_: Exception) { null }
        return { n -> rules?.select(n.toDouble()) ?: "other" }
    }

    private fun loadAsset(context: Context, code: String): I18nCore.Table? {
        val main = readAsset(context, "$code.json")?.let { parseTexts(it)?.first }
        val native = readAsset(context, "native.$code.json")?.let { parseTexts(it)?.first }
        if (main == null && native == null) return null
        // Hauptdatei hat Vorrang; native.* füllt nur Lücken
        val texts = HashMap<String, String>()
        native?.let { texts.putAll(it) }
        main?.let { texts.putAll(it) }
        val locale = Locale.forLanguageTag(code)
        return I18nCore.Table(texts, pluralFor(locale), locale)
    }

    private fun readCustomText(context: Context): String? = try {
        customFile(context).takeIf { it.isFile && it.length() <= MAX_FILE_BYTES }?.readText(Charsets.UTF_8)
    } catch (e: Exception) {
        Log.w(TAG, "Eigene Sprachdatei nicht lesbar", e)
        null
    }

    private fun loadCustom(context: Context): I18nCore.Table? {
        val (texts, meta) = readCustomText(context)?.let { parseTexts(it) } ?: return null
        val code = meta?.optString("code").orEmpty()
        val locale = Locale.forLanguageTag(if (isValidCode(code)) code else FALLBACK)
        return I18nCore.Table(texts, pluralFor(locale), locale)
    }

    /* ── Für die JS-Brücke ── */

    /** JSON-Array `[{"code":"de","name":"Deutsch"}, …]` + `{"code":"custom",…}`, falls importiert. */
    fun listLanguagesJson(context: Context): String {
        val arr = JSONArray()
        for (code in builtinCodes(context)) {
            val meta = readAsset(context, "$code.json")?.let { parseTexts(it)?.second }
            val name = meta?.optString("name").orEmpty().trim().ifEmpty { code }
            arr.put(JSONObject().put("code", code).put("name", name))
        }
        customName(context)?.let { arr.put(JSONObject().put("code", CUSTOM).put("name", it)) }
        return arr.toString()
    }

    /** Anzeigename der importierten Sprache, null wenn keine importiert ist. */
    fun customName(context: Context): String? {
        val text = readCustomText(context) ?: return null
        val meta = parseTexts(text)?.second ?: return null
        return displayName(context, meta)
    }

    private fun displayName(context: Context, meta: JSONObject): String =
        meta.optString("name").trim().take(60)
            .ifEmpty { meta.optString("code").trim().take(20) }
            .ifEmpty { t(context, "native.language.custom") }

    /** Inhalt einer Sprachdatei für die Web-Oberfläche; "" wenn unbekannt oder Code unzulässig. */
    fun languageFile(context: Context, code: String): String = when {
        code == CUSTOM -> readCustomText(context) ?: ""
        isValidCode(code) -> readAsset(context, "$code.json") ?: ""
        else -> ""
    }

    /**
     * Prüft eine importierte Datei (JSON-Objekt mit `_meta`, mind. 90 % Text-Werte) und speichert
     * sie als eigene Sprache. Rückgabe: Anzeigename, null wenn ungültig.
     */
    fun importCustom(context: Context, text: String): String? {
        if (text.toByteArray(Charsets.UTF_8).size > MAX_FILE_BYTES) return null
        val o = try { JSONObject(text) } catch (_: Exception) { return null }
        val meta = o.optJSONObject("_meta") ?: return null
        var strings = 0
        var others = 0
        val keys = o.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            if (k == "_meta") continue
            if (o.opt(k) is String) strings++ else others++
        }
        if (!I18nCore.mostlyStrings(strings, others)) return null
        val file = customFile(context)
        return try {
            file.parentFile?.mkdirs()
            // erst vollständig schreiben, dann umbenennen – nie eine halbe Datei
            val tmp = File(file.parentFile, "$CUSTOM_FILE.tmp")
            tmp.writeText(text, Charsets.UTF_8)
            if (!tmp.renameTo(file)) throw IllegalStateException("Umbenennen fehlgeschlagen")
            if (languageSetting(context) == CUSTOM) onLanguageChanged(context) else reset()
            displayName(context, meta)
        } catch (e: Exception) {
            Log.e(TAG, "Eigene Sprachdatei nicht speicherbar", e)
            null
        }
    }
}

/**
 * Reine Auflösungs-Logik ohne Android-Abhängigkeiten (JVM-Unit-Test: I18nCoreTest).
 */
internal object I18nCore {
    /** Eine geladene Sprache: Texte + Mehrzahl-Kategorie für n ("one", "few", "other" …). */
    class Table(val texts: Map<String, String>, val pluralCategory: (Long) -> String, val locale: Locale)

    private val PLACEHOLDER = Regex("\\{([A-Za-z0-9_.]+)\\}")

    /** Erste Sprache der Kette, die den Schlüssel kennt. */
    fun lookup(chain: List<Table>, key: String): String? = chain.firstNotNullOfOrNull { it.texts[key] }

    /**
     * Je Sprache der Kette: `key_<Kategorie dieser Sprache>`, dann `key_other`, dann `key`.
     * Die Kategorie hängt von der Sprache ab, deren Text benutzt wird (Russisch hat "few",
     * Englisch nicht).
     */
    fun lookupPlural(chain: List<Table>, key: String, n: Long): String? = chain.firstNotNullOfOrNull { t ->
        t.texts["${key}_${t.pluralCategory(n)}"] ?: t.texts["${key}_other"] ?: t.texts[key]
    }

    /** Ersetzt `{name}`; unbekannte Platzhalter bleiben stehen (fällt beim Übersetzen auf). */
    fun format(template: String, args: Map<String, Any?>): String {
        if (args.isEmpty() || template.indexOf('{') < 0) return template
        return PLACEHOLDER.replace(template) { m ->
            if (args.containsKey(m.groupValues[1])) args[m.groupValues[1]]?.toString().orEmpty() else m.value
        }
    }

    /** „Überwiegend Texte“: mindestens ein Text und ≥ 90 % aller Werte (ohne _meta). */
    fun mostlyStrings(strings: Int, others: Int): Boolean = strings > 0 && strings * 10 >= (strings + others) * 9
}
