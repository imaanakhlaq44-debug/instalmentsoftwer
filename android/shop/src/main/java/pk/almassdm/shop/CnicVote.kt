package pk.almassdm.shop

import java.time.LocalDate

/**
 * Collects what the live camera reads off the card, frame after frame, and only
 * trusts a field once the same value has come back more than once. One blurry
 * frame can turn a 3 into an 8; two frames agreeing on the same number rarely do.
 */
class CnicVote(private val agree: Int = 2) {
    private val cnics = HashMap<String, Int>()
    private val names = HashMap<String, Int>()
    private val fathers = HashMap<String, Int>()
    private val births = HashMap<LocalDate, Int>()
    private val expiries = HashMap<LocalDate, Int>()
    private var lifetimeVotes = 0
    var frames = 0; private set

    @Synchronized fun add(card: CnicCard) {
        frames++
        card.cnic?.let { cnics.bump(it) }
        card.name?.let { names.bump(normal(it)) }
        card.fatherName?.let { fathers.bump(normal(it)) }
        card.dateOfBirth?.let { births.bump(it) }
        card.dateOfExpiry?.let { expiries.bump(it) }
        if (card.lifetime) lifetimeVotes++
    }

    /** The number has been read the same way [agree] times. */
    val cnicConfirmed @Synchronized get() = cnics.values.any { it >= agree }

    /** Number and name both confirmed: nothing more the camera needs to wait for. */
    val complete @Synchronized get() = cnicConfirmed && names.values.any { it >= agree }

    /** Every field on the card agreed, so there is no reason to keep the shop waiting at all. */
    val everything @Synchronized get() = complete &&
        fathers.values.any { it >= agree } && births.values.any { it >= agree } &&
        (expiries.values.any { it >= agree } || lifetimeVotes >= agree)

    /** Something worth showing the shop while it holds the card still. */
    val seenAnything @Synchronized get() = cnics.isNotEmpty() || names.isNotEmpty()

    /**
     * The card as agreed so far. With [final] true (time is up, or the shop
     * pressed the shutter) a value seen only once is still returned, since the
     * shop checks the form before saving; otherwise only agreed values are.
     */
    @Synchronized fun result(final: Boolean = false): CnicCard {
        val need = if (final) 1 else agree
        return CnicCard(
            cnic = cnics.best(need),
            name = names.best(need),
            fatherName = fathers.best(need),
            dateOfBirth = births.best(need),
            dateOfExpiry = expiries.best(need),
            lifetime = lifetimeVotes >= need,
        )
    }

    private fun <K> HashMap<K, Int>.bump(key: K) { this[key] = (this[key] ?: 0) + 1 }

    /** The most-read value, if it was read at least [need] times. A tie is not a winner: an empty box beats a wrong one. */
    private fun <K> HashMap<K, Int>.best(need: Int): K? {
        val sorted = entries.sortedByDescending { it.value }
        val top = sorted.firstOrNull() ?: return null
        if (top.value < need) return null
        if (sorted.size > 1 && sorted[1].value == top.value) return null
        return top.key
    }

    /** OCR returns "MUHAMMAD  ASLAM" and "Muhammad Aslam" for the same line; count them together. */
    private fun normal(name: String) = name.trim().replace(Regex("\\s+"), " ")
        .split(' ').joinToString(" ") { w -> w.lowercase().replaceFirstChar { it.uppercase() } }
}
