package pk.almassdm.dpc.admin

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StagedRestrictionsTest {

    private val apps = listOf("com.whatsapp", "com.facebook.katana", "com.google.android.youtube")
    private val installed = setOf("com.whatsapp", "com.google.android.youtube")

    @Test
    fun `level one turns calls and SMS off and suspends nothing`() {
        val plan = StagedRestrictions.plan(1, apps, installed, emptySet(), restrictionsOn = false)
        assertEquals(StagedRestrictions.LEVEL_ONE_RESTRICTIONS, plan.addRestrictions)
        assertTrue(plan.suspend.isEmpty())
    }

    @Test
    fun `level two suspends only the listed apps that are installed`() {
        val plan = StagedRestrictions.plan(2, apps, installed, emptySet(), restrictionsOn = true)
        assertTrue(plan.addRestrictions.isEmpty())
        assertEquals(listOf("com.google.android.youtube", "com.whatsapp"), plan.suspend)
    }

    @Test
    fun `back to level zero undoes everything this app did`() {
        val plan = StagedRestrictions.plan(0, emptyList(), installed, installed, restrictionsOn = true)
        assertEquals(StagedRestrictions.LEVEL_ONE_RESTRICTIONS, plan.clearRestrictions)
        assertEquals(listOf("com.google.android.youtube", "com.whatsapp"), plan.unsuspend)
    }

    @Test
    fun `dropping from two to one releases the apps but keeps calls off`() {
        val plan = StagedRestrictions.plan(1, emptyList(), installed, installed, restrictionsOn = true)
        assertTrue(plan.clearRestrictions.isEmpty())
        assertEquals(2, plan.unsuspend.size)
    }

    @Test
    fun `nothing to do when already at the requested level`() {
        val plan = StagedRestrictions.plan(2, apps, installed, installed, restrictionsOn = true)
        assertTrue(plan.isEmpty)
    }

    @Test
    fun `an unknown level is clamped rather than trusted`() {
        val plan = StagedRestrictions.plan(9, apps, installed, emptySet(), restrictionsOn = false)
        assertEquals(StagedRestrictions.LEVEL_ONE_RESTRICTIONS, plan.addRestrictions)
        assertEquals(2, plan.suspend.size)
    }
}
