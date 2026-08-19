package pk.emishield.dpc.admin

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.UserManager
import android.telecom.TelecomManager
import android.util.Log
import pk.emishield.dpc.data.Prefs
import pk.emishield.dpc.ui.LockActivity

/**
 * Everything that actually restricts the handset.
 *
 * The one rule this class exists to keep: it reports what it managed to do, not
 * what it was asked to do. [Outcome.Refused] travels back to the server as
 * `applied: false`, the command stays queued, and the dashboard keeps showing
 * LOCK_PENDING. A dealer being told "the lock has not reached the phone yet" is
 * recoverable; a dealer telling a customer their phone is restricted when it is
 * not is the failure this whole protocol is shaped around.
 */
class LockController(context: Context) {

    private val appContext = context.applicationContext
    private val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin: ComponentName = EmiDeviceAdminReceiver.componentName(appContext)
    private val prefs = Prefs(appContext)

    sealed interface Outcome {
        /** The restriction is in force on the handset. */
        data object Applied : Outcome

        /** It is not, and this is the reason the shop's support screen will show. */
        data class Refused(val reason: String) : Outcome
    }

    val isDeviceOwner: Boolean
        get() = dpm.isDeviceOwnerApp(appContext.packageName)

    /**
     * Hardening applied once, at enrolment.
     *
     * These are not part of locking — they are what stops the phone being taken
     * out of management before a lock is ever issued. Without them a customer
     * could factory-reset on the first missed payment and keep a financed
     * handset with no way to reach it.
     */
    fun protectInstallation() {
        if (!isDeviceOwner) return
        runCatching {
            dpm.setUninstallBlocked(admin, appContext.packageName, true)
            addRestriction(UserManager.DISALLOW_FACTORY_RESET)
            addRestriction(UserManager.DISALLOW_SAFE_BOOT)
            addRestriction(UserManager.DISALLOW_ADD_USER)
        }.onFailure { Log.w(TAG, "Could not harden the installation: ${it.message}") }
    }

    /** Releases the handset entirely — used when the server says it is no longer managed. */
    fun releaseFromManagement() {
        if (!isDeviceOwner) return
        runCatching {
            releaseLock()
            clearRestriction(UserManager.DISALLOW_FACTORY_RESET)
            clearRestriction(UserManager.DISALLOW_SAFE_BOOT)
            clearRestriction(UserManager.DISALLOW_ADD_USER)
            dpm.setUninstallBlocked(admin, appContext.packageName, false)
        }.onFailure { Log.w(TAG, "Could not release management: ${it.message}") }
    }

    // -----------------------------------------------------------------------
    // LOCK
    // -----------------------------------------------------------------------

    fun applyLock(emergencyCallsAllowed: Boolean): Outcome {
        if (!isDeviceOwner) {
            // The honest answer. An app that is merely installed cannot hold a
            // phone, and saying otherwise would put a false lock on a dashboard.
            return Outcome.Refused(
                "This app does not hold device-owner privileges on the handset, so the restriction " +
                    "cannot be enforced. The phone needs to be re-provisioned from the enrolment QR."
            )
        }

        return try {
            // Only this app — plus the dialer when emergency calls are permitted
            // — may run while the kiosk is in force.
            dpm.setLockTaskPackages(admin, lockTaskPackages(emergencyCallsAllowed))

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                dpm.setLockTaskFeatures(
                    admin,
                    // The power menu stays reachable, and so does the customer's
                    // own keyguard. Restricting a phone is not a reason to take
                    // away the ability to switch it off or to keep a screen lock.
                    DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or
                        DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD or
                        DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO
                )
            }

            // ADB is a way around a kiosk, so it closes for the duration of the
            // lock and reopens when the payment is made.
            addRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES)

            becomeHomeActivity()

            prefs.lockApplied = true
            showLockScreen()
            Outcome.Applied
        } catch (e: SecurityException) {
            Log.e(TAG, "Lock refused by the platform", e)
            Outcome.Refused("The platform refused the restriction: ${e.message ?: "no detail given"}")
        } catch (e: Exception) {
            Log.e(TAG, "Lock failed", e)
            Outcome.Refused("The restriction could not be applied: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    fun releaseLock(): Outcome {
        if (!isDeviceOwner) {
            // Nothing was ever enforced, so there is nothing to undo and the
            // phone is already in the state the server wants it in.
            prefs.lockApplied = false
            dismissLockScreen()
            return Outcome.Applied
        }

        return try {
            surrenderHomeActivity()
            clearRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES)
            runCatching { dpm.setLockTaskPackages(admin, emptyArray()) }

            prefs.lockApplied = false
            dismissLockScreen()
            Outcome.Applied
        } catch (e: Exception) {
            Log.e(TAG, "Unlock failed", e)
            Outcome.Refused("The restriction could not be lifted: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    // -----------------------------------------------------------------------

    fun showLockScreen() {
        appContext.startActivity(
            Intent(appContext, LockActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        )
    }

    private fun dismissLockScreen() {
        // LockActivity is a singleInstance, so this reaches the existing one
        // through onNewIntent rather than starting a second copy.
        appContext.startActivity(
            Intent(appContext, LockActivity::class.java)
                .putExtra(LockActivity.EXTRA_RELEASE, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        )
    }

    /**
     * Makes the lock screen the home activity for as long as the lock lasts.
     *
     * Without this the home button leaves the kiosk on some builds. The alias
     * is disabled again on release so an unlocked phone never offers this app
     * in the launcher chooser.
     */
    private fun becomeHomeActivity() {
        appContext.packageManager.setComponentEnabledSetting(
            homeAlias(),
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            PackageManager.DONT_KILL_APP
        )
        dpm.addPersistentPreferredActivity(admin, homeIntentFilter(), homeAlias())
    }

    private fun surrenderHomeActivity() {
        runCatching { dpm.clearPackagePersistentPreferredActivities(admin, appContext.packageName) }
        appContext.packageManager.setComponentEnabledSetting(
            homeAlias(),
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP
        )
    }

    private fun homeAlias() = ComponentName(appContext.packageName, "pk.emishield.dpc.ui.LockHomeAlias")

    private fun homeIntentFilter() = IntentFilter(Intent.ACTION_MAIN).apply {
        addCategory(Intent.CATEGORY_HOME)
        addCategory(Intent.CATEGORY_DEFAULT)
    }

    private fun lockTaskPackages(emergencyCallsAllowed: Boolean): Array<String> {
        val packages = mutableListOf(appContext.packageName)
        if (emergencyCallsAllowed) {
            val telecom = appContext.getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
            runCatching { telecom?.defaultDialerPackage }
                .getOrNull()
                ?.takeIf { it.isNotBlank() }
                ?.let { packages.add(it) }
        }
        return packages.toTypedArray()
    }

    private fun addRestriction(restriction: String) {
        runCatching { dpm.addUserRestriction(admin, restriction) }
            .onFailure { Log.w(TAG, "Could not set $restriction: ${it.message}") }
    }

    private fun clearRestriction(restriction: String) {
        runCatching { dpm.clearUserRestriction(admin, restriction) }
            .onFailure { Log.w(TAG, "Could not clear $restriction: ${it.message}") }
    }

    companion object {
        private const val TAG = "LockController"
    }
}
