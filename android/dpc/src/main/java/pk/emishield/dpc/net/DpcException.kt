package pk.emishield.dpc.net

/**
 * A call that failed.
 *
 * [retryable] is the distinction the whole client turns on. A dropped
 * connection or a 503 means try again later and change nothing. A 401 means
 * this handset's credential is dead — retrying it forever would be pointless
 * traffic, and the phone needs re-enrolment instead.
 */
class DpcException(
    message: String,
    val statusCode: Int? = null,
    val retryable: Boolean = true,
    cause: Throwable? = null,
) : Exception(message, cause) {

    val isCredentialRejected: Boolean get() = statusCode == 401 || statusCode == 403
}
