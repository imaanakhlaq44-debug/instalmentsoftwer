package pk.almassdm.dpc.ui

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.util.Log
import pk.almassdm.dpc.admin.ProvisioningHandoff

/**
 * Android 12+: the setup wizard asks which provisioning mode the app wants.
 *
 * Always "fully managed device" — the only mode in which a phone can be held.
 * If the wizard does not offer it, provisioning is cancelled rather than
 * leaving the shop with a phone that looks registered but cannot be locked.
 * No screen is shown.
 */
// Inlined constants; only the Android 12+ setup wizard starts this activity.
@android.annotation.SuppressLint("InlinedApi")
class ProvisioningModeActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val allowed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            intent?.getIntegerArrayListExtra(DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES)
        } else {
            null
        }
        val mode = ProvisioningHandoff.chooseMode(allowed)

        if (mode == null) {
            Log.w(TAG, "Fully managed mode not offered (allowed: $allowed); cancelling provisioning.")
            setResult(RESULT_CANCELED)
        } else {
            val result = Intent().putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, mode)
            // Pass the shop's extras through unchanged so the compliance step
            // and the device-admin broadcast still receive them.
            ProvisioningHandoff.adminExtras(intent)?.let {
                result.putExtra(DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE, it)
            }
            setResult(RESULT_OK, result)
        }
        finish()
    }

    companion object {
        private const val TAG = "ProvisioningMode"
    }
}
