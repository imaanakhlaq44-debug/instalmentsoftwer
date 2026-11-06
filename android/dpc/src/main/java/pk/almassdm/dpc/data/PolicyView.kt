package pk.almassdm.dpc.data

import org.json.JSONObject

/**
 * Everything the server is willing to tell a handset about its own situation.
 *
 * The shape mirrors `DevicePolicyView` in `server/src/routes/dpc.routes.ts`
 * exactly, and it is deliberately small: the lock message, the real figures
 * owed, and how to reach the shop. No IMEI, no CNIC, no other customer, no
 * other device. If a field ever appears here that the phone does not need to
 * render its own screen, it does not belong in the response either.
 */
data class PolicyView(
    val locked: Boolean,
    val lockMessage: String?,
    val emergencyCallsAllowed: Boolean,
    val paymentMethods: List<String>,
    val amountDue: Double,
    val nextDueDate: String?,
    /**
     * Days this handset may go without reaching the server before it restricts
     * itself, or 0 for never. The server has already weighed the dealer's
     * policy, the customer's consent and the version of the terms they signed;
     * the phone is handed the answer, so it never has to reason about any of
     * that offline. See [pk.almassdm.dpc.work.OfflineLockRule].
     */
    val offlineLockAfterDays: Int,
    /** The same grace the server allows after a due date, applied offline too. */
    val gracePeriodDays: Int,
    /**
     * Google account ids that may set the phone up again after a recovery-mode
     * factory reset. Empty means no Factory Reset Protection — the server sends
     * an empty list once nothing is owed, and the phone then drops it.
     */
    val frpAccountIds: List<String> = emptyList(),
    /** 0 none, 1 no outgoing calls or SMS, 2 also [restrictedApps] suspended. */
    val restrictionLevel: Int = 0,
    val restrictedApps: List<String> = emptyList(),
    val dealerName: String?,
    val dealerPhone: String?,
) {
    companion object {
        fun fromJson(json: JSONObject): PolicyView {
            val contact = json.optJSONObject("contact")
            val methods = json.optJSONArray("paymentMethods")
            return PolicyView(
                locked = json.optBoolean("locked", false),
                lockMessage = json.optStringOrNull("lockMessage"),
                emergencyCallsAllowed = json.optBoolean("emergencyCallsAllowed", true),
                paymentMethods = buildList {
                    for (i in 0 until (methods?.length() ?: 0)) {
                        methods?.optString(i)?.takeIf { it.isNotBlank() }?.let { add(it) }
                    }
                },
                amountDue = json.optDouble("amountDue", 0.0).let { if (it.isNaN()) 0.0 else it },
                nextDueDate = json.optStringOrNull("nextDueDate"),
                // Absent means off. An older server that does not know about the
                // offline rule must not have one inferred for it.
                offlineLockAfterDays = json.optInt("offlineLockAfterDays", 0).coerceAtLeast(0),
                gracePeriodDays = json.optInt("gracePeriodDays", 0).coerceAtLeast(0),
                // Absent means none. Only all-digit ids are kept: anything else
                // (an email pasted by mistake) would be accepted by Android and
                // then match no account, leaving a wiped phone nobody can set up.
                frpAccountIds = json.optJSONArray("frpAccountIds").let { ids ->
                    buildList {
                        for (i in 0 until (ids?.length() ?: 0)) {
                            ids?.optString(i)?.trim()
                                ?.takeIf { it.isNotEmpty() && it.all(Char::isDigit) }
                                ?.let { add(it) }
                        }
                    }.distinct()
                },
                // Absent means none: an older server never asks for a stage.
                restrictionLevel = json.optInt("restrictionLevel", 0).coerceIn(0, 2),
                restrictedApps = json.optJSONArray("restrictedApps").let { list ->
                    buildList {
                        for (i in 0 until (list?.length() ?: 0)) {
                            list?.optString(i)?.trim()?.takeIf { it.isNotEmpty() }?.let { add(it) }
                        }
                    }.distinct()
                },
                dealerName = contact?.optStringOrNull("dealerName"),
                dealerPhone = contact?.optStringOrNull("dealerPhone"),
            )
        }
    }
}

/**
 * `optString` returns the literal text "null" for a JSON null, which would then
 * be rendered on a lock screen. Every optional string here goes through this.
 */
internal fun JSONObject.optStringOrNull(key: String): String? {
    if (isNull(key)) return null
    val value = optString(key, "")
    return value.takeIf { it.isNotBlank() }
}

/** A command the server is waiting for this handset to apply. */
data class PendingCommand(val type: String, val issuedAt: String?) {
    companion object {
        fun fromJson(json: JSONObject?): PendingCommand? {
            if (json == null) return null
            val type = json.optStringOrNull("type") ?: return null
            if (type != "LOCK" && type != "UNLOCK") return null
            return PendingCommand(type, json.optStringOrNull("issuedAt"))
        }
    }
}

/** The answer to a check-in: current state, any waiting command, the policy. */
data class CheckInResult(
    val status: String,
    val command: PendingCommand?,
    val checkInIntervalSeconds: Int,
    val policy: PolicyView,
)

/** The answer to an enrolment: the credential, transmitted exactly once. */
data class EnrollResult(
    val deviceId: String,
    val deviceToken: String,
    val checkInIntervalSeconds: Int,
    val policy: PolicyView,
)
