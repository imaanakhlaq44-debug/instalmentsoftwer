package pk.emishield.dpc.work

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import pk.emishield.dpc.data.Prefs
import java.util.concurrent.TimeUnit

/** Where the check-in cadence is decided. */
object CheckInScheduler {

    private const val PERIODIC_WORK = "emi-shield-check-in"
    private const val ONE_SHOT_WORK = "emi-shield-check-in-now"

    /**
     * The server names the interval; WorkManager will not honour a periodic job
     * below fifteen minutes, so anything shorter is raised to it rather than
     * silently ignored. The server currently asks for exactly that.
     */
    fun schedule(context: Context, intervalSeconds: Int) {
        val interval = intervalSeconds.coerceAtLeast(Prefs.MIN_INTERVAL_SECONDS).toLong()

        val request = PeriodicWorkRequestBuilder<CheckInWorker>(interval, TimeUnit.SECONDS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 60, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK,
            // KEEP, not UPDATE: every successful check-in calls this, and
            // replacing the job each time would restart its period and let a
            // phone that answers promptly drift out of its own schedule.
            ExistingPeriodicWorkPolicy.KEEP,
            request
        )
    }

    /** A check right now — the "I have paid" button, and the first boot after a restart. */
    fun checkNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<CheckInWorker>()
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(context)
            .enqueueUniqueWork(ONE_SHOT_WORK, ExistingWorkPolicy.REPLACE, request)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK)
        WorkManager.getInstance(context).cancelUniqueWork(ONE_SHOT_WORK)
    }
}
