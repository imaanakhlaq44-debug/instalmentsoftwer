package pk.almassdm.dpc.admin

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.telephony.TelephonyManager
import java.io.File

/**
 * Reads handset hardware identity (dual-SIM IMEIs, serial) and OS integrity
 * signals (device-owner privilege, root binaries, test-keys, bootloader lock).
 *
 * Hardware IDs are available without prompts when this app holds Device Owner;
 * on plain installs without Device Owner, `getImei()` / `getSerial()` throw
 * `SecurityException`, which this collector degrades safely to empty/`null`.
 */
object DeviceIntegrityCollector {

    private val SU_PATHS = listOf(
        "/system/bin/su",
        "/system/xbin/su",
        "/sbin/su",
        "/system/app/Superuser.apk",
        "/data/local/bin/su",
        "/data/local/xbin/su",
        "/su/bin/su",
        "/magisk/.core",
    )

    @SuppressLint("HardwareIds", "MissingPermission")
    fun collect(context: Context): DeviceIntegrity.HardwareSnapshot {
        val appContext = context.applicationContext
        val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as? DevicePolicyManager
        val isDeviceOwner = dpm?.isDeviceOwnerApp(appContext.packageName) == true
        val admin = AlmasDeviceAdminReceiver.componentName(appContext)

        if (isDeviceOwner) {
            grantPhoneStatePermission(dpm!!, admin, appContext.packageName)
        }

        val rawImeis = mutableListOf<String?>()
        val telephony = appContext.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        if (telephony != null) {
            val slotCount = slotCount(telephony)
            for (slot in 0 until slotCount) {
                runCatching { telephony.getImei(slot) }.getOrNull()?.let(rawImeis::add)
            }
            if (rawImeis.isEmpty()) {
                runCatching { telephony.imei }.getOrNull()?.let(rawImeis::add)
            }
        }

        val serial = runCatching { Build.getSerial() }.getOrNull()
        val verifiedBootState = readSystemProperty("ro.boot.verifiedbootstate")
        val flashLocked = readSystemProperty("ro.boot.flash.locked")
        val suBinaryFound = runCatching { SU_PATHS.any { File(it).exists() } }.getOrDefault(false)

        return DeviceIntegrity.evaluate(
            isDeviceOwner = isDeviceOwner,
            rawImeis = rawImeis,
            serialNumber = serial,
            buildTags = Build.TAGS,
            verifiedBootState = verifiedBootState,
            flashLocked = flashLocked,
            suBinaryFound = suBinaryFound,
        )
    }

    private fun grantPhoneStatePermission(
        dpm: DevicePolicyManager,
        admin: ComponentName,
        packageName: String,
    ) {
        runCatching {
            dpm.setPermissionGrantState(
                admin,
                packageName,
                Manifest.permission.READ_PHONE_STATE,
                DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
            )
        }
    }

    @Suppress("DEPRECATION")
    private fun slotCount(telephony: TelephonyManager): Int =
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                telephony.activeModemCount
            } else {
                telephony.phoneCount
            }
        }.getOrDefault(1).coerceIn(1, 3)

    @SuppressLint("PrivateApi")
    private fun readSystemProperty(key: String): String? =
        runCatching {
            val sysProps = Class.forName("android.os.SystemProperties")
            val get = sysProps.getMethod("get", String::class.java, String::class.java)
            (get.invoke(null, key, "") as? String)?.takeIf { it.isNotBlank() }
        }.getOrNull()
}
