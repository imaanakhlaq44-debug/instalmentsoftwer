package pk.emishield.dpc.net

import android.util.Log
import org.json.JSONException
import org.json.JSONObject
import pk.emishield.dpc.BuildConfig
import pk.emishield.dpc.data.CheckInResult
import pk.emishield.dpc.data.EnrollResult
import pk.emishield.dpc.data.PendingCommand
import pk.emishield.dpc.data.PolicyView
import pk.emishield.dpc.data.Prefs
import java.io.BufferedReader
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * The client for the four `/api/dpc` endpoints.
 *
 * Plain `HttpURLConnection` and `org.json`, no HTTP library. Four endpoints,
 * small JSON bodies, and an app whose whole job is to be present and boring on
 * someone else's phone — a networking stack and its transitive dependencies
 * would be more surface area than the protocol is worth.
 */
class DpcApi(private val baseUrl: String, private val credential: String? = null) {

    constructor(prefs: Prefs) : this(
        baseUrl = prefs.serverUrl.orEmpty(),
        credential = prefs.deviceId?.let { id -> prefs.deviceToken?.let { "$id.$it" } }
    )

    /** POST /enroll — the only unauthenticated call, and the only time the token is seen. */
    fun enroll(enrollmentToken: String, deviceId: String?, dpcVersion: String): EnrollResult {
        val body = JSONObject()
            .put("token", enrollmentToken)
            .put("dpcVersion", dpcVersion)
        if (!deviceId.isNullOrBlank()) body.put("deviceId", deviceId)

        val json = request("POST", "enroll", body, authenticated = false)
        return EnrollResult(
            deviceId = json.optString("deviceId"),
            deviceToken = json.optString("deviceToken"),
            checkInIntervalSeconds = json.optInt("checkInIntervalSeconds", Prefs.DEFAULT_INTERVAL_SECONDS),
            policy = PolicyView.fromJson(json.optJSONObject("policy") ?: JSONObject()),
        )
    }

    /** POST /check-in — the heartbeat. Reports telemetry, collects any waiting command. */
    fun checkIn(telemetry: Telemetry): CheckInResult {
        val json = request("POST", "check-in", telemetry.toJson(), authenticated = true)
        return CheckInResult(
            status = json.optString("status", "UNKNOWN"),
            command = PendingCommand.fromJson(json.optJSONObject("command")),
            checkInIntervalSeconds = json.optInt("checkInIntervalSeconds", Prefs.DEFAULT_INTERVAL_SECONDS),
            policy = PolicyView.fromJson(json.optJSONObject("policy") ?: JSONObject()),
        )
    }

    /**
     * POST /commands/ack — the handset states what actually happened.
     *
     * This is the honest half of the protocol. Sending `applied = true` for a
     * restriction that did not take hold would put a lock on a dealer's screen
     * that does not exist on the customer's phone, which is the one failure the
     * whole LOCK_PENDING design exists to prevent. [error] is written to the
     * device's timeline for support to read.
     */
    fun acknowledge(command: String, applied: Boolean, error: String? = null) {
        val body = JSONObject().put("command", command).put("applied", applied)
        if (!applied && !error.isNullOrBlank()) body.put("error", error.take(300))
        request("POST", "commands/ack", body, authenticated = true)
    }

    /** GET /policy — for a handset that restarted and must re-render without waiting. */
    fun policy(): PolicyView {
        val json = request("GET", "policy", null, authenticated = true)
        return PolicyView.fromJson(json.optJSONObject("policy") ?: JSONObject())
    }

    // -----------------------------------------------------------------------

    private fun request(
        method: String,
        path: String,
        body: JSONObject?,
        authenticated: Boolean,
    ): JSONObject {
        if (baseUrl.isBlank()) {
            throw DpcException("No server address is configured.", retryable = false)
        }
        if (authenticated && credential.isNullOrBlank()) {
            throw DpcException("This phone is not enrolled.", retryable = false)
        }

        val url = URL(endpoint(baseUrl, path))
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = CONNECT_TIMEOUT_MS
            readTimeout = READ_TIMEOUT_MS
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "EMIShieldDPC/" + BuildConfig.VERSION_NAME)
            if (authenticated) setRequestProperty("Authorization", "Device " + credential)
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }

        try {
            body?.let { payload ->
                connection.outputStream.use { out -> out.write(payload.toString().toByteArray(Charsets.UTF_8)) }
            }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()

            if (status !in 200..299) throw failureFor(status, text)

            return if (text.isBlank()) JSONObject() else JSONObject(text)
        } catch (e: DpcException) {
            throw e
        } catch (e: JSONException) {
            // A body this app cannot parse is not a transient fault; retrying
            // will produce the same unparseable body.
            throw DpcException("The server sent a response this app could not read.", retryable = false, cause = e)
        } catch (e: IOException) {
            Log.w(TAG, method + " " + path + " failed: " + e.message)
            throw DpcException("Could not reach the server.", retryable = true, cause = e)
        } finally {
            connection.disconnect()
        }
    }

    private fun failureFor(status: Int, text: String): DpcException {
        val parsed = runCatching { JSONObject(text) }.getOrNull()
        val message = parsed
            ?.let { json -> json.optString("message").ifBlank { json.optString("error") } }
            ?.takeIf { it.isNotBlank() }
            ?: ("The server refused the request (HTTP " + status + ").")

        // 4xx is the server saying no and meaning it — except 408 and 429,
        // which are it saying "not just now".
        val retryable = status >= 500 || status == 408 || status == 429
        return DpcException(message, statusCode = status, retryable = retryable)
    }

    companion object {
        private const val TAG = "DpcApi"
        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 20_000

        /**
         * Joins the base URL from the enrolment QR to an endpoint.
         *
         * The QR is printed by a shop and sometimes typed by hand, so the base
         * arrives with and without a trailing slash. Getting this wrong means a
         * phone that provisions cleanly and then never checks in again, so the
         * join is explicit and tested rather than left to concatenation at four
         * call sites.
         */
        fun endpoint(baseUrl: String, path: String): String =
            baseUrl.trim().trimEnd('/') + "/" + path.trimStart('/')
    }
}
