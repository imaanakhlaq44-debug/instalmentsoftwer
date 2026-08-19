package pk.emishield.dpc

import org.junit.Assert.assertEquals
import org.junit.Test
import pk.emishield.dpc.net.DpcApi

/**
 * The base URL is printed into a QR by a shop and sometimes typed by hand.
 * Getting the join wrong produces a phone that provisions cleanly and then
 * never checks in again — a failure nobody sees until a payment is missed.
 */
class DpcApiEndpointTest {

    @Test
    fun `joins with and without a trailing slash`() {
        assertEquals(
            "https://api.emishield.pk/api/dpc/check-in",
            DpcApi.endpoint("https://api.emishield.pk/api/dpc", "check-in")
        )
        assertEquals(
            "https://api.emishield.pk/api/dpc/check-in",
            DpcApi.endpoint("https://api.emishield.pk/api/dpc/", "check-in")
        )
    }

    @Test
    fun `tolerates whitespace around a typed address`() {
        assertEquals(
            "http://10.0.2.2:5000/api/dpc/enroll",
            DpcApi.endpoint("  http://10.0.2.2:5000/api/dpc  ", "enroll")
        )
    }

    @Test
    fun `does not double the separator for a nested path`() {
        assertEquals(
            "https://host/api/dpc/commands/ack",
            DpcApi.endpoint("https://host/api/dpc", "/commands/ack")
        )
    }
}
