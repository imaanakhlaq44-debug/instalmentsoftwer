package pk.emishield.relay

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The address is typed by a shopkeeper on a counter phone, so the join is the
 * one piece of this client worth pinning down: get it wrong and the app pairs,
 * shows "sending is on", and silently never collects a message.
 */
class RelayApiEndpointTest {

    @Test
    fun `joins with and without a trailing slash`() {
        assertEquals(
            "https://api.emishield.pk/api/sms-relay/poll",
            RelayApi.endpoint("https://api.emishield.pk/api/sms-relay", "poll")
        )
        assertEquals(
            "https://api.emishield.pk/api/sms-relay/results",
            RelayApi.endpoint("https://api.emishield.pk/api/sms-relay/", "results")
        )
    }

    @Test
    fun `tolerates whitespace from a pasted address`() {
        assertEquals(
            "http://10.0.2.2:5000/api/sms-relay/poll",
            RelayApi.endpoint("  http://10.0.2.2:5000/api/sms-relay  ", "poll")
        )
    }
}
