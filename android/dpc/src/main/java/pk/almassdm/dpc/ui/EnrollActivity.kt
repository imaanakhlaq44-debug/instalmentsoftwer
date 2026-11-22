package pk.almassdm.dpc.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import pk.almassdm.dpc.net.IntakePendingException
import pk.almassdm.dpc.net.IntakeCancelledException
import kotlinx.coroutines.withContext
import pk.almassdm.dpc.BuildConfig
import pk.almassdm.dpc.R
import pk.almassdm.dpc.data.Prefs
import pk.almassdm.dpc.databinding.ActivityEnrollBinding
import pk.almassdm.dpc.net.DpcException
import pk.almassdm.dpc.work.DpcSync

/**
 * Redeems the enrolment code.
 *
 * Two ways in. Normally the shop's QR provisions the phone and the code arrives
 * in the admin extras bundle, in which case this screen redeems it and gets out
 * of the way. The typed form is the fallback for a handset already past setup —
 * it enrolls, but a phone that was not provisioned from the QR is not a device
 * owner, and [StatusActivity] says so rather than letting the shop believe a
 * lock could be applied to it.
 */
class EnrollActivity : AppCompatActivity() {

    private lateinit var binding: ActivityEnrollBinding
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityEnrollBinding.inflate(layoutInflater)
        setContentView(binding.root)
        prefs = Prefs(this)

        binding.serverInput.setText(prefs.serverUrl ?: BuildConfig.DEFAULT_SERVER_URL)
        binding.enrollButton.setOnClickListener {
            enroll(binding.codeInput.text.toString(), binding.serverInput.text.toString())
        }

        // Provisioning left a code behind: redeem it without making the person
        // holding a brand-new phone type anything.
        prefs.pendingEnrollmentToken?.let { code ->
            binding.codeInput.setText(code)
            enroll(code, prefs.serverUrl ?: BuildConfig.DEFAULT_SERVER_URL)
        }
    }

    override fun onResume() {
        super.onResume()
        if (prefs.isEnrolled) goToStatus()
    }

    private fun enroll(code: String, serverUrl: String) {
        if (code.isBlank() || serverUrl.isBlank()) return
        if (!binding.enrollButton.isEnabled) return
        prefs.pendingEnrollmentToken = code.trim()
        prefs.serverUrl = serverUrl.trim()

        setBusy(true)
        binding.enrollStatus.text = getString(R.string.enroll_working)

        lifecycleScope.launch {
          val sync = DpcSync(applicationContext)
          var waitingForSale = false
          while (isActive) {
            val result = withContext(Dispatchers.IO) {
                runCatching { sync.enroll(code, serverUrl.trim()) }
            }

            if (result.exceptionOrNull() is IntakePendingException) {
                waitingForSale = true
                showWaiting(true)
                binding.enrollStatus.text = getString(R.string.enroll_waiting_status)
                delay(5000)
                continue
            }
            if (waitingForSale && (result.exceptionOrNull() as? DpcException)?.retryable == true) {
                binding.enrollStatus.text = getString(R.string.enroll_waiting_retry)
                delay(5000)
                continue
            }

            // Leaving the wait (connected, cancelled or refused): if the form is
            // needed again it must be visible, with the server's reason under it.
            showWaiting(false)
            setBusy(false)
            if (result.exceptionOrNull() is IntakeCancelledException) {
                goToStatus()
                break
            }
            result
                .onSuccess {
                    binding.enrollStatus.text = getString(R.string.enroll_done)
                    goToStatus()
                }
                .onFailure { error ->
                    val message = (error as? DpcException)?.message ?: getString(R.string.error_network)
                    binding.enrollStatus.text = getString(R.string.error_code_invalid, message)
                }
            break
          }
        }
    }

    /**
     * A phone that scanned the shop's QR has nothing to type: it is waiting for
     * the counter to save the sale. Showing the code form during that wait made
     * staff think the phone wanted the code again, so the form is hidden and
     * the screen says plainly what happens next.
     */
    private fun showWaiting(waiting: Boolean) {
        val form = if (waiting) View.GONE else View.VISIBLE
        binding.serverInput.visibility = form
        binding.codeInput.visibility = form
        binding.enrollButton.visibility = form
        binding.waitingSpinner.visibility = if (waiting) View.VISIBLE else View.GONE
        binding.enrollTitle.setText(if (waiting) R.string.enroll_waiting_title else R.string.enroll_title)
        binding.enrollSubtitle.setText(if (waiting) R.string.enroll_waiting_subtitle else R.string.enroll_subtitle)
    }

    private fun setBusy(busy: Boolean) {
        binding.enrollButton.isEnabled = !busy
        binding.codeInput.isEnabled = !busy
        binding.serverInput.isEnabled = !busy
    }

    private fun goToStatus() {
        startActivity(
            Intent(this, StatusActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        )
        finish()
    }
}
