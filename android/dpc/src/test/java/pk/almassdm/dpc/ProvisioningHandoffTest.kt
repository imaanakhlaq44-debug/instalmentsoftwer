package pk.almassdm.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pk.almassdm.dpc.admin.ProvisioningHandoff

class ProvisioningHandoffTest {

    // DevicePolicyManager.PROVISIONING_MODE_* values.
    private val fullyManaged = 1
    private val workProfile = 2
    private val personalWorkProfile = 3

    @Test
    fun `picks fully managed when it is offered`() {
        assertEquals(fullyManaged, ProvisioningHandoff.chooseMode(listOf(fullyManaged, workProfile)))
    }

    @Test
    fun `picks fully managed when the wizard sends no list`() {
        assertEquals(fullyManaged, ProvisioningHandoff.chooseMode(null))
        assertEquals(fullyManaged, ProvisioningHandoff.chooseMode(emptyList()))
    }

    @Test
    fun `never settles for a work profile`() {
        assertNull(ProvisioningHandoff.chooseMode(listOf(workProfile, personalWorkProfile)))
    }

    @Test
    fun `starts enrolment once per code`() {
        assertTrue(ProvisioningHandoff.shouldStartEnrollment(false, null, "ABC"))
        assertFalse(ProvisioningHandoff.shouldStartEnrollment(false, "ABC", "ABC"))
        // A new QR after a reset is a new start.
        assertTrue(ProvisioningHandoff.shouldStartEnrollment(false, "ABC", "XYZ"))
    }

    @Test
    fun `without a code the enrol screen opens once`() {
        assertTrue(ProvisioningHandoff.shouldStartEnrollment(false, null, null))
        assertFalse(ProvisioningHandoff.shouldStartEnrollment(false, "", null))
    }

    @Test
    fun `an enrolled phone is left alone`() {
        assertFalse(ProvisioningHandoff.shouldStartEnrollment(true, null, "ABC"))
    }
}
