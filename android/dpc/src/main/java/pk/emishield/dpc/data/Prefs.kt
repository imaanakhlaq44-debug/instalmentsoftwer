package pk.emishield.dpc.data

import android.content.Context
import android.content.SharedPreferences

/**
 * The handset's own state.
 *
 * This is ordinary app-private storage, not EncryptedSharedPreferences, and the
 * choice is worth stating. The device token protects the *server* from a forged
 * handset; it grants nothing on the phone itself. On a device this app owns,
 * anything that could read `/data/data/pk.emishield.dpc` has root, and root can
 * read the key an encrypted preference file would be unlocked with anyway. The
 * real protection is on the other side: the server stores only a SHA-256 hash,
 * and re-enrolment rotates the token, so a copy taken off a handset dies the
 * moment the phone is re-provisioned.
 */
class Prefs(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("emi_shield_dpc", Context.MODE_PRIVATE)

    var serverUrl: String?
        get() = prefs.getString(KEY_SERVER_URL, null)
        set(value) = prefs.edit().putString(KEY_SERVER_URL, value).apply()

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        private set(value) = prefs.edit().putString(KEY_DEVICE_ID, value).apply()

    var deviceToken: String?
        get() = prefs.getString(KEY_DEVICE_TOKEN, null)
        private set(value) = prefs.edit().putString(KEY_DEVICE_TOKEN, value).apply()

    /** The enrolment code handed over by provisioning, held until it is redeemed. */
    var pendingEnrollmentToken: String?
        get() = prefs.getString(KEY_ENROLL_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_ENROLL_TOKEN, value).apply()

    val isEnrolled: Boolean
        get() = !deviceId.isNullOrBlank() && !deviceToken.isNullOrBlank()

    /**
     * What the phone last managed to enforce — not what the server last asked
     * for. Boot restores from this, so a phone that was locked before a restart
     * comes back locked without waiting for the network.
     */
    var lockApplied: Boolean
        get() = prefs.getBoolean(KEY_LOCK_APPLIED, false)
        set(value) = prefs.edit().putBoolean(KEY_LOCK_APPLIED, value).apply()

    var checkInIntervalSeconds: Int
        get() = prefs.getInt(KEY_INTERVAL, DEFAULT_INTERVAL_SECONDS)
        set(value) = prefs.edit().putInt(KEY_INTERVAL, value.coerceAtLeast(MIN_INTERVAL_SECONDS)).apply()

    var lastCheckInAt: Long
        get() = prefs.getLong(KEY_LAST_CHECK_IN, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_CHECK_IN, value).apply()

    fun saveCredentials(deviceId: String, deviceToken: String) {
        prefs.edit()
            .putString(KEY_DEVICE_ID, deviceId)
            .putString(KEY_DEVICE_TOKEN, deviceToken)
            .remove(KEY_ENROLL_TOKEN)
            .apply()
    }

    /** The last policy seen, so a restarted phone can render its screen offline. */
    fun savePolicy(policy: PolicyView) {
        prefs.edit()
            .putBoolean(KEY_P_LOCKED, policy.locked)
            .putString(KEY_P_MESSAGE, policy.lockMessage)
            .putBoolean(KEY_P_EMERGENCY, policy.emergencyCallsAllowed)
            .putString(KEY_P_METHODS, policy.paymentMethods.joinToString("|"))
            .putFloat(KEY_P_AMOUNT, policy.amountDue.toFloat())
            .putString(KEY_P_DUE, policy.nextDueDate)
            .putString(KEY_P_DEALER, policy.dealerName)
            .putString(KEY_P_PHONE, policy.dealerPhone)
            .apply()
    }

    fun cachedPolicy(): PolicyView = PolicyView(
        locked = prefs.getBoolean(KEY_P_LOCKED, false),
        lockMessage = prefs.getString(KEY_P_MESSAGE, null),
        emergencyCallsAllowed = prefs.getBoolean(KEY_P_EMERGENCY, true),
        paymentMethods = prefs.getString(KEY_P_METHODS, "")
            .orEmpty().split("|").filter { it.isNotBlank() },
        amountDue = prefs.getFloat(KEY_P_AMOUNT, 0f).toDouble(),
        nextDueDate = prefs.getString(KEY_P_DUE, null),
        dealerName = prefs.getString(KEY_P_DEALER, null),
        dealerPhone = prefs.getString(KEY_P_PHONE, null),
    )

    /** Used when a handset is released from management. */
    fun clear() = prefs.edit().clear().apply()

    companion object {
        const val DEFAULT_INTERVAL_SECONDS = 900

        /**
         * WorkManager will not run a periodic job more often than every 15
         * minutes, so a server asking for less would silently not be honoured.
         */
        const val MIN_INTERVAL_SECONDS = 900

        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_ENROLL_TOKEN = "enrollment_token"
        private const val KEY_LOCK_APPLIED = "lock_applied"
        private const val KEY_INTERVAL = "check_in_interval"
        private const val KEY_LAST_CHECK_IN = "last_check_in"
        private const val KEY_P_LOCKED = "policy_locked"
        private const val KEY_P_MESSAGE = "policy_message"
        private const val KEY_P_EMERGENCY = "policy_emergency"
        private const val KEY_P_METHODS = "policy_methods"
        private const val KEY_P_AMOUNT = "policy_amount"
        private const val KEY_P_DUE = "policy_due"
        private const val KEY_P_DEALER = "policy_dealer"
        private const val KEY_P_PHONE = "policy_phone"
    }
}
