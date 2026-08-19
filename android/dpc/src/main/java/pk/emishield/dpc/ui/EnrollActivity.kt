package pk.emishield.dpc.ui

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import pk.emishield.dpc.BuildConfig
import pk.emishield.dpc.R
import pk.emishield.dpc.data.Prefs
import pk.emishield.dpc.databinding.ActivityEnrollBinding
import pk.emishield.dpc.net.DpcException
import pk.emishield.dpc.work.DpcSync

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

        setBusy(true)
        binding.enrollStatus.text = getString(R.string.enroll_working)

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { DpcSync(applicationContext).enroll(code, serverUrl.trim()) }
            }

            setBusy(false)
            result
                .onSuccess {
                    binding.enrollStatus.text = getString(R.string.enroll_done)
                    goToStatus()
                }
                .onFailure { error ->
                    val message = (error as? DpcException)?.message ?: getString(R.string.error_network)
                    binding.enrollStatus.text = getString(R.string.error_code_invalid, message)
                }
        }
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
