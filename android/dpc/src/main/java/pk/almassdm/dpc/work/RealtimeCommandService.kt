package pk.almassdm.dpc.work

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import android.net.ConnectivityManager
import android.net.Network
import pk.almassdm.dpc.R
import pk.almassdm.dpc.admin.LockController
import pk.almassdm.dpc.data.Prefs
import pk.almassdm.dpc.net.DpcApi
import pk.almassdm.dpc.ui.StatusActivity

/** Visible live connection for enrolled, company-managed phones only. */
class RealtimeCommandService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loop: Job? = null
    private val networkChanges = Channel<Unit>(Channel.CONFLATED)
    private val connectivity by lazy { getSystemService(ConnectivityManager::class.java) }
    private val networkCallback = object : ConnectivityManager.NetworkCallback() { override fun onAvailable(network: Network) { networkChanges.trySend(Unit) } }
    override fun onCreate() { super.onCreate(); runCatching { connectivity.registerDefaultNetworkCallback(networkCallback) } }
    private suspend fun retryAfter(ms: Long) { withTimeoutOrNull(ms) { networkChanges.receive() } }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = Prefs(this)
        if (!prefs.isEnrolled || !LockController(this).isDeviceOwner) { stopSelf(); return START_NOT_STICKY }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("managed_connection", "Phone management connection", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, StatusActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notice = NotificationCompat.Builder(this,"managed_connection").setSmallIcon(R.drawable.ic_shield)
            .setContentTitle("Almas SDM").setContentText("Receiving agreed phone-management commands").setContentIntent(open).setOngoing(true).setSilent(true).build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(1701,notice,ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED) else startForeground(1701,notice)
        if (loop?.isActive != true) loop = scope.launch {
            var state = ""
            var lastSync = 0L
            var backoff = 2000L
            while (isActive && prefs.isEnrolled) {
                try {
                    val next = DpcApi(prefs).waitForCommand(state)
                    ensureActive()
                    if (next != state || android.os.SystemClock.elapsedRealtime() - lastSync > 300000) {
                        val result = DpcSync(this@RealtimeCommandService).syncOnce()
                        if (result is DpcSync.Outcome.Released || result is DpcSync.Outcome.NotEnrolled) break
                        if (result is DpcSync.Outcome.Failed) { if (!result.retryable) break; retryAfter(backoff); backoff = (backoff * 2).coerceAtMost(60000); continue }
                        lastSync = android.os.SystemClock.elapsedRealtime()
                    }
                    state = next; backoff = 2000L
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (error: Exception) {
                    if (error is pk.almassdm.dpc.net.DpcException) {
                        if (error.statusCode == 403) { DpcSync(this@RealtimeCommandService).syncOnce(); break }
                        if (!error.retryable) break
                    }
                    retryAfter(backoff); backoff = (backoff * 2).coerceAtMost(60000) }
            }
            stopSelf()
        }
        return START_STICKY
    }
    override fun onDestroy() { scope.cancel(); runCatching { connectivity.unregisterNetworkCallback(networkCallback) }; networkChanges.close(); super.onDestroy() }
    companion object {
        fun ensureStarted(context: Context) {
            if (!Prefs(context).isEnrolled || !LockController(context).isDeviceOwner) return
            runCatching { ContextCompat.startForegroundService(context,Intent(context,RealtimeCommandService::class.java)) }
        }
    }
}

