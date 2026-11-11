package pk.almassdm.dpc.admin

import org.json.JSONObject

/**
 * The decision half of Factory Reset Protection, kept free of Android types so
 * it can be tested on the JVM.
 *
 * `DISALLOW_FACTORY_RESET` only closes the Settings path. A customer who holds
 * power + volume and picks "Wipe data/factory reset" in recovery erases the
 * phone anyway, and device-owner status goes with it. FRP is what survives that
 * wipe: the setup wizard then refuses to finish until one of the dealer's
 * Google accounts signs in, so the handset comes back to the shop instead of
 * leaving with the customer.
 *
 * Nothing here blocks the power menu, recovery itself or emergency calls; it
 * only decides who may finish setting the phone up again afterwards.
 *
 * [LockController] does the platform calls; this object decides which call is
 * due, so the 15-minute heartbeat re-applies only when something changed.
 */
object FactoryResetProtection {

    /** `DevicePolicyManager.setFactoryResetProtectionPolicy` arrived in Android 11. */
    const val MODERN_API_LEVEL = 30

    /** Below API 30 FRP is configured through Play services' managed configuration. */
    const val GMS_PACKAGE = "com.google.android.gms"
    const val LEGACY_RESTRICTION_KEY = "factoryResetProtectionAdmin"
    const val LEGACY_CHANGED_ACTION = "com.google.android.gms.auth.FRP_CONFIG_CHANGED"

    /** How the policy reaches the platform. Part of the fingerprint, so an OS upgrade re-applies it. */
    enum class Route { MODERN, LEGACY }

    /** Live verification status reported back to the dealership dashboard. */
    enum class VerificationStatus { ACTIVE, LEGACY, REFUSED, NOT_CONFIGURED }

    data class FrpReport(
        val status: VerificationStatus,
        val detail: String? = null,
        val verifiedAccountsCount: Int = 0,
    ) {
        fun toJson(): JSONObject {
            val json = JSONObject()
                .put("status", status.name)
                .put("verifiedAccountsCount", verifiedAccountsCount)
            detail?.takeIf { it.isNotBlank() }?.let { json.put("detail", it.take(300)) }
            return json
        }
    }

    sealed interface Step {
        /** The handset already holds what the server asked for. */
        data object None : Step

        /** Install [accountIds] as the only accounts that may unlock setup after a wipe. */
        data class Apply(val accountIds: List<String>, val route: Route) : Step

        /**
         * The server sent no accounts — the dealer removed them, or nothing is
         * owed any more — so take this app's policy off again.
         */
        data object Clear : Step
    }

    fun routeFor(sdkInt: Int): Route = if (sdkInt >= MODERN_API_LEVEL) Route.MODERN else Route.LEGACY

    /**
     * Google account IDs are numeric (the obfuscated GAIA ID), never an email.
     * Anything else would make FRP demand an account nobody can sign in with,
     * and a phone that no one — not even the dealer — can set up is worse than
     * one without FRP, so non-numeric values are dropped rather than passed on.
     */
    fun normalize(accountIds: Iterable<String>): List<String> =
        accountIds.map { it.trim() }
            .filter { it.isNotEmpty() && it.length <= MAX_ID_LENGTH && it.all(Char::isDigit) }
            .distinct()
            .sorted()

    /** What [lastApplied] is compared against. Empty means "nothing of ours is installed". */
    fun fingerprint(accountIds: List<String>, route: Route): String =
        if (accountIds.isEmpty()) "" else route.name + ":" + accountIds.joinToString(",")

    /**
     * @param sdkInt the handset's `Build.VERSION.SDK_INT`.
     * @param desired the account IDs from the latest policy, as the server sent them.
     * @param lastApplied the [fingerprint] last installed successfully, or empty.
     */
    fun next(sdkInt: Int, desired: Iterable<String>, lastApplied: String?): Step {
        val ids = normalize(desired)
        val previous = lastApplied.orEmpty()

        if (ids.isEmpty()) {
            // An empty list with FRP enabled would mean "any account that was on
            // the phone" — the customer's own. That is the consumer default and
            // nothing for this app to install, so an empty list only ever clears.
            return if (previous.isEmpty()) Step.None else Step.Clear
        }

        val route = routeFor(sdkInt)
        return if (fingerprint(ids, route) == previous) Step.None else Step.Apply(ids, route)
    }

    /**
     * Compares the OS's live Factory Reset Protection policy against [desired].
     * Prevents trusting a stale local cache if OEM firmware cleared or refused FRP.
     */
    fun isLivePolicyInSync(
        desired: Iterable<String>,
        activeEnabled: Boolean,
        activeAccounts: Iterable<String>,
    ): Boolean {
        val expected = normalize(desired)
        if (expected.isEmpty()) return !activeEnabled
        return activeEnabled && normalize(activeAccounts) == expected
    }

    /**
     * Compares Play services' managed-configuration restriction array on Android 8–10.
     */
    fun isLegacyRestrictionInSync(
        desired: Iterable<String>,
        activeRestrictionValues: Array<String>?,
    ): Boolean {
        val expected = normalize(desired)
        if (expected.isEmpty()) return activeRestrictionValues == null || activeRestrictionValues.isEmpty()
        if (activeRestrictionValues == null) return false
        return normalize(activeRestrictionValues.asIterable()) == expected
    }

    private const val MAX_ID_LENGTH = 30
}
