package pk.almassdm.dpc.admin

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Base64

/**
 * The bytes the secure chip signs over when it attests this phone.
 *
 * At enrollment there has been no contact with the server yet, so the
 * challenge is derived from the single-use enrollment code, which only this
 * handset and the server know. Afterwards the server hands out a random one in
 * a check-in response, and the next check-in answers it.
 *
 * Pure JVM code so the derivation is unit-tested against the same vector as
 * the server (`server/tests/api/hardware-attestation.test.ts`).
 */
object AttestationChallenge {

    const val ENROLL_PREFIX = "almas-sdm/enroll-attestation/v1:"

    fun forEnrollment(enrollmentCode: String): ByteArray =
        MessageDigest.getInstance("SHA-256").digest((ENROLL_PREFIX + enrollmentCode.trim()).toByteArray(Charsets.UTF_8))

    /** A server challenge (base64url), or null when absent or not a plausible size. */
    fun decode(serverChallenge: String?): ByteArray? =
        serverChallenge
            ?.takeIf { it.isNotBlank() }
            ?.let { runCatching { Base64.getUrlDecoder().decode(it.trim()) }.getOrNull() }
            ?.takeIf { it.size in 16..128 }
}

/** What the handset sends back: the certificate chain, leaf first, as base64 DER. */
data class AttestationReport(
    val chain: List<String>,
    val idsAttested: Boolean,
    val error: String? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("chain", JSONArray(chain))
        .put("idsAttested", idsAttested)
        .apply { error?.takeIf { it.isNotBlank() }?.let { put("error", it.take(300)) } }
}
