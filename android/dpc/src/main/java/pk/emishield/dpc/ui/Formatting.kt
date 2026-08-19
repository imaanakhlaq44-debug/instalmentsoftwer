package pk.emishield.dpc.ui

import android.content.Context
import pk.emishield.dpc.R
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The lock screen shows real money and real dates, so both are formatted for a
 * person rather than printed as they arrive on the wire.
 */
object Formatting {

    private val money: NumberFormat = NumberFormat.getNumberInstance(Locale.US).apply {
        maximumFractionDigits = 0
        minimumFractionDigits = 0
    }

    fun amount(context: Context, value: Double): String =
        context.getString(R.string.currency_amount, money.format(value))

    /**
     * The server sends a date-only string. Anything else is shown unchanged
     * rather than guessed at — a wrong date on a screen holding someone's phone
     * is worse than an unformatted one.
     */
    fun date(iso: String?): String {
        if (iso.isNullOrBlank()) return "—"
        val dayPart = iso.substringBefore('T')
        return runCatching {
            val parsed = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(dayPart)
            SimpleDateFormat("d MMMM yyyy", Locale.getDefault()).format(parsed!!)
        }.getOrDefault(iso)
    }

    fun timestamp(millis: Long): String? {
        if (millis <= 0L) return null
        return SimpleDateFormat("d MMM, h:mm a", Locale.getDefault()).format(Date(millis))
    }
}
