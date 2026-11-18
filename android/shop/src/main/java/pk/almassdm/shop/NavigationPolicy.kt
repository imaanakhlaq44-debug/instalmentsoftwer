package pk.almassdm.shop
import java.net.URI

/** Never let untrusted navigation acquire camera access or the download bridge. */
object NavigationPolicy {
    const val ORIGIN = "https://app.almassdm.pro"
    fun isInternal(url: String?, origin: String = BuildConfig.APP_ORIGIN): Boolean = runCatching {
        val uri = URI(url ?: "")
        val expected = URI(origin)
        fun port(v: URI) = if(v.port != -1)v.port else if(v.scheme.equals("https",true))443 else 80
        uri.scheme.equals(expected.scheme, true) && uri.host.equals(expected.host, true) &&
            uri.userInfo == null && port(uri) == port(expected)
    }.getOrDefault(false)
    fun externalAllowed(url: String): Boolean = runCatching {
        val uri = URI(url)
        when (uri.scheme?.lowercase()) { "https" -> !uri.host.isNullOrBlank() && uri.userInfo == null; "tel", "mailto" -> uri.schemeSpecificPart.isNotBlank(); else -> false }
    }.getOrDefault(false)
    fun acceptedMimeTypes(raw: Array<String>): Array<String> = raw.flatMap { it.split(',') }.map { it.trim() }
        .filter { it.matches(Regex("image/(?:jpeg|png|webp|\\*)")) || it == "application/pdf" }.distinct().toTypedArray()
    fun safeFileName(raw: String): String = raw.substringAfterLast('/').substringAfterLast('\\')
        .replace(Regex("[^\\p{L}\\p{N}._ -]"), "_").trim().take(100).ifBlank { "Almas-SDM-document.pdf" }
    fun safeRoute(url: String?, origin: String = BuildConfig.APP_ORIGIN): String? = if (isInternal(url,origin)) runCatching { URI(url).rawPath?.takeIf { it.startsWith('/') && !it.startsWith("//") } }.getOrNull() else null
}
