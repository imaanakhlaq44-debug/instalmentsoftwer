package pk.emishield.dpc.net

import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.telephony.TelephonyManager
import org.json.JSONObject
import pk.emishield.dpc.BuildConfig

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
) {
    fun toJson(): JSONObject {
        val json = JSONObject().put("dpcVersion", dpcVersion)
        batteryLevel?.let { json.put("batteryLevel", it) }
        osVersion?.takeIf { it.isNotBlank() }?.let { json.put("osVersion", it) }
        securityPatch?.takeIf { it.isNotBlank() }?.let { json.put("securityPatch", it) }
        simCarrier?.takeIf { it.isNotBlank() }?.let { json.put("simCarrier", it) }
        return json
    }

    companion object {
        fun collect(context: Context): Telemetry {
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
            )
        }
    }
}
