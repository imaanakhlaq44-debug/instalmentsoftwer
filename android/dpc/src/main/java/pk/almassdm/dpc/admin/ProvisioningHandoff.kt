package pk.almassdm.dpc.admin

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PersistableBundle
import android.util.Log
import pk.almassdm.dpc.data.Prefs
import pk.almassdm.dpc.ui.EnrollActivity

/**
 * The end of QR provisioning, whichever way Android reports it.
 *
 * Up to Android 11 the setup wizard only sends PROFILE_PROVISIONING_COMPLETE
 * to [AlmasDeviceAdminReceiver]. From Android 12 the "admin-integrated" flow
 * also asks the DPC which mode it wants (GET_PROVISIONING_MODE, see
 * [pk.almassdm.dpc.ui.ProvisioningModeActivity]) and then hands it the admin
 * extras in ADMIN_POLICY_COMPLIANCE
 * ([pk.almassdm.dpc.ui.PolicyComplianceActivity]). Depending on the build,
 * one or both of these arrive, so each calls [complete] and only the first
 * one for a given enrolment code starts enrolment.
 */
object ProvisioningHandoff {

    private const val TAG = "ProvisioningHandoff"

    /**
     * The only mode this app can work in. A work profile cannot hold the
     * phone, so it is never chosen even when offered.
     */
    // The constant is inlined at compile time; only the Android 12+ wizard calls this.
    @android.annotation.SuppressLint("InlinedApi")
    fun chooseMode(allowedModes: List<Int>?): Int? {
        val fullyManaged = DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
        // No list means a build that does not restrict the choice.
        if (allowedModes.isNullOrEmpty()) return fullyManaged
        return if (fullyManaged in allowedModes) fullyManaged else null
    }

    /** Whether this report of "provisioning done" should start enrolment. */
    fun shouldStartEnrollment(isEnrolled: Boolean, handedOffToken: String?, token: String?): Boolean {
        if (isEnrolled) return false
        // No code means the typed fallback: open the screen, once.
        return handedOffToken == null || handedOffToken != (token ?: "")
    }

    fun complete(context: Context, extras: PersistableBundle?, source: String) {
        val prefs = Prefs(context)
        val token = extras?.getString(AlmasDeviceAdminReceiver.EXTRA_ENROLLMENT_TOKEN)?.takeIf { it.isNotBlank() }
        token?.let { prefs.pendingEnrollmentToken = it }
        extras?.getString(AlmasDeviceAdminReceiver.EXTRA_SERVER_URL)?.takeIf { it.isNotBlank() }?.let {
            prefs.serverUrl = it
        }

        if (!shouldStartEnrollment(prefs.isEnrolled, prefs.provisioningHandedOff, token)) {
            Log.i(TAG, "$source: enrolment already started for this code; nothing to do.")
            return
        }
        prefs.provisioningHandedOff = token ?: ""
        Log.i(TAG, "$source: provisioning complete; enrolment code present: ${token != null}")

        // The phone is still in the setup wizard, so enrolment is launched
        // rather than performed here.
        context.startActivity(
            Intent(context, EnrollActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        )
    }

    @Suppress("DEPRECATION")
    fun adminExtras(intent: Intent?): PersistableBundle? {
        if (intent == null) return null
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(
                DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE,
                PersistableBundle::class.java
            )
        } else {
            intent.getParcelableExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE)
        }
    }
}
