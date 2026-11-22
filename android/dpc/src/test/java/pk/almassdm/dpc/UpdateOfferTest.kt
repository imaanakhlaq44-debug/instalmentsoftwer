package pk.almassdm.dpc

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import pk.almassdm.dpc.data.UpdateOffer

class UpdateOfferTest {

    private val sha = "df5e2ad268f3ad7035d3394f857ab3336bdc1d48b5487463d00da2f18ec0df11"
    private val offer = UpdateOffer(16, "https://app.almassdm.pro/downloads/a.apk", sha)
    private val now = 10_000_000_000L

    private fun json(versionCode: Int, url: String, sha256: String) =
        JSONObject().put("versionCode", versionCode).put("url", url).put("sha256", sha256)

    @Test
    fun `parses a well-formed offer and rejects the rest`() {
        assertEquals(offer, UpdateOffer.fromJson(json(16, offer.url, sha.uppercase())))
        assertNull(UpdateOffer.fromJson(null))
        assertNull(UpdateOffer.fromJson(json(0, offer.url, sha)))
        assertNull(UpdateOffer.fromJson(json(16, "http://app.almassdm.pro/a.apk", sha)))
        assertNull(UpdateOffer.fromJson(json(16, offer.url, "abc")))
    }

    @Test
    fun `installs only a newer build, as device owner, while unlocked`() {
        assertTrue(UpdateOffer.shouldInstall(offer, 15, true, false, 0, 0L, now))
        assertFalse(UpdateOffer.shouldInstall(offer, 16, true, false, 0, 0L, now))
        assertFalse(UpdateOffer.shouldInstall(offer, 17, true, false, 0, 0L, now))
        assertFalse(UpdateOffer.shouldInstall(offer, 15, false, false, 0, 0L, now))
        assertFalse(UpdateOffer.shouldInstall(offer, 15, true, true, 0, 0L, now))
        assertFalse(UpdateOffer.shouldInstall(null, 15, true, false, 0, 0L, now))
    }

    @Test
    fun `a failed version waits a day before another try`() {
        assertFalse(UpdateOffer.shouldInstall(offer, 15, true, false, 16, now - 1000, now))
        assertTrue(UpdateOffer.shouldInstall(offer, 15, true, false, 16, now - UpdateOffer.RETRY_AFTER_MILLIS, now))
        // A different failed version does not hold this one back.
        assertTrue(UpdateOffer.shouldInstall(offer, 15, true, false, 14, now - 1000, now))
    }
}
