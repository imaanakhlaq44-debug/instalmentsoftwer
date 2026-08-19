package pk.emishield.relay

import android.content.Context

/** The relay's own state: where it reports, what it holds, and how it is doing. */
class RelayPrefs(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("emi_shield_relay", Context.MODE_PRIVATE)

    var serverUrl: String?
        get() = prefs.getString(KEY_SERVER, null)
        set(value) = prefs.edit().putString(KEY_SERVER, value).apply()

    /** `<relayId>.<token>` — handed over once, at pairing. */
    var credential: String?
        get() = prefs.getString(KEY_CREDENTIAL, null)
        set(value) = prefs.edit().putString(KEY_CREDENTIAL, value).apply()

    val isPaired: Boolean
        get() = !credential.isNullOrBlank() && !serverUrl.isNullOrBlank()

    /** Whether the shopkeeper has switched sending on. Survives a reboot. */
    var running: Boolean
        get() = prefs.getBoolean(KEY_RUNNING, false)
        set(value) = prefs.edit().putBoolean(KEY_RUNNING, value).apply()

    var lastPollAt: Long
        get() = prefs.getLong(KEY_LAST_POLL, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_POLL, value).apply()

    var sentCount: Int
        get() = prefs.getInt(KEY_SENT, 0)
        set(value) = prefs.edit().putInt(KEY_SENT, value).apply()

    var failedCount: Int
        get() = prefs.getInt(KEY_FAILED, 0)
        set(value) = prefs.edit().putInt(KEY_FAILED, value).apply()

    var lastError: String?
        get() = prefs.getString(KEY_LAST_ERROR, null)
        set(value) = prefs.edit().putString(KEY_LAST_ERROR, value).apply()

    fun unpair() = prefs.edit().clear().apply()

    companion object {
        private const val KEY_SERVER = "server_url"
        private const val KEY_CREDENTIAL = "credential"
        private const val KEY_RUNNING = "running"
        private const val KEY_LAST_POLL = "last_poll"
        private const val KEY_SENT = "sent_count"
        private const val KEY_FAILED = "failed_count"
        private const val KEY_LAST_ERROR = "last_error"
    }
}
