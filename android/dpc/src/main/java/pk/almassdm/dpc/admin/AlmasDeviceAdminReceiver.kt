package pk.almassdm.dpc.admin

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import pk.almassdm.dpc.data.Prefs

/**
 * The device-owner hook.
 *
 * Provisioning ends here: the QR the shop scanned carried an admin extras
 * bundle with the enrolment code and the server address, and this is where the
 * handset first sees them. It saves both and hands off to enrolment — it does
 * no network work itself, because a broadcast receiver has seconds to live.
 */
class AlmasDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)
        // On Android 12+ PolicyComplianceActivity may already have done this;
        // ProvisioningHandoff starts enrolment only once per code.
        ProvisioningHandoff.complete(context, ProvisioningHandoff.adminExtras(intent), "PROFILE_PROVISIONING_COMPLETE")
    }

    override fun onEnabled(context: Context, intent: Intent) {
        Log.i(TAG, "Device admin enabled.")
    }

    override fun onDisabled(context: Context, intent: Intent) {
        // Reachable only for a plain device admin. A device owner cannot be
        // removed without a factory reset, which is the point of provisioning
        // this way rather than asking the customer to tick a box.
        Log.w(TAG, "Device admin disabled; policy can no longer be enforced.")
    }

    override fun onLockTaskModeExiting(context: Context, intent: Intent) {
        super.onLockTaskModeExiting(context, intent)
        // If kiosk mode ends while a lock is still in force, put it back.
        if (Prefs(context).lockApplied) {
            LockController(context).showLockScreen()
        }
    }

    companion object {
        private const val TAG = "AlmasDeviceAdmin"

        /** The two values the enrolment QR carries into the handset. */
        const val EXTRA_ENROLLMENT_TOKEN = "enrollmentToken"
        const val EXTRA_SERVER_URL = "serverUrl"

        fun componentName(context: Context): ComponentName =
            ComponentName(context.applicationContext, AlmasDeviceAdminReceiver::class.java)
    }
}
