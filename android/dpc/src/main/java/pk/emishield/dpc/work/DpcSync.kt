package pk.emishield.dpc.work

import android.content.Context
import android.util.Log
import pk.emishield.dpc.BuildConfig
import pk.emishield.dpc.admin.LockController
import pk.emishield.dpc.data.PolicyView
import pk.emishield.dpc.data.Prefs
import pk.emishield.dpc.net.DpcApi
import pk.emishield.dpc.net.DpcException
import pk.emishield.dpc.net.Telemetry

/**
 * One round of the protocol, in one place.
 *
 * The periodic worker, the boot receiver and the "check now" button all run
 * exactly this. Anything that changes the handset's state — applying a lock,
 * lifting one, giving the phone back — happens here and nowhere else, so there
 * is a single description of what a check-in does.
 */
class DpcSync(context: Context) {

    private val appContext = context.applicationContext
    private val prefs = Prefs(appContext)
    private val lockController = LockController(appContext)

    sealed interface Outcome {
        data class Synced(val policy: PolicyView, val commandApplied: String?) : Outcome
        data object NotEnrolled : Outcome
        /** The phone was released: the server no longer manages it. */
        data object Released : Outcome
        data class Failed(val message: String, val retryable: Boolean) : Outcome
    }

    /** Redeems an enrolment code. The device token comes back exactly once, here. */
    @Throws(DpcException::class)
    fun enroll(code: String, serverUrl: String): PolicyView {
        val api = DpcApi(baseUrl = serverUrl)
        val result = api.enroll(
            enrollmentToken = code.trim(),
            deviceId = null,
            dpcVersion = BuildConfig.VERSION_NAME,
        )

        if (result.deviceId.isBlank() || result.deviceToken.isBlank()) {
            throw DpcException("The server did not return device credentials.", retryable = false)
        }

        prefs.serverUrl = serverUrl
        prefs.saveCredentials(result.deviceId, result.deviceToken)
        prefs.checkInIntervalSeconds = result.checkInIntervalSeconds
        prefs.savePolicy(result.policy)
        prefs.lastCheckInAt = System.currentTimeMillis()

        lockController.protectInstallation()
        CheckInScheduler.schedule(appContext, result.checkInIntervalSeconds)

        // A phone can be enrolled while already overdue — the shop re-registers
        // a handset that was reset while behind on payments. Honour that state
        // immediately rather than leaving it open until the first heartbeat.
        if (result.policy.locked) applyAndAcknowledge("LOCK", result.policy)

        return result.policy
    }

    fun syncOnce(): Outcome {
        if (!prefs.isEnrolled) return Outcome.NotEnrolled

        val api = DpcApi(prefs)
        val result = try {
            api.checkIn(Telemetry.collect(appContext))
        } catch (e: DpcException) {
            if (e.statusCode == 403) {
                // "This device is no longer under management." A repossessed or
                // retired handset must be handed back, not held forever by an
                // app whose server has stopped answering for it.
                Log.i(TAG, "Server released this device; unwinding management.")
                lockController.releaseFromManagement()
                prefs.clear()
                CheckInScheduler.cancel(appContext)
                return Outcome.Released
            }
            return Outcome.Failed(e.message ?: "The check-in failed.", e.retryable && !e.isCredentialRejected)
        }

        prefs.savePolicy(result.policy)
        prefs.checkInIntervalSeconds = result.checkInIntervalSeconds
        prefs.lastCheckInAt = System.currentTimeMillis()
        CheckInScheduler.schedule(appContext, result.checkInIntervalSeconds)

        val command = result.command
        if (command != null) {
            val applied = applyAndAcknowledge(command.type, result.policy)
            return Outcome.Synced(result.policy, if (applied) command.type else null)
        }

        reconcile(result.policy)
        return Outcome.Synced(result.policy, null)
    }

    /**
     * Applies a queued command and tells the server the truth about it.
     *
     * The acknowledgement is the only thing that moves the device to LOCKED on
     * the server, so `applied` here must describe the handset and not the
     * intention. A refusal leaves the command queued for the next heartbeat and
     * writes the reason to the device's timeline.
     */
    private fun applyAndAcknowledge(command: String, policy: PolicyView): Boolean {
        val outcome = when (command) {
            "LOCK" -> lockController.applyLock(policy.emergencyCallsAllowed)
            "UNLOCK" -> lockController.releaseLock()
            else -> LockController.Outcome.Refused("This app does not understand the command $command.")
        }

        val applied = outcome is LockController.Outcome.Applied
        val reason = (outcome as? LockController.Outcome.Refused)?.reason

        return try {
            DpcApi(prefs).acknowledge(command, applied, reason)
            if (!applied) Log.w(TAG, "Refused $command: $reason")
            applied
        } catch (e: DpcException) {
            // The restriction is real on the handset; only the report of it was
            // lost. The next check-in still carries the command, and the
            // acknowledgement is repeated then.
            Log.w(TAG, "Could not acknowledge $command: ${e.message}")
            applied
        }
    }

    /**
     * Brings the handset back in line with the policy when no command is queued.
     *
     * This is what heals a phone that was locked, then wiped and re-enrolled, or
     * one whose acknowledgement was lost after the restriction had taken hold.
     */
    private fun reconcile(policy: PolicyView) {
        when {
            policy.locked && !prefs.lockApplied -> applyAndAcknowledgeSilently(policy)
            policy.locked -> lockController.showLockScreen()
            !policy.locked && prefs.lockApplied -> lockController.releaseLock()
        }
    }

    private fun applyAndAcknowledgeSilently(policy: PolicyView) {
        // The server already considers this device LOCKED, so there is no
        // command to acknowledge — just enforcement to catch up on.
        lockController.applyLock(policy.emergencyCallsAllowed)
    }

    companion object {
        private const val TAG = "DpcSync"
    }
}
