package pk.almassdm.dpc.work

import android.content.Context
import android.util.Log
import pk.almassdm.dpc.BuildConfig
import pk.almassdm.dpc.admin.AttestationChallenge
import pk.almassdm.dpc.admin.DeviceIntegrityCollector
import pk.almassdm.dpc.admin.KeyAttestor
import pk.almassdm.dpc.admin.LockController
import pk.almassdm.dpc.admin.LocationReporter
import pk.almassdm.dpc.data.PolicyView
import pk.almassdm.dpc.data.Prefs
import pk.almassdm.dpc.net.DpcApi
import pk.almassdm.dpc.net.DpcException
import pk.almassdm.dpc.net.Telemetry

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
        val hardware = DeviceIntegrityCollector.collect(appContext)
        // The secure chip's own word on which phone this is, signed over a
        // challenge bound to this enrollment code.
        val attestation = runCatching {
            KeyAttestor.attest(appContext, AttestationChallenge.forEnrollment(code))
        }.getOrNull()
        val result = api.enroll(
            enrollmentToken = code.trim(),
            deviceId = null,
            dpcVersion = BuildConfig.VERSION_NAME,
            hardware = hardware,
            attestation = attestation,
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
        syncFactoryResetProtection(result.policy)
        syncStagedRestrictions(result.policy)
        val authedApi = DpcApi(prefs)
        val locationReported = answerLocationRequest(authedApi, result.policy)
        if (!locationReported && prefs.frpStatus != null) {
            // Report verified FRP status (ACTIVE / LEGACY / REFUSED / NOT_CONFIGURED)
            // right after enrollment so the counter dashboard sees it without waiting 15 minutes.
            runCatching { authedApi.checkIn(Telemetry.collect(appContext, prefs)) }
                .onFailure { Log.w(TAG, "Post-enroll FRP telemetry check-in failed: ${it.message}") }
        }
        CheckInScheduler.schedule(appContext, result.checkInIntervalSeconds)
        OfflineWatchdogWorker.schedule(appContext)

        // A phone can be enrolled while already overdue — the shop re-registers
        // a handset that was reset while behind on payments. Honour that state
        // immediately rather than leaving it open until the first heartbeat.
        if (result.policy.locked) applyAndAcknowledge("LOCK", result.policy)

        return result.policy
    }

    fun syncOnce(): Outcome {
        if (!prefs.isEnrolled) return Outcome.NotEnrolled

        val api = DpcApi(prefs)
        // Answer an outstanding attestation challenge, if the server sent one.
        val attestation = AttestationChallenge.decode(prefs.attestationChallenge)?.let { challenge ->
            runCatching { KeyAttestor.attest(appContext, challenge) }.getOrNull()
        }
        val result = try {
            api.checkIn(Telemetry.collect(appContext).copy(attestation = attestation))
        } catch (e: DpcException) {
            if (e.statusCode == 403) {
                // "This device is no longer under management." A repossessed or
                // retired handset must be handed back, not held forever by an
                // app whose server has stopped answering for it.
                Log.i(TAG, "Server released this device; unwinding management.")
                lockController.releaseFromManagement()
                prefs.clear()
                prefs.released = true
                CheckInScheduler.cancel(appContext)
                OfflineWatchdogWorker.cancel(appContext)
                return Outcome.Released
            }
            return Outcome.Failed(e.message ?: "The check-in failed.", e.retryable && !e.isCredentialRejected)
        }

        val previousFrpStatus = prefs.frpStatus
        val previousFrpIds = prefs.frpAppliedIds

        prefs.savePolicy(result.policy)
        prefs.checkInIntervalSeconds = result.checkInIntervalSeconds
        prefs.lastCheckInAt = System.currentTimeMillis()
        prefs.attestationChallenge = result.attestationChallenge
        lockController.protectInstallation()
        CheckInScheduler.schedule(appContext, result.checkInIntervalSeconds)
        OfflineWatchdogWorker.schedule(appContext)
        syncFactoryResetProtection(result.policy)
        syncStagedRestrictions(result.policy)
        val frpChanged = prefs.frpStatus != previousFrpStatus || prefs.frpAppliedIds != previousFrpIds

        val command = result.command
        val commandApplied = if (command != null) {
            if (applyAndAcknowledge(command.type, result.policy)) command.type else null
        } else {
            reconcile(result.policy)
            null
        }

        // A recovery request is only ever made for a phone that is already
        // enrolled, so the heartbeat is where it is answered. After the lock,
        // so waiting for a fix never delays a restriction. The report carries
        // the current FRP status too, so it doubles as the FRP follow-up.
        val locationReported = answerLocationRequest(api, result.policy)
        if (!locationReported && frpChanged) {
            runCatching { api.checkIn(Telemetry.collect(appContext, prefs)) }
                .onFailure { Log.w(TAG, "Follow-up FRP telemetry sync failed: ${it.message}") }
        }

        return Outcome.Synced(result.policy, commandApplied)
    }

    /**
     * The shop asked where this phone is, and the server has checked it may.
     * One fix, a notice to the customer, one report; a failure is simply tried
     * again at the next check-in while the request is still open.
     */
    private fun answerLocationRequest(api: DpcApi, policy: PolicyView): Boolean {
        if (!policy.reportLocation) return false
        val reporter = LocationReporter(appContext)
        val fix = reporter.takeFix() ?: return false
        return try {
            api.checkIn(Telemetry.collect(appContext).copy(location = fix))
            reporter.notifyShared()
            true
        } catch (e: DpcException) {
            Log.w(TAG, "Could not report the location: ${e.message}")
            false
        }
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

        // A commanded lock supersedes a self-applied one: from here the shop
        // issued this restriction, and the dashboard should stop describing it
        // as something the handset did on its own.
        if (applied && command == "LOCK") prefs.offlineLockSince = 0L

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

    /**
     * Keeps Factory Reset Protection in line with the accounts the server names.
     * Runs on every check-in; it is a no-op when nothing changed, and a refusal
     * is retried next time rather than blocking the lock protocol.
     */
    private fun syncFactoryResetProtection(policy: PolicyView) {
        val outcome = lockController.applyFactoryResetProtection(policy.frpAccountIds)
        if (outcome is LockController.Outcome.Refused) {
            Log.w(TAG, "Factory Reset Protection not in force: ${outcome.reason}")
        }
    }

    /**
     * Keeps calls/SMS and app suspension at the level the server names. Like
     * FRP, a refusal is logged and retried next check-in; it never blocks the
     * lock protocol.
     */
    private fun syncStagedRestrictions(policy: PolicyView) {
        val outcome = lockController.applyStagedRestrictions(policy.restrictionLevel, policy.restrictedApps)
        if (outcome is LockController.Outcome.Refused) {
            Log.w(TAG, "Staged restrictions not in force: ${outcome.reason}")
        }
    }

    private fun applyAndAcknowledgeSilently(policy: PolicyView) {
        // The server already considers this device LOCKED, so there is no
        // command to acknowledge — just enforcement to catch up on.
        if (lockController.applyLock(policy.emergencyCallsAllowed) is LockController.Outcome.Applied) {
            prefs.offlineLockSince = 0L
        }
    }

    companion object {
        private const val TAG = "DpcSync"
    }
}
