package pk.emishield.dpc.work

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The heartbeat. Everything it does lives in [DpcSync]; this only schedules and retries it. */
class CheckInWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        when (val outcome = DpcSync(applicationContext).syncOnce()) {
            is DpcSync.Outcome.Synced -> Result.success()

            // Nothing to do and nothing to retry: an unenrolled or released
            // handset is not a failure, it is simply not this app's business.
            DpcSync.Outcome.NotEnrolled, DpcSync.Outcome.Released -> Result.success()

            is DpcSync.Outcome.Failed -> {
                Log.w(TAG, "Check-in failed: ${outcome.message}")
                // A rejected credential retried on WorkManager's backoff would
                // be pointless traffic from a phone that needs re-enrolment.
                if (outcome.retryable) Result.retry() else Result.success()
            }
        }
    }

    companion object {
        private const val TAG = "CheckInWorker"
    }
}
