package pk.almassdm.dpc.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pk.almassdm.dpc.R
import pk.almassdm.dpc.admin.LockController
import pk.almassdm.dpc.admin.OfflineUnlock
import pk.almassdm.dpc.data.PolicyView
import pk.almassdm.dpc.data.Prefs
import pk.almassdm.dpc.databinding.ActivityLockBinding
import pk.almassdm.dpc.work.DpcSync

/**
 * What the customer sees while the handset is restricted.
 *
 * The figures are the ones the server sent, unaltered. A screen that is holding
 * someone's phone has to be able to justify itself: what is owed, when it was
 * due, who to pay, and a way to reach them. Inventing or rounding any of that
 * would make this a threat rather than a notice.
 */
class LockActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLockBinding
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLockBinding.inflate(layoutInflater)
        setContentView(binding.root)
        prefs = Prefs(this)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }

        // The back key must not leave the lock screen. This is the whole point
        // of the activity, so it is refused rather than merely discouraged.
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = Unit
        })

        binding.callShopButton.setOnClickListener { dial(prefs.cachedPolicy().dealerPhone) }
        binding.emergencyButton.setOnClickListener { dial(EMERGENCY_NUMBER) }
        binding.refreshButton.setOnClickListener { checkNow() }
        binding.internetButton.setOnClickListener { openInternetSettings() }
        binding.unlockCodeButton.setOnClickListener { tryOfflineUnlock() }

        if (handleRelease(intent)) return
        render(prefs.cachedPolicy())
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (handleRelease(intent)) return
        render(prefs.cachedPolicy())
    }

    override fun onResume() {
        super.onResume()
        // A lock that is no longer in force must not keep the screen.
        if (!prefs.lockApplied) {
            leave()
            return
        }
        // Back from the internet panel (or never left): settings leave the kiosk again.
        LockController(this).closeConnectivitySettings(prefs.cachedPolicy().emergencyCallsAllowed)
        enterKioskMode()
        render(prefs.cachedPolicy())
    }

    /**
     * Opens Wi-Fi / mobile data / airplane mode. Without this a phone that was
     * locked with its data off can never hear the unlock.
     */
    private fun openInternetSettings() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY)
        } else {
            Intent(Settings.ACTION_WIRELESS_SETTINGS)
        }
        val settingsPackage = packageManager.resolveActivity(intent, 0)?.activityInfo?.packageName
        if (settingsPackage.isNullOrBlank()) {
            binding.lockStatusLine.text = getString(R.string.lock_internet_unavailable)
            return
        }
        val emergency = prefs.cachedPolicy().emergencyCallsAllowed
        if (!LockController(this).openConnectivitySettings(settingsPackage, emergency)) {
            binding.lockStatusLine.text = getString(R.string.lock_internet_unavailable)
            return
        }
        runCatching { startActivity(intent) }.onFailure {
            LockController(this).closeConnectivitySettings(emergency)
            binding.lockStatusLine.text = getString(R.string.lock_internet_unavailable)
        }
    }

    /** Checks a code the shop read out, with no network. See [OfflineUnlock]. */
    private fun tryOfflineUnlock() {
        val now = System.currentTimeMillis()
        if (!OfflineUnlock.attemptAllowed(prefs.unlockBlockedUntil, now)) {
            binding.lockStatusLine.text = getString(R.string.lock_unlock_code_blocked)
            return
        }
        val deviceId = prefs.deviceId
        val token = prefs.deviceToken
        if (deviceId.isNullOrBlank() || token.isNullOrBlank()) return

        val entered = binding.unlockCodeInput.text?.toString().orEmpty()
        if (!OfflineUnlock.matches(entered, token, deviceId, prefs.offlineUnlockChallenge())) {
            val (failures, blockedUntil) = OfflineUnlock.afterFailure(prefs.unlockFailures, now)
            prefs.unlockFailures = failures
            prefs.unlockBlockedUntil = blockedUntil
            binding.unlockCodeInput.text?.clear()
            binding.lockStatusLine.text = getString(
                if (blockedUntil > 0L) R.string.lock_unlock_code_blocked else R.string.lock_unlock_code_wrong
            )
            return
        }

        // A code works once: the next lock shows a new phone code.
        prefs.unlockFailures = 0
        prefs.renewOfflineUnlockChallenge()
        prefs.offlineUnlockAt = now
        binding.unlockCodeInput.text?.clear()
        when (val outcome = LockController(this).releaseLock()) {
            is LockController.Outcome.Applied -> Unit // the release intent closes this screen
            is LockController.Outcome.Refused -> binding.lockStatusLine.text = outcome.reason
        }
    }

    /** Returns true when the activity is finishing because the lock was lifted. */
    private fun handleRelease(intent: Intent?): Boolean {
        if (intent?.getBooleanExtra(EXTRA_RELEASE, false) != true) return false
        leave()
        return true
    }

    private fun leave() {
        runCatching { stopLockTask() }
        finishAndRemoveTask()
    }

    private fun enterKioskMode() {
        // Only a device owner may pin without a confirmation dialog. When the
        // app is merely installed this throws, the phone is not really held,
        // and the server was already told so with `applied: false`.
        runCatching { startLockTask() }
    }

    private fun render(policy: PolicyView) {
        /*
         * A self-lock says so. The server sends no lock message for one — it
         * did not issue the restriction and has probably not heard of it yet —
         * and the default text ("the phone will unlock as soon as the payment is
         * recorded") would be wrong here: recording the payment is not enough
         * on its own, the handset also has to reach the shop's system again.
         * Somebody standing in front of a locked phone needs to be told the
         * thing that will actually get it back.
         */
        binding.lockMessage.text = when {
            prefs.offlineLockActive -> getString(R.string.lock_offline_message)
            !policy.lockMessage.isNullOrBlank() -> policy.lockMessage
            else -> getString(R.string.lock_default_message)
        }
        binding.lockAmount.text = Formatting.amount(this, policy.amountDue)
        binding.lockDueDate.text = Formatting.date(policy.nextDueDate)
        binding.lockShop.text = policy.dealerName ?: "—"
        binding.lockPhoneCode.text =
            getString(R.string.lock_phone_code, OfflineUnlock.display(prefs.offlineUnlockChallenge()))

        binding.lockMethods.text = if (policy.paymentMethods.isEmpty()) {
            ""
        } else {
            getString(R.string.lock_methods, policy.paymentMethods.joinToString(", "))
        }
        binding.lockMethods.visibility =
            if (policy.paymentMethods.isEmpty()) View.GONE else View.VISIBLE

        binding.callShopButton.visibility =
            if (policy.dealerPhone.isNullOrBlank()) View.GONE else View.VISIBLE

        // An emergency call is not something a finance app gets to withhold on
        // its own; it is shown whenever the dealer's policy permits it, and the
        // dialer is whitelisted in the kiosk so the button actually works.
        binding.emergencyButton.visibility =
            if (policy.emergencyCallsAllowed) View.VISIBLE else View.GONE
    }

    private fun checkNow() {
        binding.refreshButton.isEnabled = false
        binding.lockStatusLine.text = getString(R.string.lock_checking)

        lifecycleScope.launch {
            val outcome = withContext(Dispatchers.IO) { DpcSync(applicationContext).syncOnce() }

            if (!prefs.lockApplied) {
                leave()
                return@launch
            }

            binding.refreshButton.isEnabled = true
            binding.lockStatusLine.text = when (outcome) {
                is DpcSync.Outcome.Synced -> {
                    render(outcome.policy)
                    getString(R.string.lock_still_locked)
                }
                is DpcSync.Outcome.Failed -> getString(R.string.error_network)
                else -> ""
            }
        }
    }

    private fun dial(number: String?) {
        if (number.isNullOrBlank()) return
        runCatching {
            startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + number.trim())))
        }.onFailure { error ->
            if (error is ActivityNotFoundException) {
                binding.lockStatusLine.text = number
            }
        }
    }

    companion object {
        const val EXTRA_RELEASE = "pk.almassdm.dpc.RELEASE"

        /** Pakistan's single emergency number. */
        private const val EMERGENCY_NUMBER = "15"
    }
}
