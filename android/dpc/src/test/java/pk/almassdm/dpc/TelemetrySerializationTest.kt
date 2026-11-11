package pk.almassdm.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import pk.almassdm.dpc.admin.DeviceIntegrity
import pk.almassdm.dpc.admin.FactoryResetProtection
import pk.almassdm.dpc.net.Telemetry

class TelemetrySerializationTest {

    @Test
    fun `serializes dual-SIM hardware identity and integrity report into check-in JSON`() {
        val telemetry = Telemetry(
            batteryLevel = 84,
            osVersion = "14",
            securityPatch = "2026-08-05",
            simCarrier = "Jazz",
            dpcVersion = "1.4.0",
            offlineLockActive = false,
            offlineLockSince = 0L,
            location = null,
            imeis = listOf("358240051111110", "358240052222221"),
            serialNumber = "R58M90ABCDE",
            isDeviceOwner = true,
            integrity = DeviceIntegrity.Report(
                rooted = false,
                bootloaderUnlocked = false,
                testKeys = false,
                verifiedBootState = "green",
                flashLocked = "1",
            ),
            frp = FactoryResetProtection.FrpReport(
                status = FactoryResetProtection.VerificationStatus.ACTIVE,
                detail = null,
                verifiedAccountsCount = 2,
            ),
        )

        val json = telemetry.toJson()
        assertEquals("1.4.0", json.getString("dpcVersion"))
        assertEquals("R58M90ABCDE", json.getString("serialNumber"))
        assertTrue(json.getBoolean("isDeviceOwner"))
        assertEquals("358240051111110", json.getJSONArray("imeis").getString(0))
        assertEquals("358240052222221", json.getJSONArray("imeis").getString(1))
        val report = json.getJSONObject("integrity")
        assertFalse(report.getBoolean("rooted"))
        assertFalse(report.getBoolean("bootloaderUnlocked"))
        assertEquals("green", report.getString("verifiedBootState"))
        val frpJson = json.getJSONObject("frp")
        assertEquals("ACTIVE", frpJson.getString("status"))
        assertEquals(2, frpJson.getInt("verifiedAccountsCount"))
        assertFalse(frpJson.has("detail"))
    }

    @Test
    fun `omits optional hardware fields when empty`() {
        val telemetry = Telemetry(
            batteryLevel = null,
            osVersion = "13",
            securityPatch = null,
            simCarrier = null,
            dpcVersion = "1.4.0",
        )

        val json = telemetry.toJson()
        assertFalse(json.has("imeis"))
        assertFalse(json.has("serialNumber"))
        assertFalse(json.has("isDeviceOwner"))
        assertFalse(json.has("integrity"))
        assertFalse(json.has("frp"))
    }
}

