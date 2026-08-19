package pk.emishield.relay

import android.util.Log
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** One message the server wants sent, exactly as it arrives. */
data class OutboxMessage(val id: String, val to: String, val message: String)

/** What the phone reports back about one message. */
data class SendResult(val id: String, val sent: Boolean, val error: String?)

class RelayException(message: String, val statusCode: Int? = null, cause: Throwable? = null) :
    Exception(message, cause) {
    val isCredentialRejected: Boolean get() = statusCode == 401 || statusCode == 403
}

/**
 * The client for the two relay endpoints.
 *
 * The phone pulls; nothing is pushed to it. A handset on mobile data has no
 * address anyone can reach, so polling is not a shortcut here — it is the only
 * arrangement that works on a counter phone with a normal SIM.
 */
class RelayApi(private val baseUrl: String, private val credential: String) {

    /** POST /poll — claims a batch, and doubles as the "this phone is alive" signal. */
    fun poll(limit: Int): Pair<List<OutboxMessage>, Int> {
        val json = request("poll", JSONObject().put("limit", limit))

        val array: JSONArray = json.optJSONArray("messages") ?: JSONArray()
        val messages = buildList {
            for (i in 0 until array.length()) {
                val item = array.optJSONObject(i) ?: continue
                val id = item.optString("id")
                val to = item.optString("to")
                val body = item.optString("message")
                if (id.isNotBlank() && to.isNotBlank() && body.isNotBlank()) {
                    add(OutboxMessage(id, to, body))
                }
            }
        }

        // The server sets the cadence, so it can be changed without shipping a
        // new APK to a counter somewhere.
        return messages to json.optInt("pollIntervalSeconds", 60).coerceIn(5, 600)
    }

    /** POST /results — nothing is SENT on the server until this says so. */
    fun report(results: List<SendResult>) {
        if (results.isEmpty()) return

        val array = JSONArray()
        for (result in results) {
            val item = JSONObject().put("id", result.id).put("sent", result.sent)
            if (!result.sent && !result.error.isNullOrBlank()) item.put("error", result.error.take(300))
            array.put(item)
        }

        request("results", JSONObject().put("results", array))
    }

    private fun request(path: String, body: JSONObject): JSONObject {
        val connection = (URL(endpoint(baseUrl, path)).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15_000
            readTimeout = 20_000
            doOutput = true
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Authorization", "Relay " + credential)
            setRequestProperty("User-Agent", "EMIShieldRelay/" + BuildConfig.VERSION_NAME)
        }

        try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()

            if (status !in 200..299) {
                val message = runCatching { JSONObject(text).optString("error") }
                    .getOrNull()
                    ?.takeIf { it.isNotBlank() }
                    ?: ("The server refused the request (HTTP " + status + ").")
                throw RelayException(message, status)
            }

            return if (text.isBlank()) JSONObject() else JSONObject(text)
        } catch (e: RelayException) {
            throw e
        } catch (e: JSONException) {
            throw RelayException("The server sent a response this app could not read.", cause = e)
        } catch (e: IOException) {
            Log.w(TAG, "POST " + path + " failed: " + e.message)
            throw RelayException("Could not reach the server.", cause = e)
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        private const val TAG = "RelayApi"

        /** The base URL is typed by a shopkeeper, so the join is explicit and tested. */
        fun endpoint(baseUrl: String, path: String): String =
            baseUrl.trim().trimEnd('/') + "/" + path.trimStart('/')
    }
}
