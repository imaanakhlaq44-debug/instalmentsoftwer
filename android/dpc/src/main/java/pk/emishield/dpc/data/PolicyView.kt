package pk.emishield.dpc.data

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
