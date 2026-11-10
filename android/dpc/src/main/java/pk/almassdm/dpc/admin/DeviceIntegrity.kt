package pk.almassdm.dpc.admin

import org.json.JSONArray
import org.json.JSONObject

/**
 * Pure hardware-identity and OS-integrity evaluation.
 *
 * Kept separate from Android framework calls ([DeviceIntegrityCollector]) so it
 * can be unit-tested on the JVM without device stubs.
 */
object DeviceIntegrity {

    private val IMEI_REGEX = Regex("^\\d{14,16}$")

    data class Report(
        val rooted: Boolean,
        val bootloaderUnlocked: Boolean,
        val testKeys: Boolean,
        val verifiedBootState: String? = null,
        val flashLocked: String? = null,
    ) {
        fun toJson(): JSONObject = JSONObject()
            .put("rooted", rooted)
            .put("bootloaderUnlocked", bootloaderUnlocked)
            .put("testKeys", testKeys)
            .apply {
                verifiedBootState?.takeIf { it.isNotBlank() }?.let { put("verifiedBootState", it) }
                flashLocked?.takeIf { it.isNotBlank() }?.let { put("flashLocked", it) }
            }
    }

    data class HardwareSnapshot(
        val imeis: List<String>,
        val serialNumber: String?,
        val isDeviceOwner: Boolean,
        val integrity: Report,
    ) {
        fun appendToJson(json: JSONObject) {
            if (imeis.isNotEmpty()) {
                json.put("imeis", JSONArray(imeis))
            }
            serialNumber?.takeIf { it.isNotBlank() }?.let { json.put("serialNumber", it) }
            json.put("isDeviceOwner", isDeviceOwner)
            json.put("integrity", integrity.toJson())
        }
    }

    /**
     * Normalises slot IMEIs from TelephonyManager into unique 14–16 digit strings
     * (covering IMEI, IMEISV, and MEID where digits apply). Invalid or blank
     * strings are discarded so OEM quirks never poison check-ins.
     */
    fun normalizeImeis(raw: Iterable<String?>): List<String> =
        raw.asSequence()
            .mapNotNull { it?.trim()?.takeIf(String::isNotBlank) }
            .filter { IMEI_REGEX.matches(it) }
            .distinct()
            .take(4)
            .toList()

    fun isTestKeys(buildTags: String?): Boolean =
        buildTags.orEmpty()
            .split(',')
            .any { it.trim().equals("test-keys", ignoreCase = true) }

    /**
     * Only flags an unlocked bootloader when the kernel/Verified Boot property
     * explicitly reports an unlocked state (`ro.boot.flash.locked == 0` or
     * `ro.boot.verifiedbootstate == orange`). Absent/unreadable properties (common
     * when SELinux hides them on stock phones) stay `false` to avoid false alarms.
     */
    fun isBootloaderUnlocked(verifiedBootState: String?, flashLocked: String?): Boolean {
        val flash = flashLocked?.trim()
        val boot = verifiedBootState?.trim()?.lowercase()
        return flash == "0" || boot == "orange"
    }

    fun evaluate(
        isDeviceOwner: Boolean,
        rawImeis: Iterable<String?>,
        serialNumber: String?,
        buildTags: String?,
        verifiedBootState: String?,
        flashLocked: String?,
        suBinaryFound: Boolean,
    ): HardwareSnapshot {
        val cleanImeis = normalizeImeis(rawImeis)
        val cleanSerial = serialNumber?.trim()
            ?.takeIf { it.isNotBlank() && !it.equals("unknown", ignoreCase = true) }
        val cleanBootState = verifiedBootState?.trim()?.takeIf { it.isNotBlank() }
        val cleanFlashLocked = flashLocked?.trim()?.takeIf { it.isNotBlank() }

        return HardwareSnapshot(
            imeis = cleanImeis,
            serialNumber = cleanSerial,
            isDeviceOwner = isDeviceOwner,
            integrity = Report(
                rooted = suBinaryFound,
                bootloaderUnlocked = isBootloaderUnlocked(cleanBootState, cleanFlashLocked),
                testKeys = isTestKeys(buildTags),
                verifiedBootState = cleanBootState,
                flashLocked = cleanFlashLocked,
            ),
        )
    }
}

