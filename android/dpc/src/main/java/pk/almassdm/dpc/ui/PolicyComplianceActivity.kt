package pk.almassdm.dpc.ui

import android.app.Activity
import android.os.Bundle
import pk.almassdm.dpc.admin.ProvisioningHandoff

/**
 * Android 12+: the setup wizard's last call to the app after it became device
 * owner, carrying the QR's admin extras (enrolment code and server address).
 *
 * It hands those to [ProvisioningHandoff], which starts enrolment unless the
 * device-admin broadcast already did, and reports success straight away so
 * the wizard can finish. No screen is shown.
 */
class PolicyComplianceActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ProvisioningHandoff.complete(this, ProvisioningHandoff.adminExtras(intent), "ADMIN_POLICY_COMPLIANCE")
        setResult(RESULT_OK)
        finish()
    }
}
