package pk.emishield.relay

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.telephony.SmsManager
import android.util.Log
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import java.util.concurrent.atomic.AtomicInteger

/**
 * Sends one message and waits to find out whether it actually went.
 *
 * `sendTextMessage` returns immediately and tells the caller nothing, so a
 * naive implementation would report every message as sent — including the ones
 * a dead SIM silently swallowed. The server would then show a customer as
 * warned about an overdue payment they were never told about, and a phone would
 * be locked on the strength of it.
 *
 * So each send carries a `PendingIntent` the platform fires with the real
 * outcome, and this waits for it.
 */
class SmsSender(private val context: Context) {

    private val counter = AtomicInteger(0)

    sealed interface Outcome {
        data object Sent : Outcome
        data class Failed(val reason: String) : Outcome
    }

    suspend fun send(to: String, message: String): Outcome {
        val manager = smsManager() ?: return Outcome.Failed("This phone has no SMS service available.")

        // Long messages are split by the carrier's rules, not ours. Every part
        // has to be accepted for the message to count as sent.
        val parts = runCatching { manager.divideMessage(message) }.getOrNull()
            ?: return Outcome.Failed("The message could not be prepared for sending.")

        val token = "part-" + counter.incrementAndGet() + "-" + System.currentTimeMillis()
        val outcomes = ArrayList<CompletableDeferred<Outcome>>(parts.size)
        val intents = ArrayList<PendingIntent>(parts.size)

        val pending = HashMap<String, CompletableDeferred<Outcome>>()
        for (index in parts.indices) {
            val action = ACTION_SENT + "." + token + "." + index
            val deferred = CompletableDeferred<Outcome>()
            outcomes.add(deferred)
            pending[action] = deferred
            intents.add(
                PendingIntent.getBroadcast(
                    context,
                    counter.incrementAndGet(),
                    Intent(action).setPackage(context.packageName),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            )
        }

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val deferred = pending[intent.action] ?: return
                deferred.complete(
                    if (resultCode == Activity.RESULT_OK) Outcome.Sent
                    else Outcome.Failed(describe(resultCode))
                )
            }
        }

        val filter = IntentFilter().apply { pending.keys.forEach { addAction(it) } }
        registerReceiver(receiver, filter)

        return try {
            if (parts.size == 1) {
                manager.sendTextMessage(to, null, parts[0], intents[0], null)
            } else {
                manager.sendMultipartTextMessage(to, null, parts, intents, null)
            }

            withTimeout(SEND_TIMEOUT_MS) {
                val results = outcomes.map { it.await() }
                results.firstOrNull { it is Outcome.Failed } ?: Outcome.Sent
            }
        } catch (e: TimeoutCancellationException) {
            // Unknown, so treated as not sent. The server puts it back on the
            // queue; a duplicate reminder is a far smaller harm than a customer
            // locked out having never been warned.
            Outcome.Failed("The phone did not confirm the message within ${SEND_TIMEOUT_MS / 1000} seconds.")
        } catch (e: SecurityException) {
            Outcome.Failed("Permission to send SMS has not been granted on this phone.")
        } catch (e: Exception) {
            Log.e(TAG, "Send failed", e)
            Outcome.Failed(e.message ?: e.javaClass.simpleName)
        } finally {
            runCatching { context.unregisterReceiver(receiver) }
        }
    }

    @Suppress("DEPRECATION")
    private fun smsManager(): SmsManager? = runCatching {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            SmsManager.getDefault()
        }
    }.getOrNull()

    private fun registerReceiver(receiver: BroadcastReceiver, filter: IntentFilter) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // The sender is the platform itself, so this never needs to be
            // exported — an exported receiver here would let any app on the
            // phone forge a delivery result.
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }
    }

    /** Carrier failures in words a shopkeeper can act on. */
    private fun describe(resultCode: Int): String = when (resultCode) {
        SmsManager.RESULT_ERROR_NO_SERVICE -> "The phone has no network service."
        SmsManager.RESULT_ERROR_RADIO_OFF -> "The phone's radio is switched off (flight mode?)."
        SmsManager.RESULT_ERROR_NULL_PDU -> "The message could not be encoded."
        SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "The network refused the message — check the SIM's balance."
        else -> "The network refused the message (code $resultCode)."
    }

    companion object {
        private const val TAG = "SmsSender"
        private const val ACTION_SENT = "pk.emishield.relay.SMS_SENT"
        private const val SEND_TIMEOUT_MS = 60_000L
    }
}
