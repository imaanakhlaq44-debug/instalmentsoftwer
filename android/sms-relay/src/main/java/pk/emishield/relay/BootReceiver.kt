package pk.emishield.relay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Brings sending back after a restart.
 *
 * Only if the shopkeeper had switched it on. A phone that was deliberately
 * stopped must stay stopped through a reboot, and one that was working must not
 * quietly stay off until somebody notices reminders stopped arriving.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }

        val prefs = RelayPrefs(context)
        if (prefs.isPaired && prefs.running) RelayService.start(context)
    }
}
