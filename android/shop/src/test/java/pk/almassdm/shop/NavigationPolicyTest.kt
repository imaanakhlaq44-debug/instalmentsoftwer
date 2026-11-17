package pk.almassdm.shop
import org.junit.Assert.*
import org.junit.Test
class NavigationPolicyTest {
    private fun internal(url: String) = NavigationPolicy.isInternal(url, NavigationPolicy.ORIGIN)
    @Test fun internalNavigationRequiresExactHttpsOrigin() {
        assertTrue(internal("https://app.almassdm.pro/customers"))
        listOf("http://app.almassdm.pro", "https://app.almassdm.pro.evil.test", "https://user@app.almassdm.pro", "https://app.almassdm.pro:444", "javascript:alert(1)", "file:///data/local/a", "intent://app.almassdm.pro").forEach { assertFalse(it, internal(it)) }
    }
    @Test fun externalLinksAreExplicitAndSafe() {
        assertTrue(NavigationPolicy.externalAllowed("tel:03211144477"))
        assertTrue(NavigationPolicy.externalAllowed("https://wa.me/923211144477"))
        assertFalse(NavigationPolicy.externalAllowed("javascript:alert(1)"))
        assertFalse(NavigationPolicy.externalAllowed("content://private/file"))
    }
    @Test fun downloadsCannotSupplyAPath() { assertEquals("receipt.pdf", NavigationPolicy.safeFileName("../../receipt.pdf")); assertEquals("receipt.pdf", NavigationPolicy.safeFileName("C:\\private\\receipt.pdf")) }
    @Test fun cameraPickerUnderstandsTheCnicFormsCommaSeparatedTypes() { assertArrayEquals(arrayOf("image/jpeg","image/png","image/webp"),NavigationPolicy.acceptedMimeTypes(arrayOf("image/jpeg,image/png,image/webp"))); assertTrue(NavigationPolicy.acceptedMimeTypes(arrayOf("text/html","application/javascript")).isEmpty()) }
    @Test fun hostedCheckoutStartsOnlyOnKnownHttpsGatewayOrigins() { assertTrue(NavigationPolicy.isGateway("https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/"));assertFalse(NavigationPolicy.isGateway("http://payments.jazzcash.com.pk/"));assertFalse(NavigationPolicy.isGateway("https://payments.jazzcash.com.pk.evil.test/"));assertFalse(internal("https://payments.jazzcash.com.pk/")) }
    @Test fun savedRoutesStayOnTheApplication() { assertEquals("/payments", NavigationPolicy.safeRoute("https://app.almassdm.pro/payments?token=secret", NavigationPolicy.ORIGIN)); assertNull(NavigationPolicy.safeRoute("https://evil.test/payments", NavigationPolicy.ORIGIN)) }
}
