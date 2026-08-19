package pk.emishield.dpc.admin

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PersistableBundle
import android.util.Log
import pk.emishield.dpc.data.Prefs
import pk.emishield.dpc.ui.EnrollActivity

/**
 * The device-owner hook.
 *
 * Provisioning ends here: the QR the shop scanned carried an admin extras
 * bundle with the enrolment code and the server address, and this is where the
 * handset first sees them. It saves both and hands off to enrolment — it does
 * no network work itself, because a broadcast receiver has seconds to live.
 */
class EmiDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)

        val extras: PersistableBundle? = provisioningExtras(intent)

        val prefs = Prefs(context)
        extras?.getString(EXTRA_ENROLLMENT_TOKEN)?.takeIf { it.isNotBlank() }?.let {
            prefs.pendingEnrollmentToken = it
        }
        extras?.getString(EXTRA_SERVER_URL)?.takeIf { it.isNotBlank() }?.let {
            prefs.serverUrl = it
        }

        Log.i(TAG, "Provisioning complete; enrolment code present: ${prefs.pendingEnrollmentToken != null}")

        // The phone is still in the setup wizard at this point, so enrolment is
        // launched rather than performed here.
        context.startActivity(
            Intent(context, EnrollActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        )
    }

    @Suppress("DEPRECATION")
    private fun provisioningExtras(intent: Intent): PersistableBundle? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(
                DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE,
                PersistableBundle::class.java
            )
        } else {
            intent.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE)
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
        private const val TAG = "EmiDeviceAdmin"

        /** The two values the enrolment QR carries into the handset. */
        const val EXTRA_ENROLLMENT_TOKEN = "enrollmentToken"
        const val EXTRA_SERVER_URL = "serverUrl"

        fun componentName(context: Context): ComponentName =
            ComponentName(context.applicationContext, EmiDeviceAdminReceiver::class.java)
    }
}
