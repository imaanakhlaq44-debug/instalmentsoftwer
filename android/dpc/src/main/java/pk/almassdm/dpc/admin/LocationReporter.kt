package pk.almassdm.dpc.admin

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.HandlerThread
import android.util.Log
import androidx.core.app.NotificationCompat
import pk.almassdm.dpc.R
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** One location fix, as reported to the server. */
data class LocationFix(val lat: Double, val lng: Double, val accuracy: Float?, val capturedAt: Long)

/**
 * Takes one location fix, only when the server has asked for it.
 *
 * The server asks only for a phone that is locked or overdue, whose customer
 * signed an agreement allowing it, and only when a shop owner requested it.
 * This class keeps the phone's side of that bargain:
 *
 *  - the location permission is granted for this one fix and taken away again
 *    straight after, so the app cannot read location at any other time;
 *  - the customer is shown a notice every time a location is shared;
 *  - nothing here runs in the background on its own. It is called from a
 *    check-in, and only when the policy says `reportLocation`.
 */
class LocationReporter(context: Context) {

    private val appContext = context.applicationContext
    private val dpm = appContext.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = AlmasDeviceAdminReceiver.componentName(appContext)
    private val locationManager = appContext.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    private val isDeviceOwner: Boolean
        get() = dpm.isDeviceOwnerApp(appContext.packageName)

    /** A fix, or null when the phone could not get one in time. */
    fun takeFix(): LocationFix? {
        if (!isDeviceOwner) return null
        setLocationPermission(DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)

        // Location switched off in quick settings would make every request
        // fail. Turned on for the fix and put back as it was afterwards.
        val turnedOn = ensureLocationOn()
        return try {
            readFix()
        } catch (e: SecurityException) {
            Log.w(TAG, "Location permission was not granted: ${e.message}")
            null
        } finally {
            if (turnedOn) setLocationEnabled(false)
            setLocationPermission(DevicePolicyManager.PERMISSION_GRANT_STATE_DENIED)
        }
    }

    /** Tells the customer, every time. */
    fun notifyShared() {
        if (!isDeviceOwner) return
        if (Build.VERSION.SDK_INT >= 33) {
            runCatching {
                dpm.setPermissionGrantState(
                    admin, appContext.packageName, Manifest.permission.POST_NOTIFICATIONS,
                    DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
                )
            }
        }
        val manager = appContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    appContext.getString(R.string.location_channel),
                    NotificationManager.IMPORTANCE_HIGH,
                )
            )
        }
        val notification = NotificationCompat.Builder(appContext, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_shield)
            .setContentTitle(appContext.getString(R.string.location_shared_title))
            .setContentText(appContext.getString(R.string.location_shared_body))
            .setStyle(NotificationCompat.BigTextStyle().bigText(appContext.getString(R.string.location_shared_body)))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        runCatching { manager.notify(NOTIFICATION_ID, notification) }
            .onFailure { Log.w(TAG, "Could not show the location notice: ${it.message}") }
    }

    // -----------------------------------------------------------------------

    @Suppress("MissingPermission") // granted just above, by the device owner
    private fun readFix(): LocationFix? {
        val providers = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .filter { runCatching { locationManager.isProviderEnabled(it) }.getOrDefault(false) }

        for (provider in providers) {
            current(provider)?.let { return it.toFix() }
        }

        // A recent last-known fix is better than none for finding a phone.
        val recent = providers
            .mapNotNull { runCatching { locationManager.getLastKnownLocation(it) }.getOrNull() }
            .filter { System.currentTimeMillis() - it.time < MAX_LAST_KNOWN_AGE_MS }
            .maxByOrNull { it.time }
        return recent?.toFix()
    }

    @Suppress("MissingPermission", "DEPRECATION")
    private fun current(provider: String): Location? {
        val latch = CountDownLatch(1)
        var result: Location? = null

        if (Build.VERSION.SDK_INT >= 30) {
            val executor = Executors.newSingleThreadExecutor()
            try {
                locationManager.getCurrentLocation(provider, null, executor) { location ->
                    result = location
                    latch.countDown()
                }
                latch.await(FIX_TIMEOUT_SECONDS, TimeUnit.SECONDS)
            } finally {
                executor.shutdown()
            }
            return result
        }

        val thread = HandlerThread("almas-location").apply { start() }
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                result = location
                latch.countDown()
            }
        }
        try {
            locationManager.requestSingleUpdate(provider, listener, thread.looper)
            latch.await(FIX_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } finally {
            runCatching { locationManager.removeUpdates(listener) }
            thread.quitSafely()
        }
        return result
    }

    private fun Location.toFix() =
        LocationFix(latitude, longitude, if (hasAccuracy()) accuracy else null, time.takeIf { it > 0 } ?: System.currentTimeMillis())

    private fun setLocationPermission(state: Int) {
        for (permission in listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)) {
            runCatching { dpm.setPermissionGrantState(admin, appContext.packageName, permission, state) }
                .onFailure { Log.w(TAG, "Could not set $permission: ${it.message}") }
        }
    }

    private fun ensureLocationOn(): Boolean {
        if (Build.VERSION.SDK_INT < 30) return false
        val on = runCatching { locationManager.isLocationEnabled }.getOrDefault(true)
        if (on) return false
        return setLocationEnabled(true)
    }

    private fun setLocationEnabled(enabled: Boolean): Boolean {
        if (Build.VERSION.SDK_INT < 30) return false
        return runCatching { dpm.setLocationEnabled(admin, enabled); true }
            .onFailure { Log.w(TAG, "Could not switch location ${if (enabled) "on" else "off"}: ${it.message}") }
            .getOrDefault(false)
    }

    companion object {
        private const val TAG = "LocationReporter"
        private const val CHANNEL_ID = "location_shared"
        private const val NOTIFICATION_ID = 4107
        private const val FIX_TIMEOUT_SECONDS = 30L
        private const val MAX_LAST_KNOWN_AGE_MS = 30 * 60 * 1000L
    }
}
