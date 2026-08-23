package pk.almassdm.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import pk.almassdm.dpc.data.PolicyView
import pk.almassdm.dpc.work.OfflineLockRule
import java.time.LocalDate
import java.util.concurrent.TimeUnit

/**
 * The only decision this app makes without asking the server, tested for the
 * cases where getting it wrong would restrict a phone that should be working.
 *
 * The rule is deliberately two conditions rather than one, and most of what is
 * below is about the second: silence is not by itself evidence that anybody
 * owes anything.
 */
class OfflineLockRuleTest {

    private val today = LocalDate.of(2026, 8, 21)
    private val now = 1_755_000_000_000L

    private fun daysAgo(days: Long) = now - TimeUnit.DAYS.toMillis(days)

    private fun policy(
        offlineLockAfterDays: Int = 7,
        gracePeriodDays: Int = 3,
        amountDue: Double = 0.0,
        nextDueDate: String? = null,
    ) = PolicyView(
        locked = false,
        lockMessage = null,
        emergencyCallsAllowed = true,
        paymentMethods = listOf("CASH"),
        amountDue = amountDue,
        nextDueDate = nextDueDate,
        offlineLockAfterDays = offlineLockAfterDays,
        gracePeriodDays = gracePeriodDays,
        dealerName = "Al Madina Mobiles",
        dealerPhone = "03001234567",
    )

    @Test
    fun `locks after the limit when money is already overdue`() {
        assertTrue(
            OfflineLockRule.shouldSelfLock(
                policy(offlineLockAfterDays = 7, amountDue = 6500.0),
                lastCheckInAt = daysAgo(8),
                now = now,
                today = today,
            )
        )
    }

    @Test
    fun `does not lock a paid-up phone however long it stays out of contact`() {
        // The case this guard exists for: a customer who is not behind on
        // anything and spends a month somewhere with no signal keeps a working
        // phone. Silence is not evidence of non-payment.
        assertFalse(
            OfflineLockRule.shouldSelfLock(
                policy(offlineLockAfterDays = 7, amountDue = 0.0, nextDueDate = "2026-12-05"),
                lastCheckInAt = daysAgo(60),
                now = now,
                today = today,
            )
        )
    }

    @Test
    fun `locks for an installment that fell due while the phone was silent`() {
        // Due on the 10th with three days' grace: past due by the 21st, and no
        // server was ever able to tell this handset so.
        assertTrue(
            OfflineLockRule.shouldSelfLock(
                policy(offlineLockAfterDays = 7, gracePeriodDays = 3, nextDueDate = "2026-08-10"),
                lastCheckInAt = daysAgo(9),
                now = now,
                today = today,
            )
        )
    }

    @Test
    fun `honours the grace period the same way the server does`() {
        // Due on the 18th, three days' grace, and today is the 21st — the grace
        // date itself, which is not yet late.
        assertFalse(
            OfflineLockRule.shouldSelfLock(
                policy(offlineLockAfterDays = 7, gracePeriodDays = 3, nextDueDate = "2026-08-18"),
                lastCheckInAt = daysAgo(9),
                now = now,
                today = today,
            )
        )
    }

    @Test
    fun `does not lock before the limit is reached`() {
        assertFalse(
            OfflineLockRule.shouldSelfLock(
                policy(offlineLockAfterDays = 7, amountDue = 6500.0),
                lastCheckInAt = daysAgo(6),
                now = now,
                today = today,
            )
        )
    }

    @Test
    fun `a limit of zero is off, whatever else is true`() {
        assertFalse(
            OfflineLockRule.shouldSelfLock(
                policy(offlineLockAfterDays = 0, amountDue = 99_000.0),
                lastCheckInAt = daysAgo(400),
                now = now,
                today = today,
            )
        )
    }

    @Test
    fun `a handset that has never reported is not locked`() {
        // Reachable only on a half-finished install. Enrolment stamps the
        // timestamp, and a phone nobody has managed yet is not one to restrict.
        assertFalse(
            OfflineLockRule.shouldSelfLock(
                policy(amountDue = 6500.0),
                lastCheckInAt = 0L,
                now = now,
                today = today,
            )
        )
    }

    @Test
    fun `a clock moved backwards yields no elapsed days rather than a negative count`() {
        assertEquals(0, OfflineLockRule.daysOutOfContact(lastCheckInAt = now, now = daysAgo(30)))
        assertFalse(
            OfflineLockRule.shouldSelfLock(
                policy(amountDue = 6500.0),
                lastCheckInAt = now,
                now = daysAgo(30),
                today = today,
            )
        )
    }

    @Test
    fun `an unreadable due date is not treated as overdue`() {
        assertFalse(
            OfflineLockRule.shouldSelfLock(
                policy(nextDueDate = "not a date"),
                lastCheckInAt = daysAgo(30),
                now = now,
                today = today,
            )
        )
    }

    @Test
    fun `counts whole days out of contact`() {
        assertEquals(0, OfflineLockRule.daysOutOfContact(daysAgo(0), now))
        assertEquals(3, OfflineLockRule.daysOutOfContact(daysAgo(3), now))
        assertEquals(0, OfflineLockRule.daysOutOfContact(lastCheckInAt = 0L, now = now))
    }
}
