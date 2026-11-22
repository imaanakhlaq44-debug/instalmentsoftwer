package pk.almassdm.dpc.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log

/**
 * The outcome of a self-update install.
 *
 * On success this process is replaced and the new build carries on from
 * [BootReceiver]'s MY_PACKAGE_REPLACED, so only failures land here in practice.
 * A request for user confirmation means the app is not device owner; it is not
 * shown to the customer, it is treated as a failure.
 */
class SelfUpdateResultReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val version = intent.getIntExtra(EXTRA_VERSION, 0)
        if (status == PackageInstaller.STATUS_SUCCESS) {
            Log.i(TAG, "Updated to $version.")
            return
        }
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        Log.w(TAG, "Update to $version not installed (status $status): $message")
        if (version > 0) SelfUpdateWorker.markFailed(context, version)
    }

    companion object {
        private const val TAG = "SelfUpdate"
        const val EXTRA_VERSION = "pk.almassdm.dpc.UPDATE_VERSION"
    }
}
