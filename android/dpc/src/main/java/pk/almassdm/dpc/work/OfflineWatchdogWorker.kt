package pk.almassdm.dpc.work

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import pk.almassdm.dpc.admin.LockController
import pk.almassdm.dpc.data.Prefs
import java.util.concurrent.TimeUnit

/**
 * The job that runs when there is no network.
 *
 * [CheckInWorker] is deliberately constrained to `NetworkType.CONNECTED`, which
 * is right for a heartbeat — waking a phone every fifteen minutes to fail a
 * connection would spend a customer's battery for nothing. But it also means
 * that the one situation the offline rule is about is the one situation the
 * heartbeat never runs in. So the rule gets its own job, with no constraints
 * and a long period.
 *
 * It never contacts anything. It reads the cached policy, asks
 * [OfflineLockRule], and applies the restriction if the answer is yes. Telling
 * the server happens later, on the check-in that follows the phone coming back.
 */
class OfflineWatchdogWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = Prefs(applicationContext)
        if (!prefs.isEnrolled) return@withContext Result.success()

        // Already restricted, by whatever route. Nothing for this job to add:
        // a lock that is in force is in force.
        if (prefs.lockApplied) return@withContext Result.success()

        val policy = prefs.cachedPolicy()
        if (!OfflineLockRule.shouldSelfLock(policy, prefs.lastCheckInAt)) {
            return@withContext Result.success()
        }

        val days = OfflineLockRule.daysOutOfContact(prefs.lastCheckInAt)
        Log.i(TAG, "No contact for $days day(s) with an installment past due; restricting the handset.")

        // The same honesty rule as everywhere else: `offlineLockSince` is only
        // stamped if the restriction actually took hold. An installation that is
        // not device owner cannot hold the phone, and must not record that it
        // did — the shop would be told about a lock that does not exist.
        when (val outcome = LockController(applicationContext).applyLock(policy.emergencyCallsAllowed)) {
            is LockController.Outcome.Applied -> prefs.offlineLockSince = System.currentTimeMillis()
            is LockController.Outcome.Refused -> Log.w(TAG, "Offline lock refused: ${outcome.reason}")
        }

        Result.success()
    }

    companion object {
        private const val TAG = "OfflineWatchdog"
        private const val WORK_NAME = "almas-sdm-offline-watchdog"

        /**
         * Six hours, unconstrained.
         *
         * The rule is measured in days, so a shorter period would buy nothing
         * but wakeups; a longer one would let a phone that has passed its limit
         * stay open most of a day past it. Six hours also means the check
         * happens a few times between one due date and the next, whatever hours
         * the handset is switched on for.
         */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<OfflineWatchdogWorker>(6, TimeUnit.HOURS)
                .setBackoffCriteria(BackoffPolicy.LINEAR, 15, TimeUnit.MINUTES)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                // KEEP for the same reason the heartbeat uses it: this is called
                // on every enrolment, boot and successful check-in, and UPDATE
                // would restart the period each time so the job never fired on
                // a phone that talks to the server regularly.
                ExistingPeriodicWorkPolicy.KEEP,
                request
            )
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        }
    }
}
