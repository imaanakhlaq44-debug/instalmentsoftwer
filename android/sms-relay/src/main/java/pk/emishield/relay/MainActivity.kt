package pk.emishield.relay

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import pk.emishield.relay.databinding.ActivityMainBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The one screen: pair the phone, switch sending on, see what it has done.
 *
 * Everything shown here is the phone's own count, not the server's. A
 * shopkeeper looking at a counter handset should be able to tell whether *this*
 * device is doing its job without going to a dashboard on another machine.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var prefs: RelayPrefs

    private val requestSms = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        render()
    }

    private val requestNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        prefs = RelayPrefs(this)

        binding.serverInput.setText(prefs.serverUrl ?: BuildConfig.DEFAULT_SERVER_URL)
        binding.pairButton.setOnClickListener { pair() }
        binding.permissionButton.setOnClickListener { requestSms.launch(Manifest.permission.SEND_SMS) }
        binding.toggleButton.setOnClickListener { toggle() }
        binding.unpairButton.setOnClickListener { unpair() }
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun pair() {
        val server = binding.serverInput.text.toString().trim()
        val code = binding.codeInput.text.toString().trim()

        if (server.isBlank() || code.isBlank()) return

        // The code is `<relayId>.<token>` exactly as the dashboard printed it.
        // It is not verified here: the first poll is what proves it, and a
        // "paired" screen that lied would be worse than a failed poll.
        if (!code.contains('.')) {
            binding.errorLine.visibility = View.VISIBLE
            binding.errorLine.text = getString(R.string.error_pairing, "The code should look like relay-xxxxxxxx.…")
            return
        }

        prefs.serverUrl = server
        prefs.credential = code
        binding.codeInput.setText("")
        askForNotificationPermission()
        render()
    }

    private fun toggle() {
        if (prefs.running) {
            prefs.running = false
            RelayService.stop(this)
        } else {
            if (!hasSmsPermission()) {
                requestSms.launch(Manifest.permission.SEND_SMS)
                return
            }
            prefs.running = true
            RelayService.start(this)
        }
        render()
    }

    private fun unpair() {
        RelayService.stop(this)
        prefs.unpair()
        binding.serverInput.setText(BuildConfig.DEFAULT_SERVER_URL)
        render()
    }

    private fun render() {
        val paired = prefs.isPaired

        binding.pairingSection.visibility = if (paired) View.GONE else View.VISIBLE
        binding.statusSection.visibility = if (paired) View.VISIBLE else View.GONE
        binding.toggleButton.visibility = if (paired) View.VISIBLE else View.GONE
        binding.unpairButton.visibility = if (paired) View.VISIBLE else View.GONE

        binding.permissionButton.visibility =
            if (paired && !hasSmsPermission()) View.VISIBLE else View.GONE

        if (!paired) return

        binding.runningLine.text =
            getString(if (prefs.running) R.string.status_running else R.string.status_stopped)
        binding.toggleButton.text = getString(if (prefs.running) R.string.stop else R.string.start)
        binding.sentLine.text = getString(R.string.status_sent_count, prefs.sentCount)
        binding.failedLine.text = getString(R.string.status_failed_count, prefs.failedCount)
        binding.lastPollLine.text = getString(R.string.status_last_poll, formatLastPoll())

        val error = if (!hasSmsPermission()) getString(R.string.permission_needed) else prefs.lastError
        binding.errorLine.visibility = if (error.isNullOrBlank()) View.GONE else View.VISIBLE
        binding.errorLine.text = error.orEmpty()
    }

    private fun formatLastPoll(): String {
        val at = prefs.lastPollAt
        if (at <= 0L) return getString(R.string.status_never)
        return SimpleDateFormat("d MMM, h:mm a", Locale.getDefault()).format(Date(at))
    }

    private fun hasSmsPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) ==
            PackageManager.PERMISSION_GRANTED

    private fun askForNotificationPermission() {
        // The service runs in the foreground, and from Android 13 its
        // notification — the thing that makes this app's activity visible to
        // whoever holds the phone — needs permission of its own.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
