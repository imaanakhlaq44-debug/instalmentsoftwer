package pk.emishield.dpc.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pk.emishield.dpc.R
import pk.emishield.dpc.data.PolicyView
import pk.emishield.dpc.data.Prefs
import pk.emishield.dpc.databinding.ActivityLockBinding
import pk.emishield.dpc.work.DpcSync

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
        enterKioskMode()
        render(prefs.cachedPolicy())
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
        binding.lockMessage.text = policy.lockMessage?.takeIf { it.isNotBlank() }
            ?: getString(R.string.lock_default_message)
        binding.lockAmount.text = Formatting.amount(this, policy.amountDue)
        binding.lockDueDate.text = Formatting.date(policy.nextDueDate)
        binding.lockShop.text = policy.dealerName ?: "—"

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
        const val EXTRA_RELEASE = "pk.emishield.dpc.RELEASE"

        /** Pakistan's single emergency number. */
        private const val EMERGENCY_NUMBER = "15"
    }
}
