package pk.almassdm.dpc.data

import org.json.JSONObject

/**
 * A newer build of this app, announced by the server on check-in.
 *
 * Installed by [pk.almassdm.dpc.work.SelfUpdateWorker] only after the file's
 * SHA-256 matches [sha256]; Android itself also refuses an APK signed with any
 * other key, so a server or network that lies cannot put another app in place.
 */
data class UpdateOffer(val versionCode: Int, val url: String, val sha256: String) {

    companion object {
        private val SHA256 = Regex("^[0-9a-f]{64}$")

        /** Null unless every field is present and well-formed (HTTPS only). */
        fun fromJson(json: JSONObject?): UpdateOffer? {
            if (json == null) return null
            val versionCode = json.optInt("versionCode", 0)
            val url = json.optString("url")
            val sha = json.optString("sha256").lowercase()
            if (versionCode <= 0 || !url.startsWith("https://") || !SHA256.matches(sha)) return null
            return UpdateOffer(versionCode, url, sha)
        }

        /** A failed attempt at the same version is not retried for a day. */
        const val RETRY_AFTER_MILLIS = 24L * 60 * 60 * 1000

        /**
         * Whether to start installing [offer] now.
         *
         * Never while the phone is locked: replacing the app restarts it, and a
         * lock screen should not blink off for a customer even for a moment.
         * It installs on the next check-in after the lock is lifted.
         */
        fun shouldInstall(
            offer: UpdateOffer?,
            currentVersionCode: Int,
            isDeviceOwner: Boolean,
            lockApplied: Boolean,
            failedVersion: Int,
            failedAt: Long,
            now: Long,
        ): Boolean {
            if (offer == null || !isDeviceOwner || lockApplied) return false
            if (offer.versionCode <= currentVersionCode) return false
            if (failedVersion == offer.versionCode && now - failedAt < RETRY_AFTER_MILLIS) return false
            return true
        }
    }
}
