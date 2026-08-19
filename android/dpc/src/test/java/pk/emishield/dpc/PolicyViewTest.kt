package pk.emishield.dpc

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pk.emishield.dpc.data.PendingCommand
import pk.emishield.dpc.data.PolicyView

/**
 * The parser sits between the server and a screen that tells someone their
 * phone is restricted, so the cases that matter are the ones where a wrong
 * reading would put a wrong number in front of a customer.
 */
class PolicyViewTest {

    @Test
    fun `reads a locked policy as the server sends it`() {
        val policy = PolicyView.fromJson(
            JSONObject(
                """
                {
                  "locked": true,
                  "lockMessage": "Payment overdue since 5 August.",
                  "emergencyCallsAllowed": true,
                  "paymentMethods": ["CASH", "JAZZCASH"],
                  "amountDue": 12500.5,
                  "nextDueDate": "2026-09-05",
                  "contact": { "dealerName": "Al Madina Mobiles", "dealerPhone": "03001234567" }
                }
                """
            )
        )

        assertTrue(policy.locked)
        assertEquals("Payment overdue since 5 August.", policy.lockMessage)
        assertEquals(listOf("CASH", "JAZZCASH"), policy.paymentMethods)
        assertEquals(12500.5, policy.amountDue, 0.001)
        assertEquals("2026-09-05", policy.nextDueDate)
        assertEquals("Al Madina Mobiles", policy.dealerName)
        assertEquals("03001234567", policy.dealerPhone)
    }

    @Test
    fun `a JSON null message does not become the text null`() {
        // optString returns the literal "null" for a JSON null, which would
        // otherwise be rendered on the lock screen as the word null.
        val policy = PolicyView.fromJson(
            JSONObject("""{ "locked": true, "lockMessage": null, "nextDueDate": null }""")
        )

        assertNull(policy.lockMessage)
        assertNull(policy.nextDueDate)
    }

    @Test
    fun `an unlocked device with nothing owed reads as zero, not as missing`() {
        val policy = PolicyView.fromJson(JSONObject("""{ "locked": false, "amountDue": 0 }"""))

        assertFalse(policy.locked)
        assertEquals(0.0, policy.amountDue, 0.001)
        assertTrue(policy.paymentMethods.isEmpty())
        // Absent means permitted: an emergency call is not something to withhold
        // because a field was left out of a response.
        assertTrue(policy.emergencyCallsAllowed)
    }

    @Test
    fun `a contact-less policy does not invent a shop`() {
        val policy = PolicyView.fromJson(JSONObject("""{ "locked": true }"""))

        assertNull(policy.dealerName)
        assertNull(policy.dealerPhone)
    }

    @Test
    fun `commands the app cannot carry out are not accepted`() {
        assertNull(PendingCommand.fromJson(null))
        assertNull(PendingCommand.fromJson(JSONObject("""{ "type": "WIPE" }""")))
        assertNull(PendingCommand.fromJson(JSONObject("{}")))

        val lock = PendingCommand.fromJson(
            JSONObject("""{ "type": "LOCK", "issuedAt": "2026-08-18T10:00:00.000Z" }""")
        )
        assertEquals("LOCK", lock?.type)
        assertEquals("2026-08-18T10:00:00.000Z", lock?.issuedAt)
    }
}
