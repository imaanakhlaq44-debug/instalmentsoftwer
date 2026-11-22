package pk.almassdm.dpc.admin

import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Unlocking a restricted phone that cannot get online.
 *
 * The lock screen shows an 8-digit phone code (a random challenge kept in
 * prefs). The shop types it into the dashboard and gets back an 8-digit unlock
 * code. The phone checks that code here, with no network.
 *
 * The code is an HMAC-SHA256 over the device id and the challenge, keyed with
 * the lowercase hex SHA-256 of this handset's device token. The server stores
 * exactly that hash, so both sides can work out the code. The truncation is
 * HOTP's (RFC 4226 §5.3).
 *
 * The server side is `server/src/services/OfflineUnlockCode.ts`; both are
 * tested against the same fixed vector. A new challenge is made after every
 * successful unlock, so a code works once. Wrong attempts are limited by
 * [attemptAllowed] / [afterFailure].
 *
 * Pure apart from [newChallenge]'s randomness, so it runs in a plain unit test.
 */
object OfflineUnlock {

    const val DOMAIN = "almas-offline-unlock-v1"
    const val DIGITS = 8

    /** Wrong codes allowed before the phone stops accepting codes for a while. */
    const val MAX_FAILURES = 5
    const val BLOCK_MILLIS = 30L * 60L * 1000L

    fun tokenHash(deviceToken: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(deviceToken.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    fun code(tokenHash: String, deviceId: String, challenge: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(tokenHash.toByteArray(Charsets.UTF_8), "HmacSHA256"))
        val h = mac.doFinal("$DOMAIN|$deviceId|$challenge".toByteArray(Charsets.UTF_8))
        val offset = h[h.size - 1].toInt() and 0x0f
        val binary = ((h[offset].toInt() and 0x7f) shl 24) or
            ((h[offset + 1].toInt() and 0xff) shl 16) or
            ((h[offset + 2].toInt() and 0xff) shl 8) or
            (h[offset + 3].toInt() and 0xff)
        return (binary % 100_000_000).toString().padStart(DIGITS, '0')
    }

    /** True when [entered] (spaces and dashes ignored) is the code for this challenge. */
    fun matches(entered: String, deviceToken: String, deviceId: String, challenge: String): Boolean {
        val digits = entered.filter { it != ' ' && it != '-' }
        if (digits.length != DIGITS || !digits.all { it in '0'..'9' }) return false
        val expected = code(tokenHash(deviceToken), deviceId, challenge)
        return MessageDigest.isEqual(expected.toByteArray(), digits.toByteArray())
    }

    fun newChallenge(random: SecureRandom = SecureRandom()): String =
        (0 until DIGITS).joinToString("") { random.nextInt(10).toString() }

    /** "12345678" -> "1234 5678", easier to read out over the phone. */
    fun display(challenge: String): String =
        if (challenge.length == DIGITS) challenge.substring(0, 4) + " " + challenge.substring(4) else challenge

    fun attemptAllowed(blockedUntil: Long, now: Long): Boolean = now >= blockedUntil

    /** New (failures, blockedUntil) after a wrong code. */
    fun afterFailure(failures: Int, now: Long): Pair<Int, Long> {
        val next = failures + 1
        return if (next >= MAX_FAILURES) 0 to (now + BLOCK_MILLIS) else next to 0L
    }
}
