package pk.almassdm.dpc

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import pk.almassdm.dpc.admin.AttestationChallenge
import pk.almassdm.dpc.admin.AttestationReport
import pk.almassdm.dpc.net.Telemetry

class AttestationChallengeTest {

    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

    @Test
    fun `enrollment challenge matches the server's derivation`() {
        // Same vector as server/tests/api/hardware-attestation.test.ts.
        assertEquals(
            "416f4981d48e6da08d4431d3787147fec4f3f171353f2cee114115384b5cfa7e",
            hex(AttestationChallenge.forEnrollment("ENROLL-TOKEN-123")),
        )
        // The QR code is sometimes typed by hand with stray spaces.
        assertArrayEquals(
            AttestationChallenge.forEnrollment("ENROLL-TOKEN-123"),
            AttestationChallenge.forEnrollment("  ENROLL-TOKEN-123 "),
        )
    }

    @Test
    fun `decodes a base64url server challenge and rejects junk`() {
        val decoded = AttestationChallenge.decode("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc")
        assertEquals(32, decoded!!.size)
        assertEquals(7, decoded[0].toInt())

        assertNull(AttestationChallenge.decode(null))
        assertNull(AttestationChallenge.decode(""))
        assertNull(AttestationChallenge.decode("not base64 !!"))
        assertNull(AttestationChallenge.decode("AAAA")) // too short to be ours
    }

    @Test
    fun `serializes the attestation into the check-in body`() {
        val telemetry = Telemetry(
            batteryLevel = null,
            osVersion = "14",
            securityPatch = null,
            simCarrier = null,
            dpcVersion = "1.5.0",
            attestation = AttestationReport(listOf("MIIB", "MIIC"), idsAttested = true),
        )
        val json = telemetry.toJson().getJSONObject("attestation")
        assertEquals("MIIB", json.getJSONArray("chain").getString(0))
        assertEquals(2, json.getJSONArray("chain").length())
        assertEquals(true, json.getBoolean("idsAttested"))
        assertFalse(json.has("error"))
    }
}
