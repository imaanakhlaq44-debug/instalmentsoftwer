package pk.almassdm.dpc.net
import android.content.Context
import android.provider.Settings
import pk.almassdm.dpc.admin.LockController
object SetupReadiness {
    fun ready(deviceProvisioned: Int, userSetupComplete: Int, deviceOwner: Boolean) = deviceProvisioned == 1 && userSetupComplete == 1 && deviceOwner
    fun collect(context: Context): Boolean = runCatching { ready(Settings.Global.getInt(context.contentResolver, Settings.Global.DEVICE_PROVISIONED, 0), Settings.Secure.getInt(context.contentResolver, "user_setup_complete", 0), LockController(context).isDeviceOwner) }.getOrDefault(false)
}
