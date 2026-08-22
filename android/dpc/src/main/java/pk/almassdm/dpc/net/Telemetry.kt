package pk.almassdm.dpc.net

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.telephony.TelephonyManager
import org.json.JSONObject
import pk.almassdm.dpc.BuildConfig
import pk.almassdm.dpc.data.Prefs
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * What a check-in reports about the handset.
 *
 * The server's schema also accepts a Wi-Fi SSID and a GPS fix. Neither is sent.
 * Collecting a customer's home network name and coordinates is not needed to
 * decide whether an installment is overdue, and an app that holds someone's
 * phone should be able to say exactly what it knows about them: the charge
 * level, the OS build, and the network operator's name.
 */
data class Telemetry(
    val batteryLevel: Int?,
    val osVersion: String?,
    val securityPatch: String?,
    val simCarrier: String?,
    val dpcVersion: String,
    /**
     * Whether the handset is currently holding itself under the offline rule.
     *
     * This is the phone reporting something it already did, on the first
     * check-in it manages after doing it. The server has no other way to learn
     * of it — it was not there — and a shop looking at a restricted handset is
     * entitled to know that nobody at the counter ordered this one.
     */
    val offlineLockActive: Boolean = false,
    val offlineLockSince: Long = 0L,
) {
    fun toJson(): JSONObject {
        val json = JSONObject().put("dpcVersion", dpcVersion)
        batteryLevel?.let { json.put("batteryLevel", it) }
        osVersion?.takeIf { it.isNotBlank() }?.let { json.put("osVersion", it) }
        securityPatch?.takeIf { it.isNotBlank() }?.let { json.put("securityPatch", it) }
        simCarrier?.takeIf { it.isNotBlank() }?.let { json.put("simCarrier", it) }

        json.put("offlineLockActive", offlineLockActive)
        if (offlineLockActive && offlineLockSince > 0L) {
            json.put("offlineLockSince", isoUtc(offlineLockSince))
        }
        return json
    }

    companion object {
        /**
         * `2026-08-21T09:04:00Z`.
         *
         * Written out rather than taken from `Instant.toString()`, which drops
         * the seconds when they are zero — the server validates this field as a
         * full ISO-8601 timestamp and would reject one minute in sixty.
         */
        private val ISO_UTC: DateTimeFormatter =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'").withZone(ZoneOffset.UTC)

        private fun isoUtc(epochMillis: Long): String = ISO_UTC.format(Instant.ofEpochMilli(epochMillis))

        fun collect(context: Context, prefs: Prefs = Prefs(context)): Telemetry {
            val battery = runCatching {
                val manager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
                manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            }.getOrNull()?.takeIf { it in 0..100 }

            // Reading the operator name needs no permission; it is also blank on
            // a handset with no SIM, which is a normal state for a phone sitting
            // on a shop counter waiting to be handed over.
            val carrier = runCatching {
                val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
                telephony.networkOperatorName
            }.getOrNull()

            return Telemetry(
                batteryLevel = battery,
                osVersion = Build.VERSION.RELEASE,
                securityPatch = Build.VERSION.SECURITY_PATCH,
                simCarrier = carrier,
                dpcVersion = BuildConfig.VERSION_NAME,
                offlineLockActive = prefs.offlineLockActive,
                offlineLockSince = prefs.offlineLockSince,
            )
        }
    }
}
