package pk.almassdm.dpc

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pk.almassdm.dpc.admin.DeviceIntegrity

class DeviceIntegrityTest {

    @Test
    fun `normalizes dual SIM IMEIs and strips invalid or duplicate values`() {
        val cleaned = DeviceIntegrity.normalizeImeis(
            listOf(
                " 358240051111110 ",
                "358240052222221",
                "358240051111110",
                "unknown",
                "12345",
                "",
                null,
            )
        )
        assertEquals(listOf("358240051111110", "358240052222221"), cleaned)
    }

    @Test
    fun `detects test-keys across comma-separated build tags`() {
        assertFalse(DeviceIntegrity.isTestKeys("release-keys"))
        assertFalse(DeviceIntegrity.isTestKeys(null))
        assertTrue(DeviceIntegrity.isTestKeys("test-keys"))
        assertTrue(DeviceIntegrity.isTestKeys("dev-keys, test-keys"))
    }

    @Test
    fun `bootloader unlocked check stays silent when properties are unreadable`() {
        assertFalse(DeviceIntegrity.isBootloaderUnlocked(null, null))
        assertFalse(DeviceIntegrity.isBootloaderUnlocked("green", "1"))
        assertTrue(DeviceIntegrity.isBootloaderUnlocked("green", "0"))
        assertTrue(DeviceIntegrity.isBootloaderUnlocked("orange", "1"))
        assertTrue(DeviceIntegrity.isBootloaderUnlocked("ORANGE", null))
    }

    @Test
    fun `evaluate produces normalized HardwareSnapshot JSON`() {
        val snapshot = DeviceIntegrity.evaluate(
            isDeviceOwner = true,
            rawImeis = listOf("358240051111110", "358240052222221"),
            serialNumber = "unknown",
            buildTags = "release-keys,test-keys",
            verifiedBootState = "orange",
            flashLocked = "0",
            suBinaryFound = true,
        )

        assertTrue(snapshot.isDeviceOwner)
        assertNull(snapshot.serialNumber)
        assertEquals(listOf("358240051111110", "358240052222221"), snapshot.imeis)
        assertTrue(snapshot.integrity.rooted)
        assertTrue(snapshot.integrity.bootloaderUnlocked)
        assertTrue(snapshot.integrity.testKeys)

        val json = org.json.JSONObject()
        snapshot.appendToJson(json)
        assertEquals(2, json.getJSONArray("imeis").length())
        assertFalse(json.has("serialNumber"))
        assertTrue(json.getBoolean("isDeviceOwner"))
        assertTrue(json.getJSONObject("integrity").getBoolean("bootloaderUnlocked"))
    }
}

