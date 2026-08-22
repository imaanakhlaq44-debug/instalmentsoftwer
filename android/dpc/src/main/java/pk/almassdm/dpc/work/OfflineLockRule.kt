package pk.almassdm.dpc.work

import pk.almassdm.dpc.data.PolicyView
import java.time.LocalDate
import java.time.format.DateTimeParseException
import java.util.concurrent.TimeUnit

/**
 * Whether a handset that cannot reach the server should restrict itself.
 *
 * The rest of the protocol is built on the server deciding and the phone
 * reporting. This is the one decision the phone has to make alone, because it
 * only ever arises when there is nobody to ask — a customer who keeps the phone
 * off the network could otherwise sit out an entire plan with a lock command
 * queued behind them forever.
 *
 * It is pure and takes its clock as a parameter so the whole rule can be tested
 * without a device, a network or a WorkManager. Everything that touches the
 * handset lives in [OfflineWatchdogWorker].
 *
 * ### Two conditions, not one
 *
 * Silence alone is not enough. The phone locks only when it has been out of
 * contact for the dealer's limit **and**, by the last schedule it was given, an
 * installment is genuinely past its grace period. A customer who is paid up and
 * spends three weeks somewhere without signal keeps their phone working; the
 * one whose installment came due during that silence does not.
 *
 * ### What it cannot do
 *
 * It reads the system clock, and a device owner can move that. Rolling the
 * clock back stalls the count. The lock still lands the moment the phone
 * reaches the server, so this delays enforcement rather than escaping it, and
 * a handset stuck at "last contact: three weeks ago" is visible on the
 * dashboard the whole time.
 */
object OfflineLockRule {

    fun shouldSelfLock(
        policy: PolicyView,
        lastCheckInAt: Long,
        now: Long = System.currentTimeMillis(),
        today: LocalDate = LocalDate.now(),
    ): Boolean {
        val limit = policy.offlineLockAfterDays
        if (limit <= 0) return false

        // A handset that has never reported has no silence to measure. Enrolment
        // stamps `lastCheckInAt`, so this is only reachable on a half-finished
        // install, which is not something to lock somebody's phone over.
        if (lastCheckInAt <= 0L) return false

        if (daysOutOfContact(lastCheckInAt, now) < limit) return false

        return anInstallmentIsPastDue(policy, today)
    }

    /**
     * Whole days since the last successful check-in, floored at zero.
     *
     * A clock moved backwards yields 0 rather than a negative count, so the
     * phone declines to lock instead of doing arithmetic it cannot trust.
     */
    fun daysOutOfContact(lastCheckInAt: Long, now: Long = System.currentTimeMillis()): Int {
        if (lastCheckInAt <= 0L || now <= lastCheckInAt) return 0
        return TimeUnit.MILLISECONDS.toDays(now - lastCheckInAt).toInt()
    }

    /**
     * Whether the last figures the phone was given describe money that is late.
     *
     * `amountDue` is what the server had already marked overdue. `nextDueDate`
     * covers the case the whole rule exists for: an installment that fell due
     * *after* the phone went quiet, which no server was able to tell it about.
     */
    private fun anInstallmentIsPastDue(policy: PolicyView, today: LocalDate): Boolean {
        if (policy.amountDue > 0.0) return true

        val due = policy.nextDueDate?.let { text ->
            try {
                LocalDate.parse(text)
            } catch (e: DateTimeParseException) {
                null
            }
        } ?: return false

        return today.isAfter(due.plusDays(policy.gracePeriodDays.toLong()))
    }
}
