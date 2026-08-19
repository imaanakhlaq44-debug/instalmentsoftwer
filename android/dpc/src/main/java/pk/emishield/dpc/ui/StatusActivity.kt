package pk.emishield.dpc.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pk.emishield.dpc.R
import pk.emishield.dpc.admin.LockController
import pk.emishield.dpc.data.PolicyView
import pk.emishield.dpc.data.Prefs
import pk.emishield.dpc.databinding.ActivityStatusBinding
import pk.emishield.dpc.work.DpcSync

/**
 * What the customer sees while nothing is wrong.
 *
 * It exists so the app is not a black box on a phone somebody paid for: what is
 * owed, when the next payment falls due, when the shop was last in contact, and
 * a button to talk to them. Everything on it comes from the same policy the
 * lock screen would use.
 */
class StatusActivity : AppCompatActivity() {

    private lateinit var binding: ActivityStatusBinding
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityStatusBinding.inflate(layoutInflater)
        setContentView(binding.root)
        prefs = Prefs(this)

        binding.checkNowButton.setOnClickListener { checkNow() }
        binding.callShopButton.setOnClickListener {
            val phone = prefs.cachedPolicy().dealerPhone
            if (!phone.isNullOrBlank()) {
                runCatching { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$phone"))) }
            }
        }
    }

    override fun onResume() {
        super.onResume()

        if (!prefs.isEnrolled) {
            startActivity(Intent(this, EnrollActivity::class.java))
            finish()
            return
        }

        // A restricted phone belongs on the lock screen, not here.
        if (prefs.lockApplied) {
            LockController(this).showLockScreen()
            finish()
            return
        }

        render(prefs.cachedPolicy())
    }

    private fun render(policy: PolicyView) {
        binding.statusLine.text = getString(R.string.status_registered)
        binding.amountDue.text = if (policy.amountDue <= 0.0) {
            getString(R.string.status_no_dues)
        } else {
            Formatting.amount(this, policy.amountDue)
        }
        binding.nextDue.text = Formatting.date(policy.nextDueDate)
        binding.shopName.text = policy.dealerName ?: "—"
        binding.lastCheckIn.text =
            Formatting.timestamp(prefs.lastCheckInAt) ?: getString(R.string.status_never)

        binding.callShopButton.visibility =
            if (policy.dealerPhone.isNullOrBlank()) View.GONE else View.VISIBLE

        // An enrolled phone where the app is not the device owner can be shown
        // a lock it will never be able to apply. Saying so here means the
        // customer and the shop find out before a payment is missed, rather
        // than at the moment the restriction was supposed to take hold.
        binding.ownerWarning.visibility =
            if (LockController(this).isDeviceOwner) View.GONE else View.VISIBLE
    }

    private fun checkNow() {
        binding.checkNowButton.isEnabled = false
        binding.statusLine.text = getString(R.string.status_checking)

        lifecycleScope.launch {
            val outcome = withContext(Dispatchers.IO) { DpcSync(applicationContext).syncOnce() }
            binding.checkNowButton.isEnabled = true

            when (outcome) {
                is DpcSync.Outcome.Synced -> {
                    if (prefs.lockApplied) {
                        LockController(this@StatusActivity).showLockScreen()
                        finish()
                    } else {
                        render(outcome.policy)
                    }
                }
                is DpcSync.Outcome.Failed -> binding.statusLine.text = getString(R.string.error_network)
                DpcSync.Outcome.Released, DpcSync.Outcome.NotEnrolled -> {
                    startActivity(Intent(this@StatusActivity, EnrollActivity::class.java))
                    finish()
                }
            }
        }
    }
}
