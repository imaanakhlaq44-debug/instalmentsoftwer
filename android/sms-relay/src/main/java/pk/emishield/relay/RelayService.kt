package pk.emishield.relay

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The loop: ask for messages, send them, report what happened.
 *
 * A foreground service rather than a scheduled job. A payment reminder that the
 * OS batched until four hours later is a reminder that did not do its work, and
 * the persistent notification is the honest arrangement anyway — whoever is
 * holding this phone can see that it is sending messages on the shop's behalf.
 */
class RelayService : Service() {

    private var scope: CoroutineScope? = null
    private var job: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            RelayPrefs(this).running = false
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification())

        if (job?.isActive != true) {
            val newScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            scope = newScope
            job = newScope.launch { loop() }
        }

        // Restarted by the system if it is killed: a counter phone that quietly
        // stopped sending is the failure mode this app exists to avoid.
        return START_STICKY
    }

    override fun onDestroy() {
        scope?.cancel()
        scope = null
        job = null
        super.onDestroy()
    }

    private suspend fun loop() {
        val prefs = RelayPrefs(this)
        val sender = SmsSender(this)

        while (scope?.isActive == true) {
            if (!prefs.isPaired || !prefs.running) {
                stopSelf()
                return
            }

            if (!hasSmsPermission()) {
                // Nothing can be delivered, and saying nothing would leave the
                // dashboard believing this phone is working.
                prefs.lastError = getString(R.string.permission_needed)
                delay(IDLE_DELAY_MS)
                continue
            }

            val interval = try {
                runOnce(prefs, sender)
            } catch (e: RelayException) {
                prefs.lastError = e.message
                if (e.isCredentialRejected) {
                    // The pairing was revoked from the dashboard. Stop rather
                    // than hammer an endpoint that will keep refusing.
                    Log.w(TAG, "Pairing rejected; stopping.")
                    prefs.running = false
                    stopSelf()
                    return
                }
                DEFAULT_INTERVAL_SECONDS
            }

            delay(interval * 1000L)
        }
    }

    /** One round. Returns how many seconds the server wants before the next. */
    private suspend fun runOnce(prefs: RelayPrefs, sender: SmsSender): Int {
        val api = RelayApi(prefs.serverUrl!!, prefs.credential!!)
        val (messages, interval) = api.poll(BATCH_SIZE)

        prefs.lastPollAt = System.currentTimeMillis()
        prefs.lastError = null

        if (messages.isEmpty()) return interval

        val results = mutableListOf<SendResult>()
        for (message in messages) {
            when (val outcome = sender.send(message.to, message.message)) {
                SmsSender.Outcome.Sent -> {
                    prefs.sentCount += 1
                    results.add(SendResult(message.id, sent = true, error = null))
                }
                is SmsSender.Outcome.Failed -> {
                    prefs.failedCount += 1
                    prefs.lastError = outcome.reason
                    results.add(SendResult(message.id, sent = false, error = outcome.reason))
                }
            }
            // Carriers throttle bursts, and a shop's SIM is a consumer SIM.
            delay(BETWEEN_MESSAGES_MS)
        }

        api.report(results)
        updateNotification()
        return interval
    }

    private fun hasSmsPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS) ==
            PackageManager.PERMISSION_GRANTED

    private fun buildNotification(): Notification {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    getString(R.string.notification_channel),
                    NotificationManager.IMPORTANCE_LOW
                )
            )
        }

        val prefs = RelayPrefs(this)
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.status_sent_count, prefs.sentCount))
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }

    private fun updateNotification() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        runCatching { manager.notify(NOTIFICATION_ID, buildNotification()) }
    }

    companion object {
        private const val TAG = "RelayService"
        private const val CHANNEL_ID = "emi-shield-relay"
        private const val NOTIFICATION_ID = 41
        private const val BATCH_SIZE = 10
        private const val DEFAULT_INTERVAL_SECONDS = 60
        private const val IDLE_DELAY_MS = 30_000L

        /** A pause between messages: consumer SIMs are throttled for bursts. */
        private const val BETWEEN_MESSAGES_MS = 1_500L

        const val ACTION_STOP = "pk.emishield.relay.STOP"

        fun start(context: Context) {
            val intent = Intent(context, RelayService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.startService(Intent(context, RelayService::class.java).setAction(ACTION_STOP))
        }
    }
}
