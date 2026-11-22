package pk.almassdm.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import pk.almassdm.dpc.admin.OfflineUnlock
import pk.almassdm.dpc.work.OfflineLockRule
import pk.almassdm.dpc.data.PolicyView
import java.time.LocalDate

class OfflineUnlockTest {

    // Same vector as server/tests/api/offline-unlock.test.ts.
    private val token = "test-device-token"

    @Test
    fun `token hash matches the server's stored hash`() {
        assertEquals(
            "fdc2f4194f79710d879d596f606d94f5e85f07f53b42d2b13f2e9aeb74d78c39",
            OfflineUnlock.tokenHash(token)
        )
    }

    @Test
    fun `code matches the server's fixed vector`() {
        val hash = OfflineUnlock.tokenHash(token)
        assertEquals("03478775", OfflineUnlock.code(hash, "dev-1", "12345678"))
        assertEquals("64068132", OfflineUnlock.code(hash, "dev-1", "00000000"))
    }

    @Test
    fun `matches accepts spaces and dashes, rejects anything else`() {
        assertTrue(OfflineUnlock.matches("0347 8775", token, "dev-1", "12345678"))
        assertTrue(OfflineUnlock.matches("0347-8775", token, "dev-1", "12345678"))
        assertFalse(OfflineUnlock.matches("03478776", token, "dev-1", "12345678"))
        assertFalse(OfflineUnlock.matches("03478775", token, "dev-2", "12345678"))
        assertFalse(OfflineUnlock.matches("03478775", token, "dev-1", "12345679"))
        assertFalse(OfflineUnlock.matches("0347877", token, "dev-1", "12345678"))
    }

    @Test
    fun `challenge is eight digits and displays in two groups`() {
        val c = OfflineUnlock.newChallenge()
        assertEquals(8, c.length)
        assertTrue(c.all { it in '0'..'9' })
        assertEquals("1234 5678", OfflineUnlock.display("12345678"))
    }

    @Test
    fun `five wrong codes block further attempts for thirty minutes`() {
        var failures = 0
        var blockedUntil = 0L
        val now = 1_000_000L
        repeat(4) {
            val (f, b) = OfflineUnlock.afterFailure(failures, now)
            failures = f; blockedUntil = b
            assertTrue(OfflineUnlock.attemptAllowed(blockedUntil, now))
        }
        val (f, b) = OfflineUnlock.afterFailure(failures, now)
        assertEquals(0, f)
        assertFalse(OfflineUnlock.attemptAllowed(b, now))
        assertTrue(OfflineUnlock.attemptAllowed(b, now + OfflineUnlock.BLOCK_MILLIS))
    }

    @Test
    fun `an offline unlock restarts the offline count`() {
        val day = 24L * 60 * 60 * 1000
        val now = 100 * day
        val policy = PolicyView(
            locked = false,
            lockMessage = null,
            emergencyCallsAllowed = true,
            paymentMethods = emptyList(),
            amountDue = 5000.0,
            nextDueDate = null,
            offlineLockAfterDays = 7,
            gracePeriodDays = 0,
            dealerName = null,
            dealerPhone = null,
        )
        // Ten days silent: the rule would lock.
        assertTrue(OfflineLockRule.shouldSelfLock(policy, now - 10 * day, now, LocalDate.of(2026, 11, 23)))
        // Unlocked by code a day ago: the silence is measured from then.
        val lastContact = maxOf(now - 10 * day, now - 1 * day)
        assertFalse(OfflineLockRule.shouldSelfLock(policy, lastContact, now, LocalDate.of(2026, 11, 23)))
    }
}
