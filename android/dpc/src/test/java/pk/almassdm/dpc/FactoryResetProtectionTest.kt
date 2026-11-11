package pk.almassdm.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import pk.almassdm.dpc.admin.FactoryResetProtection
import pk.almassdm.dpc.admin.FactoryResetProtection.FrpReport
import pk.almassdm.dpc.admin.FactoryResetProtection.Route
import pk.almassdm.dpc.admin.FactoryResetProtection.Step
import pk.almassdm.dpc.admin.FactoryResetProtection.VerificationStatus

/**
 * FRP is what keeps a financed phone the dealer's after a wipe from recovery.
 * The two failures that matter: never installing it, and installing an account
 * nobody can sign in with, which strands the handset for the shop as well.
 */
class FactoryResetProtectionTest {

    private val dealerId = "112233445566778899001"
    private val otherId = "998877665544332211000"

    @Test
    fun `Android 11 and later use the platform API`() {
        assertEquals(Step.Apply(listOf(dealerId), Route.MODERN), FactoryResetProtection.next(30, listOf(dealerId), ""))
        assertEquals(Step.Apply(listOf(dealerId), Route.MODERN), FactoryResetProtection.next(36, listOf(dealerId), null))
    }

    @Test
    fun `older Android goes through Play services`() {
        assertEquals(Step.Apply(listOf(dealerId), Route.LEGACY), FactoryResetProtection.next(29, listOf(dealerId), ""))
        assertEquals(Step.Apply(listOf(dealerId), Route.LEGACY), FactoryResetProtection.next(26, listOf(dealerId), ""))
    }

    @Test
    fun `an unchanged policy is not re-applied on every heartbeat`() {
        val installed = FactoryResetProtection.fingerprint(listOf(dealerId, otherId).sorted(), Route.MODERN)
        // Order and duplicates from the server do not count as a change.
        assertEquals(Step.None, FactoryResetProtection.next(33, listOf(otherId, dealerId, dealerId), installed))
    }

    @Test
    fun `a new account from the dealer is applied`() {
        val installed = FactoryResetProtection.fingerprint(listOf(dealerId), Route.MODERN)
        val step = FactoryResetProtection.next(33, listOf(dealerId, otherId), installed)
        assertEquals(Step.Apply(listOf(dealerId, otherId).sorted(), Route.MODERN), step)
    }

    @Test
    fun `an OS upgrade past Android 10 re-applies through the platform API`() {
        val installedOnAndroid10 = FactoryResetProtection.fingerprint(listOf(dealerId), Route.LEGACY)
        assertEquals(
            Step.Apply(listOf(dealerId), Route.MODERN),
            FactoryResetProtection.next(30, listOf(dealerId), installedOnAndroid10)
        )
    }

    @Test
    fun `an empty list clears what was installed, and otherwise does nothing`() {
        val installed = FactoryResetProtection.fingerprint(listOf(dealerId), Route.MODERN)
        assertEquals(Step.Clear, FactoryResetProtection.next(33, emptyList(), installed))
        assertEquals(Step.None, FactoryResetProtection.next(33, emptyList(), ""))
        assertEquals(Step.None, FactoryResetProtection.next(33, emptyList(), null))
    }

    @Test
    fun `emails and junk are never installed as FRP accounts`() {
        val ids = FactoryResetProtection.normalize(listOf("dealer@gmail.com", " $dealerId ", "", "12a4", "1".repeat(31)))
        assertEquals(listOf(dealerId), ids)
        // Nothing usable left means nothing to install, not an empty FRP policy.
        assertEquals(Step.None, FactoryResetProtection.next(33, listOf("dealer@gmail.com"), ""))
    }

    @Test
    fun `live policy sync detects OS drift or silent OEM clearing`() {
        assertTrue(FactoryResetProtection.isLivePolicyInSync(listOf(dealerId), true, listOf(dealerId)))
        assertFalse(FactoryResetProtection.isLivePolicyInSync(listOf(dealerId), false, listOf(dealerId)))
        assertFalse(FactoryResetProtection.isLivePolicyInSync(listOf(dealerId), true, emptyList()))
        assertFalse(FactoryResetProtection.isLivePolicyInSync(listOf(dealerId, otherId), true, listOf(dealerId)))
        assertTrue(FactoryResetProtection.isLivePolicyInSync(emptyList(), false, emptyList()))
        assertFalse(FactoryResetProtection.isLivePolicyInSync(emptyList(), true, listOf(dealerId)))
    }

    @Test
    fun `legacy Play services restriction sync verifies normalized arrays`() {
        assertTrue(FactoryResetProtection.isLegacyRestrictionInSync(listOf(otherId, dealerId), arrayOf(dealerId, otherId)))
        assertFalse(FactoryResetProtection.isLegacyRestrictionInSync(listOf(dealerId), null))
        assertFalse(FactoryResetProtection.isLegacyRestrictionInSync(listOf(dealerId), emptyArray()))
        assertTrue(FactoryResetProtection.isLegacyRestrictionInSync(emptyList(), null))
        assertFalse(FactoryResetProtection.isLegacyRestrictionInSync(emptyList(), arrayOf(dealerId)))
    }

    @Test
    fun `FRP verification report serializes status and clamps detail`() {
        val longDetail = "x".repeat(350)
        val json = FrpReport(VerificationStatus.REFUSED, longDetail, 0).toJson()
        assertEquals("REFUSED", json.getString("status"))
        assertEquals(0, json.getInt("verifiedAccountsCount"))
        assertEquals(300, json.getString("detail").length)
    }
}
