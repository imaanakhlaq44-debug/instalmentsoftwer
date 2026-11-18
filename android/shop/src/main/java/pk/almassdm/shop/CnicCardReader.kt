package pk.almassdm.shop

import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/** One line of text the on-device OCR found, with where it sits on the photo. */
data class OcrLine(val text: String, val left: Int, val top: Int, val right: Int, val bottom: Int) {
    val height get() = (bottom - top).coerceAtLeast(1)
}

/** What could be read off the front of a Pakistani CNIC. Anything unread is null. */
data class CnicCard(
    val cnic: String?,
    val name: String?,
    val fatherName: String?,
    val dateOfBirth: LocalDate?,
    val dateOfExpiry: LocalDate?,
    val lifetime: Boolean,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("ok", true)
        put("cnic", cnic ?: JSONObject.NULL)
        put("name", name ?: JSONObject.NULL)
        put("fatherName", fatherName ?: JSONObject.NULL)
        put("dateOfBirth", dateOfBirth?.toString() ?: JSONObject.NULL)
        put("dateOfExpiry", dateOfExpiry?.toString() ?: JSONObject.NULL)
        put("lifetime", lifetime)
    }
}

/**
 * Reads the printed front of a CNIC. The QR on the back is NADRA's own signed
 * data and cannot be read by anyone else, so the English text on the front is
 * what is used. Nothing here guesses: a field whose label or shape is not found
 * stays empty, and the shop types it.
 */
object CnicCardReader {
    private val DASH = "[-–—.\\s]{0,3}"
    private const val DIGITISH = "[0-9OoDIl|SsBZz]"
    private val CNIC_DASHED = Regex("(?<![0-9A-Za-z])($DIGITISH{5})$DASH($DIGITISH{7})$DASH($DIGITISH)(?![0-9A-Za-z])")
    private val DATE = Regex("(?<!\\d)(\\d{2})\\s?[.\\-/,]\\s?(\\d{2})\\s?[.\\-/,]\\s?(\\d{4})(?!\\d)")
    private val NAME_LABEL = Regex("^\\s*name\\b\\s*:?\\s*(.*)$", RegexOption.IGNORE_CASE)
    private val FATHER_LABEL = Regex("^\\s*(?:father|husband)(?:'?s)?\\s*name\\b\\s*:?\\s*(.*)$", RegexOption.IGNORE_CASE)
    private val NAME_SHAPE = Regex("^[A-Za-z][A-Za-z .'-]{1,58}[A-Za-z.]$")
    /** Words printed on every card, which are never part of a person's name. */
    private val CARD_WORDS = setOf(
        "PAKISTAN", "ISLAMIC", "REPUBLIC", "NATIONAL", "IDENTITY", "CARD", "NAME", "FATHER", "HUSBAND",
        "GENDER", "COUNTRY", "STAY", "DATE", "BIRTH", "ISSUE", "EXPIRY", "SIGNATURE", "HOLDER", "NUMBER",
        "LIFETIME", "NADRA", "OF", "THE",
    )

    fun read(lines: List<OcrLine>): CnicCard {
        val clean = lines.map { it.copy(text = it.text.replace(Regex("\\s+"), " ").trim()) }.filter { it.text.isNotEmpty() }
        val all = clean.joinToString("\n") { it.text }
        val dated = clean.flatMap { line -> DATE.findAll(line.text).mapNotNull { m -> date(m)?.let { line to it } } }
        val lifetime = all.contains("lifetime", ignoreCase = true)
        val dates = dated.map { it.second }.distinct().sorted()
        // Birth comes before issue, and issue before expiry, on every card.
        val birth = if (dates.size >= 2) dates.first() else dateNear(clean, dated, "birth")
        val expiry = when {
            lifetime -> null
            dates.size >= 3 -> dates.last()
            // With a date missing, only a label of its own says which one is the expiry:
            // "Date of Issue  Date of Expiry" read as one line could point at either.
            else -> dateNear(clean, dated, "expiry", unless = "issue")?.takeIf { birth == null || it > birth }
        }
        return CnicCard(
            cnic = cnic(all),
            name = valueUnder(clean, NAME_LABEL) { !FATHER_LABEL.matches(it) },
            fatherName = valueUnder(clean, FATHER_LABEL),
            dateOfBirth = birth,
            dateOfExpiry = expiry,
            lifetime = lifetime,
        )
    }

    /** 12345-1234567-1, with the letters OCR mistakes for digits put right. */
    fun cnic(text: String): String? {
        for (m in CNIC_DASHED.findAll(text)) {
            val raw = m.groupValues.drop(1)
            // Mostly digits already; a token that is mostly letters is a word, not a number.
            if (raw.joinToString("").count { it.isDigit() } < 11) continue
            val parts = raw.map { digits(it) }
            if (parts.all { p -> p.all { it.isDigit() } }) return "${parts[0]}-${parts[1]}-${parts[2]}"
        }
        return null
    }

    private fun digits(s: String) = s.map {
        when (it) { 'O', 'o', 'D' -> '0'; 'I', 'l', '|' -> '1'; 'S', 's' -> '5'; 'B' -> '8'; 'Z', 'z' -> '2'; else -> it }
    }.joinToString("")

    private fun date(m: MatchResult): LocalDate? = runCatching {
        LocalDate.parse("${m.groupValues[1]}.${m.groupValues[2]}.${m.groupValues[3]}", DateTimeFormatter.ofPattern("dd.MM.yyyy"))
    }.getOrNull()?.takeIf { it.year in 1900..2100 }

    /** The date printed under (or beside) the label that contains [word]. */
    private fun dateNear(lines: List<OcrLine>, dated: List<Pair<OcrLine, LocalDate>>, word: String, unless: String? = null): LocalDate? {
        val label = lines.firstOrNull { it.text.contains(word, ignoreCase = true) } ?: return null
        if (unless != null && label.text.contains(unless, ignoreCase = true)) return null
        DATE.find(label.text)?.let { m -> date(m)?.let { return it } }
        return dated
            .filter { (line, _) -> line !== label && line.top >= label.top && line.top - label.bottom <= label.height * 3 }
            .minByOrNull { (line, _) -> (line.top - label.top) + kotlin.math.abs(line.left - label.left) }
            ?.second
    }

    /** The name printed on the label line itself, or on the nearest line under it. */
    private fun valueUnder(lines: List<OcrLine>, label: Regex, accept: (String) -> Boolean = { true }): String? {
        for (line in lines) {
            if (!accept(line.text)) continue
            val m = label.matchEntire(line.text) ?: continue
            name(m.groupValues[1])?.let { return it }
            val below = lines
                .filter { it !== line && it.top > line.top && it.top - line.bottom <= line.height * 3 }
                .filter { kotlin.math.abs(it.left - line.left) <= line.height * 4 }
                .sortedBy { it.top }
            for (candidate in below) {
                if (NAME_LABEL.matches(candidate.text) || FATHER_LABEL.matches(candidate.text)) break
                name(candidate.text)?.let { return it }
            }
        }
        return null
    }

    private fun name(text: String): String? {
        val t = text.replace(Regex("\\s+"), " ").trim()
        if (!NAME_SHAPE.matches(t)) return null
        val words = t.uppercase().split(' ', '.').filter { it.isNotEmpty() }
        if (words.any { it in CARD_WORDS }) return null
        if (words.size == 1 && words[0].length < 3) return null
        return t
    }
}
