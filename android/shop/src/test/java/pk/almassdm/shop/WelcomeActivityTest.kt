package pk.almassdm.shop
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34])
class WelcomeActivityTest {
    @Before fun freshSession() {
        ApplicationProvider.getApplicationContext<android.content.Context>().getSharedPreferences("shop_navigation",0).edit().clear().commit()
    }
    private fun all(view:View):List<View> = listOf(view)+(if(view is ViewGroup)(0 until view.childCount).flatMap { all(view.getChildAt(it)) } else emptyList())
    private fun content(activity:MainActivity)=all(activity.findViewById(android.R.id.content))
    @Test fun coldLaunchShowsClearAuthenticationChoicesAfterSplash() {
        val controller=Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity=controller.get()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1300))
        val labels=content(activity).filterIsInstance<TextView>().map { it.text.toString() }
        assertTrue(labels.contains("Sign in  →"));assertTrue(labels.contains("Create your account"))
        assertTrue(labels.contains("Privacy"));assertTrue(labels.contains("Delete account"))
        assertFalse(content(activity).any { it is WebView })
        controller.pause().stop().destroy()
    }
    @Test fun signInLoadsTheExistingAccountLogin() {
        val controller=Robolectric.buildActivity(MainActivity::class.java).setup();val activity=controller.get()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1300))
        content(activity).filterIsInstance<TextView>().first { it.text.toString()=="Sign in  →" }.performClick()
        val web=content(activity).filterIsInstance<WebView>().single()
        assertEquals(BuildConfig.APP_ORIGIN+"/login",shadowOf(web).lastLoadedUrl)
        assertFalse(web.settings.allowFileAccess)
        assertEquals(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW,web.settings.mixedContentMode)
        controller.pause().stop().destroy()
    }
    @Test fun signUpUsesTheExistingRegistrationAndStoreMode() {
        val controller=Robolectric.buildActivity(MainActivity::class.java).setup();val activity=controller.get()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1300))
        content(activity).filterIsInstance<TextView>().first { it.text.toString()=="Create your account" }.performClick()
        val web=content(activity).filterIsInstance<WebView>().single()
        assertEquals(BuildConfig.APP_ORIGIN+"/register",shadowOf(web).lastLoadedUrl)
        assertTrue(web.settings.userAgentString.contains(if(BuildConfig.PLAY_STORE)"(Play)"else"(Direct)"))
        controller.pause().stop().destroy()
    }
    @Test fun documentSavingRequiresItsOwnNonceAndUsesTheSystemFilePicker() {
        val controller=Robolectric.buildActivity(MainActivity::class.java).setup();val activity=controller.get()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1300))
        activity.receiveDocument("""{"nonce":"unsolicited","name":"bad.txt","data":"data:text/plain;base64,SGVsbG8="}""")
        assertNull(shadowOf(activity).nextStartedActivity)
        var nonce=""
        activity.receiveDocument("""{"action":"requestDownload","requestId":"receipt-1"}""") { nonce=org.json.JSONObject(it).getString("nonce") }
        assertTrue(nonce.length>30)
        activity.receiveDocument(org.json.JSONObject().put("nonce",nonce).put("name","../../receipt.csv").put("mime","text/csv").put("data","data:text/csv;base64,SGVsbG8=").toString())
        val picker=shadowOf(activity).nextStartedActivity
        assertEquals(android.content.Intent.ACTION_CREATE_DOCUMENT,picker.action)
        assertEquals("receipt.csv",picker.getStringExtra(android.content.Intent.EXTRA_TITLE))
        controller.pause().stop().destroy()
    }
    @Test fun bundledIconsLoadLocallyOnlyOnTheExactAppOrigin() {
        val controller=Robolectric.buildActivity(MainActivity::class.java).setup();val activity=controller.get()
        for(name in listOf("agreement","wallet","phone","customer")) {
            val image=activity.bundledImage(BuildConfig.APP_ORIGIN+"/icons/3d/$name.png")!!
            assertEquals("image/png",image.mimeType)
            image.data.use { assertArrayEquals(byteArrayOf(-119,80,78,71,13,10,26,10),it.readBytes().take(8).toByteArray()) }
        }
        assertNull(activity.bundledImage("https://other.example/icons/3d/wallet.png"))
        assertNull(activity.bundledImage(BuildConfig.APP_ORIGIN+"/api/customers"))
        assertNull(activity.bundledImage(BuildConfig.APP_ORIGIN+"/icons/3d/../../secret.png"))
        controller.pause().stop().destroy()
    }
    @Test fun copyWritesOnlyTheRequestedTextToTheSystemClipboard() {
        val controller=Robolectric.buildActivity(MainActivity::class.java).setup();val activity=controller.get()
        var response=""
        activity.receiveDocument("""{"action":"copy","requestId":"copy-1","text":"Enrollment test code"}""") { response=it }
        assertTrue(org.json.JSONObject(response).getBoolean("copied"))
        val clipboard=activity.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        assertEquals("Enrollment test code",clipboard.primaryClip!!.getItemAt(0).text.toString())
        controller.pause().stop().destroy()
    }
    @Test @GraphicsMode(GraphicsMode.Mode.NATIVE) @Config(qualifiers="w393dp-h851dp-xhdpi")
    fun renderTheActualNativeWelcomeAndSplash() {
        org.robolectric.util.ReflectionHelpers.callStaticMethod<Any>(android.animation.ValueAnimator::class.java,"setDurationScale",org.robolectric.util.ReflectionHelpers.ClassParameter.from(java.lang.Float.TYPE,1f))
        val controller=Robolectric.buildActivity(MainActivity::class.java).setup();val activity=controller.get()
        val output=java.io.File(System.getenv("ALMAS_SHOP_QA_OUTPUT") ?: System.getProperty("java.io.tmpdir")+"/almas-shop-ui-preview").apply { mkdirs() }
        val view=activity.findViewById<View>(android.R.id.content)
        fun capture(name:String) {
            val width=(393*activity.resources.displayMetrics.density).toInt();val height=(851*activity.resources.displayMetrics.density).toInt()
            view.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));view.layout(0,0,width,height)
            val bitmap=android.graphics.Bitmap.createBitmap(width,height,android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(bitmap))
            java.io.File(output,"$name-${if(BuildConfig.PLAY_STORE)"play"else"direct"}.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
        }
        (view as ViewGroup).getChildAt(0).let { it as ViewGroup; it.removeAllViews() }
        org.robolectric.util.ReflectionHelpers.callInstanceMethod<Any>(activity,"showSplash")
        content(activity).filterIsInstance<android.widget.ImageView>().forEach { it.animate().cancel(); it.alpha=1f; it.scaleX=1f; it.scaleY=1f }
        capture("splash")
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(1300));capture("welcome")
        assertTrue(content(activity).filterIsInstance<TextView>().any { it.text.toString()=="Create your account" })
        controller.pause().stop().destroy()
    }
}
