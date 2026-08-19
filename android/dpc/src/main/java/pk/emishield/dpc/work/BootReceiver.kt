package pk.emishield.dpc.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import pk.emishield.dpc.admin.LockController
import pk.emishield.dpc.data.Prefs

/**
 * Restores the restriction across a restart.
 *
 * The lock screen comes back from the last state the phone actually enforced,
 * not from the network — a handset rebooted somewhere with no signal must not
 * come up unrestricted and wait fifteen minutes for the truth. The check-in
 * that follows corrects it if the customer paid while the phone was off.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }

        val prefs = Prefs(context)
        if (!prefs.isEnrolled) return

        if (prefs.lockApplied) {
            LockController(context).applyLock(prefs.cachedPolicy().emergencyCallsAllowed)
        }

        CheckInScheduler.schedule(context, prefs.checkInIntervalSeconds)
        CheckInScheduler.checkNow(context)
    }
}
