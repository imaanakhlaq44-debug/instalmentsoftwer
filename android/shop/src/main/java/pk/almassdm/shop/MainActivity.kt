package pk.almassdm.shop

import android.Manifest
import android.animation.ValueAnimator
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.*
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.print.PrintManager
import android.provider.MediaStore
import android.view.*
import android.webkit.*
import android.widget.*
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebMessageCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Shop management client. No Device Owner, SMS, contacts or storage privileges. */
class MainActivity : AppCompatActivity() {
    private val paper = Color.rgb(255,248,232)
    private val cream = Color.rgb(255,253,246)
    private val ink = Color.rgb(15,20,25)
    private val navy = Color.rgb(18,48,95)
    private val sun = Color.rgb(255,200,61)
    private val mint = Color.rgb(29,185,143)
    private lateinit var root: FrameLayout
    private var browser: WebView? = null
    private var offline: View? = null
    private var progress: ProgressBar? = null
    private var currentUrl = BuildConfig.APP_ORIGIN + "/"
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var webPermission: PermissionRequest? = null
    private var photoPermissionAction: (() -> Unit)? = null
    private var pendingDocument: ByteArray? = null
    private var pendingBlobNonce: String? = null
    private var splashAnimator: ValueAnimator? = null
    private var paymentFlow=false
    private var pageTitle:TextView?=null
    private val preferences by lazy { getSharedPreferences("shop_navigation", MODE_PRIVATE) }

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val web = webPermission; webPermission = null
        val photo = photoPermissionAction; photoPermissionAction = null
        if (granted) {
            if (web != null && NavigationPolicy.isInternal(browser?.url)) web.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else web?.deny()
            photo?.invoke()
        } else {
            web?.deny(); if (photo != null) finishFileSelection(null)
            message("Camera permission was not allowed. You can still choose an existing photo.")
        }
    }
    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = if (result.resultCode == RESULT_OK) result.data?.data ?: cameraUri else null
        finishFileSelection(uri?.takeIf { it.scheme == "content" }?.let { arrayOf(it) })
        cameraUri = null
    }
    private val saveDocument = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = pendingDocument; pendingDocument = null
        val uri = result.data?.data
        if(result.resultCode == RESULT_OK && uri != null && data == null) message("Please download this document again to finish saving it.")
        if (result.resultCode == RESULT_OK && uri != null && data != null) lifecycleScope.launch {
            val saved = withContext(Dispatchers.IO) { runCatching { contentResolver.openOutputStream(uri)?.use { it.write(data) } ?: error("No file destination") }.isSuccess }
            message(if (saved) "Document saved." else "Could not save this document. Try again.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).apply { isAppearanceLightStatusBars = true; isAppearanceLightNavigationBars = true }
        root = FrameLayout(this).apply { setBackgroundColor(paper) }
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            insets
        }
        File(cacheDir, "captures").listFiles()?.filter { it.isFile && System.currentTimeMillis()-it.lastModified()>86400000 }?.forEach { it.delete() }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                browser?.let { web ->
                    web.evaluateJavascript("""(()=>{const e=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});document.dispatchEvent(e);return e.defaultPrevented;})()""") { handled -> if(handled!="true")navigateBack() }
                    return
                }
                navigateBack()
            }
            private fun navigateBack() {
                val web = browser
                val path = NavigationPolicy.safeRoute(web?.url)
                when {
                    web == null -> finish()
                    path == "/login" || path == "/register" -> showWelcome()
                    path == "/" -> finish()
                    web.canGoBack() -> web.goBack()
                    else -> showWelcome()
                }
            }
        })
        showSplash()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun shape(color: Int, radius: Int = 16, stroke: Boolean = true) = GradientDrawable().apply {
        setColor(color); cornerRadius = dp(radius).toFloat(); if (stroke) setStroke(dp(2), ink)
    }
    private fun label(text: String, size: Float, color: Int = ink, bold: Boolean = false) = TextView(this).apply {
        this.text = text; textSize = size; setTextColor(color)
        typeface = Typeface.create(if (bold) "sans-serif-black" else "sans-serif", if (bold) Typeface.BOLD else Typeface.NORMAL)
        includeFontPadding = false
    }
    private fun vertical() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    private fun button(text: String, backgroundColor: Int, action: () -> Unit) = com.google.android.material.button.MaterialButton(this).apply {
        this.text = text; textSize = 16f; isAllCaps = false; minHeight = dp(54)
        setTextColor(if (backgroundColor == navy) Color.WHITE else ink)
        backgroundTintList = android.content.res.ColorStateList.valueOf(backgroundColor)
        cornerRadius = dp(16); strokeWidth = dp(2); strokeColor = android.content.res.ColorStateList.valueOf(ink)
        typeface = Typeface.create("sans-serif", Typeface.BOLD); setOnClickListener { action() }
    }
    private fun clearScreen() {
        paymentFlow=false;pageTitle=null
        pendingBlobNonce=null
        splashAnimator?.cancel(); splashAnimator = null
        fileCallback?.onReceiveValue(null); fileCallback = null
        webPermission?.deny(); webPermission = null
        browser?.apply { stopLoading(); (parent as? android.view.ViewGroup)?.removeView(this); destroy() }; browser = null
        root.removeAllViews(); progress = null; offline = null
    }
    private fun showSplash() {
        val splash = vertical().apply { gravity = Gravity.CENTER; setPadding(dp(28),dp(24),dp(28),dp(24)) }
        val mark = ImageView(this).apply { setImageResource(R.drawable.brand_mark); contentDescription = "ALMAS SDM" }
        splash.addView(mark, LinearLayout.LayoutParams(dp(100),dp(100)))
        splash.addView(label("ALMAS SDM",30f,navy,true), LinearLayout.LayoutParams(-2,-2).apply { topMargin=dp(24) })
        splash.addView(label("Your business, in focus.",15f), LinearLayout.LayoutParams(-2,-2).apply { topMargin=dp(10) })
        val dots = label("●  ●  ●",14f,mint).apply { contentDescription="Loading application" }
        splash.addView(dots, LinearLayout.LayoutParams(-2,-2).apply { topMargin=dp(28) })
        root.addView(splash, FrameLayout.LayoutParams(-1,-1))
        if (ValueAnimator.areAnimatorsEnabled()) {
            mark.alpha=0f; mark.scaleX=.82f; mark.scaleY=.82f
            mark.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(600).start()
            splashAnimator=ValueAnimator.ofFloat(.3f,1f).apply { duration=420; repeatMode=ValueAnimator.REVERSE; repeatCount=ValueAnimator.INFINITE; addUpdateListener { dots.alpha=it.animatedValue as Float }; start() }
        }
        root.postDelayed({ if (!isFinishing && !isDestroyed) {
            val last = preferences.getString("last_route",null)
            if (last != null && last !in listOf("/login","/register","/privacy","/account-deletion")) showWeb(last) else showWelcome()
        } }, if (ValueAnimator.areAnimatorsEnabled()) 950L else 0L)
    }

    private fun showWelcome() {
        clearScreen()
        val scroll = ScrollView(this).apply { isFillViewport=true; clipToPadding=false }
        val body = vertical().apply { setPadding(dp(25),dp(24),dp(25),dp(20)) }
        val brand = LinearLayout(this).apply { gravity=Gravity.CENTER_VERTICAL }
        brand.addView(ImageView(this).apply { setImageResource(R.drawable.brand_mark); contentDescription=null },LinearLayout.LayoutParams(dp(43),dp(43)))
        brand.addView(label("ALMAS SDM",20f,navy,true),LinearLayout.LayoutParams(-2,-2).apply { marginStart=dp(12) })
        body.addView(brand)
        body.addView(label("YOUR SHOP. ONE CLEAR SYSTEM.",10.5f,navy,true).apply { letterSpacing=.13f; setPadding(dp(12),dp(9),dp(12),dp(9)); background=shape(sun,10) },LinearLayout.LayoutParams(-2,-2).apply { topMargin=dp(28) })
        body.addView(label("Your shop.\nClear control.",37f,navy,true).apply { setLineSpacing(0f,1.04f) },LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(17) })
        body.addView(label("Customers, installments and payments —\nwith your business wherever you go.",14f).apply { setLineSpacing(dp(4).toFloat(),1f) },LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(13) })
        body.addView(WelcomeArt(this),LinearLayout.LayoutParams(-1,dp(216)).apply { topMargin=dp(19); bottomMargin=dp(12) })
        body.addView(button("Sign in  →",sun) { showWeb("/login") },LinearLayout.LayoutParams(-1,dp(60)))
        body.addView(button("Create your account",cream) { showWeb("/register") },LinearLayout.LayoutParams(-1,dp(60)).apply { topMargin=dp(5) })
        body.addView(label("English  ·  Roman Urdu  ·  اردو",11f,navy).apply { gravity=Gravity.CENTER },LinearLayout.LayoutParams(-1,-2).apply { topMargin=dp(14) })
        val links=LinearLayout(this).apply { gravity=Gravity.CENTER }
        links.addView(label("Privacy",12f).apply { setPadding(dp(12),dp(18),dp(12),dp(12)); minHeight=dp(48); setOnClickListener { showWeb("/privacy") } })
        links.addView(label("Delete account",12f).apply { setPadding(dp(12),dp(18),dp(12),dp(12)); minHeight=dp(48); setOnClickListener { showWeb("/account-deletion") } })
        links.addView(label("Help",12f).apply { setPadding(dp(12),dp(18),dp(12),dp(12)); minHeight=dp(48); setOnClickListener { openExternal("https://wa.me/923211144477") } })
        body.addView(links)
        scroll.addView(body); root.addView(scroll,FrameLayout.LayoutParams(-1,-1))
    }

    @Suppress("SetJavaScriptEnabled")
    private fun showWeb(path: String) {
        clearScreen()
        currentUrl = BuildConfig.APP_ORIGIN + path.takeIf { it.startsWith('/') && !it.startsWith("//") }.orEmpty()
        val layout=vertical()
        val toolbar=LinearLayout(this).apply { gravity=Gravity.CENTER_VERTICAL; setPadding(dp(7),0,dp(7),0); setBackgroundColor(cream) }
        toolbar.addView(label("‹",32f,ink,true).apply { gravity=Gravity.CENTER; contentDescription="Go back"; setOnClickListener { onBackPressedDispatcher.onBackPressed() } },LinearLayout.LayoutParams(dp(44),dp(48)))
        pageTitle=label("ALMAS SDM",15f,navy,true).apply { maxLines=1;ellipsize=android.text.TextUtils.TruncateAt.END }
        toolbar.addView(pageTitle,LinearLayout.LayoutParams(0,-2,1f))
        toolbar.addView(label("⋮",28f,ink,true).apply { gravity=Gravity.CENTER; contentDescription="App menu"; setOnClickListener { showAppMenu(it) } },LinearLayout.LayoutParams(dp(44),dp(48)))
        layout.addView(toolbar,LinearLayout.LayoutParams(-1,dp(49)))
        val frame=FrameLayout(this)
        val web=WebView(this); browser=web
        web.setBackgroundColor(paper)
        web.settings.apply {
            javaScriptEnabled=true; domStorageEnabled=true
            allowFileAccess=false; allowContentAccess=true
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs=false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs=false
            mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled=true; mediaPlaybackRequiresUserGesture=true
            javaScriptCanOpenWindowsAutomatically=false; setSupportMultipleWindows(false)
            setSupportZoom(true); builtInZoomControls=true; displayZoomControls=false
            userAgentString += " AlmasSDMShop/${BuildConfig.VERSION_NAME} (${if(BuildConfig.PLAY_STORE) "Play" else "Direct"})"
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false)
        web.webViewClient=object:WebViewClient() {
            override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse? =
                if(request.method=="GET") bundledImage(request.url.toString()) else null
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean {
                val url=request.url.toString()
                if (NavigationPolicy.isInternal(url)) return false
                if (request.isForMainFrame && NavigationPolicy.isGateway(url)) { paymentFlow=true;return false }
                if (request.isForMainFrame && paymentFlow && NavigationPolicy.isSecureWebPage(url)) return false
                if (request.isForMainFrame && request.hasGesture()) openExternal(url)
                return true
            }
            override fun onPageStarted(view:WebView,url:String?,icon:Bitmap?) {
                // App pages draw their own Bold Easy header. Keep the native
                // domain/back bar for external hosted payment pages.
                toolbar.visibility=if(NavigationPolicy.isInternal(url)) View.GONE else View.VISIBLE
                if(NavigationPolicy.isInternal(url)) {paymentFlow=false;currentUrl=url!!;pageTitle?.text="ALMAS SDM";CookieManager.getInstance().setAcceptThirdPartyCookies(view,false)}
                else if(url!=null && NavigationPolicy.isSecureWebPage(url) && (paymentFlow || NavigationPolicy.isGateway(url))) {paymentFlow=true;currentUrl=url;pageTitle?.text=Uri.parse(url).host;pageTitle?.contentDescription="Payment page: ${Uri.parse(url).host}";CookieManager.getInstance().setAcceptThirdPartyCookies(view,true)}
                else if(url!=null && url!="about:blank") {view.stopLoading();openExternal(url);return}
                offline?.visibility=View.GONE;progress?.visibility=View.VISIBLE
            }
            override fun onPageFinished(view:WebView,url:String?) {
                progress?.visibility=View.GONE; CookieManager.getInstance().flush(); rememberRoute(url)
                if(NavigationPolicy.isInternal(url) && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                    val bridge=assets.open("native_bridge.js").bufferedReader().use { it.readText() }
                    view.evaluateJavascript(bridge,null)
                }
            }
            override fun doUpdateVisitedHistory(view:WebView,url:String?,isReload:Boolean) { rememberRoute(url) }
            override fun onReceivedError(view:WebView,request:WebResourceRequest,error:WebResourceError) { if(request.isForMainFrame) showOffline() }
            override fun onReceivedHttpError(view:WebView,request:WebResourceRequest,errorResponse:WebResourceResponse) { if(request.isForMainFrame && errorResponse.statusCode>=500)showOffline() }
            override fun onReceivedSslError(view:WebView,handler:SslErrorHandler,error:SslError) { handler.cancel(); if(error.url==view.url)showOffline() }
            override fun onRenderProcessGone(view:WebView,detail:RenderProcessGoneDetail):Boolean { view.post { showWeb(NavigationPolicy.safeRoute(currentUrl) ?: "/") }; return true }
        }
        web.webChromeClient=object:WebChromeClient() {
            override fun onProgressChanged(view:WebView,value:Int) { progress?.progress=value; if(value==100)progress?.visibility=View.GONE }
            override fun onShowFileChooser(view:WebView,callback:ValueCallback<Array<Uri>>,params:FileChooserParams):Boolean {
                if(!NavigationPolicy.isInternal(view.url))return false
                finishFileSelection(null); fileCallback=callback
                AlertDialog.Builder(this@MainActivity).setTitle("Add a photo or document")
                    .setItems(arrayOf("Take a photo","Choose a file")) { _,which -> if(which==0)requestPhoto()else chooseFile(params.acceptTypes) }
                    .setOnCancelListener { finishFileSelection(null) }.show()
                return true
            }
            override fun onPermissionRequest(request:PermissionRequest) {
                if(!NavigationPolicy.isInternal(request.origin.toString()) || !NavigationPolicy.isInternal(browser?.url) || !request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) { request.deny();return }
                if(ContextCompat.checkSelfPermission(this@MainActivity,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED) request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                else if(webPermission==null && photoPermissionAction==null) { webPermission=request; cameraPermission.launch(Manifest.permission.CAMERA) } else request.deny()
            }
            override fun onPermissionRequestCanceled(request:PermissionRequest) { if(webPermission===request)webPermission=null }
        }
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web,"AlmasDocument",setOf(BuildConfig.APP_ORIGIN)) { _,message,origin,mainFrame,reply ->
                if(mainFrame && NavigationPolicy.isInternal(origin.toString()) && message.type==WebMessageCompat.TYPE_STRING) receiveDocument(message.data) { reply.postMessage(it) }
            }
        }
        web.setDownloadListener { url,_,disposition,mime,_ -> download(url,URLUtil.guessFileName(url,disposition,mime),mime) }
        frame.addView(web,FrameLayout.LayoutParams(-1,-1))
        progress=ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal).apply { max=100; progressTintList=android.content.res.ColorStateList.valueOf(mint) }
        frame.addView(progress,FrameLayout.LayoutParams(-1,dp(3)).apply { gravity=Gravity.TOP })
        layout.addView(frame,LinearLayout.LayoutParams(-1,0,1f));root.addView(layout,FrameLayout.LayoutParams(-1,-1))
        web.loadUrl(currentUrl)
    }
    private fun rememberRoute(url:String?) { NavigationPolicy.safeRoute(url)?.takeUnless { it.startsWith("/api/") || it.startsWith("/downloads/") || it.startsWith("/ocr/") }?.let { preferences.edit().putString("last_route",it).apply() } }
    private fun showOffline() {
        progress?.visibility=View.GONE
        if(offline!=null){offline?.visibility=View.VISIBLE;return}
        val frame=browser?.parent as? FrameLayout ?:return
        offline=vertical().apply {
            gravity=Gravity.CENTER;setPadding(dp(32),dp(20),dp(32),dp(20));setBackgroundColor(paper)
            addView(label("Let’s reconnect.",27f,navy,true))
            addView(label("Check Wi-Fi or mobile data, then try again.\nYour account stays signed in.",14f).apply { gravity=Gravity.CENTER;setPadding(0,dp(15),0,dp(24)) })
            addView(button("Try again",sun) { visibility=View.GONE;browser?.loadUrl(currentUrl) },LinearLayout.LayoutParams(-1,dp(58)))
            addView(button("Back to welcome",cream) { showWelcome() },LinearLayout.LayoutParams(-1,dp(58)))
        }
        frame.addView(offline,FrameLayout.LayoutParams(-1,-1))
    }
    private fun showAppMenu(anchor:View) {
        PopupMenu(this,anchor).apply {
            val entries=mutableListOf(0 to "Home",1 to "Refresh page",2 to "Save / print page",4 to "Privacy",5 to "Delete account")
            if(!BuildConfig.PLAY_STORE)entries.add(3 to "Open in browser")
            entries.sortedBy { it.first }.forEach { (id,text)->menu.add(0,id,id,text) }
            setOnMenuItemClickListener { item ->
                when(item.itemId) {
                    0 -> browser?.loadUrl(BuildConfig.APP_ORIGIN+"/")
                    1 -> AlertDialog.Builder(this@MainActivity).setTitle("Refresh this page?").setMessage("Unsaved changes on this screen may be lost.").setNegativeButton("Cancel",null).setPositiveButton("Refresh") { _,_->browser?.reload() }.show()
                    2 -> printPage()
                    3 -> openExternal(currentUrl)
                    4 -> browser?.loadUrl(BuildConfig.APP_ORIGIN+"/privacy")
                    5 -> browser?.loadUrl(BuildConfig.APP_ORIGIN+"/account-deletion")
                };true
            };show()
        }
    }
    private fun chooseFile(types:Array<String>) {
        val accept=NavigationPolicy.acceptedMimeTypes(types)
        val intent=Intent(Intent.ACTION_OPEN_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type=if(accept.size==1)accept[0]else "*/*";putExtra(Intent.EXTRA_MIME_TYPES,if(accept.isEmpty())arrayOf("image/*","application/pdf")else accept) }
        runCatching { pickFile.launch(intent) }.onFailure { finishFileSelection(null);message("No file picker is available on this phone.") }
    }
    private fun requestPhoto() {
        val capture = {
            runCatching {
                val folder=File(cacheDir,"captures").apply { mkdirs() }
                cameraUri=FileProvider.getUriForFile(this,"${BuildConfig.APPLICATION_ID}.files",File.createTempFile("card-",".jpg",folder))
                pickFile.launch(Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply { putExtra(MediaStore.EXTRA_OUTPUT,cameraUri);addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION) })
            }.onFailure { cameraUri=null;finishFileSelection(null);message("Could not open the camera. Choose an existing photo instead.") }
            Unit
        }
        if(ContextCompat.checkSelfPermission(this,Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)capture()
        else if(webPermission==null && photoPermissionAction==null) {photoPermissionAction=capture;cameraPermission.launch(Manifest.permission.CAMERA)} else finishFileSelection(null)
    }
    private fun finishFileSelection(uris:Array<Uri>?) { fileCallback?.onReceiveValue(uris);fileCallback=null }
    private fun download(url:String,name:String,mime:String?) {
        if(pendingDocument!=null || pendingBlobNonce!=null) {message("Finish saving the current document first.");return}
        if(url.startsWith("blob:") && NavigationPolicy.isInternal(url.removePrefix("blob:")) && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            val nonce=UUID.randomUUID().toString();pendingBlobNonce=nonce
            val safeName=NavigationPolicy.safeFileName(name)
            val script="""(async()=>{try{const b=await(await fetch(${JSONObject.quote(url)})).blob();if(b.size>20971520)throw Error('This document is too large. Use the browser to download it.');const r=new FileReader();r.onload=()=>AlmasDocument.postMessage(JSON.stringify({nonce:${JSONObject.quote(nonce)},name:window.__almasDownloadName||${JSONObject.quote(safeName)},mime:b.type||'application/pdf',data:r.result}));r.readAsDataURL(b);}catch(e){AlmasDocument.postMessage(JSON.stringify({nonce:${JSONObject.quote(nonce)},error:String(e.message)}));}})()"""
            browser?.evaluateJavascript(script,null)
            root.postDelayed({if(pendingBlobNonce==nonce){pendingBlobNonce=null;message("The download timed out. Try again.")}},30000)
        } else if(NavigationPolicy.externalAllowed(url)) openExternal(url)
        else message("Use Save / print page in the app menu for this document.")
    }
    private fun printPage() { runCatching { browser?.let { (getSystemService(PRINT_SERVICE) as PrintManager).print("Almas SDM document",it.createPrintDocumentAdapter("Almas SDM"),null) } }.onFailure { message("Printing is not available. Save the document instead.") } }
    /** Serve only these public brand images locally, without changing API traffic. */
    internal fun bundledImage(url:String?):WebResourceResponse? {
        if(!NavigationPolicy.isInternal(url))return null
        return runCatching {
            val path=Uri.parse(url).path
            val name=path?.removePrefix("/icons/3d/")
            val image=when {
                path=="/logo-mark.webp" -> "image/webp" to assets.open("brand-mark.webp")
                path?.startsWith("/icons/3d/")==true && name in setOf("agreement.png","wallet.png","phone.png","customer.png") -> "image/png" to assets.open("home-icons/$name")
                else -> return null
            }
            WebResourceResponse(image.first,null,image.second).apply { responseHeaders=mapOf("Cache-Control" to "public, max-age=86400") }
        }.getOrNull()
    }

    internal fun receiveDocument(raw:String?, reply:((String)->Unit)?=null) {
        runCatching {
            if(raw==null || raw.length>29_000_000)return
            val data=JSONObject(raw)
            if(data.optString("action")=="vibrate") {
                if (!hasWindowFocus()) return
                val vibrator = getSystemService(VIBRATOR_SERVICE) as android.os.Vibrator
                if (vibrator.hasVibrator()) vibrator.vibrate(android.os.VibrationEffect.createWaveform(longArrayOf(0,120,80,120),-1))
                return
            }
            if(data.optString("action")=="menu") { showAppMenu(root);return }
            if(data.optString("action")=="print") { printPage();return }
            if(data.optString("action")=="copy") {
                val requestId=data.optString("requestId").take(100);val text=data.optString("text")
                if(reply==null || requestId.isBlank() || text.length>100000)return
                val result=runCatching {
                    val clip=android.content.ClipData.newPlainText("Almas SDM",text)
                    if(android.os.Build.VERSION.SDK_INT>=33)clip.description.extras=android.os.PersistableBundle().apply {putBoolean(android.content.ClipDescription.EXTRA_IS_SENSITIVE,true)}
                    (getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(clip)
                }
                val response=JSONObject().put("requestId",requestId).put("copied",result.isSuccess)
                if(result.isFailure)response.put("error","Could not copy this text. Try selecting it manually.")
                reply(response.toString());return
            }
            if(data.optString("action")=="requestDownload") {
                val requestId=data.optString("requestId").take(100)
                if(reply==null || requestId.isBlank())return
                if(pendingDocument!=null || pendingBlobNonce!=null) {reply(JSONObject().put("requestId",requestId).put("error","Finish saving the current document first.").toString());return}
                val issued=UUID.randomUUID().toString();pendingBlobNonce=issued
                reply(JSONObject().put("requestId",requestId).put("nonce",issued).toString())
                root.postDelayed({if(pendingBlobNonce==issued){pendingBlobNonce=null;message("The download timed out. Try again.")}},30000)
                return
            }
            val nonce=data.optString("nonce")
            if(nonce.isBlank() || nonce!=pendingBlobNonce)return
            pendingBlobNonce=null
            if(data.has("error")){message(data.optString("error"));return}
            val mime=data.optString("mime").takeIf { it in setOf("application/pdf","text/csv","application/csv","application/octet-stream","image/png","text/plain") } ?: "application/octet-stream"
            val encoded=data.getString("data").substringAfter("base64,","")
            val bytes=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT)
            if(bytes.size>20*1024*1024) {message("This document is too large. Open it in your browser.");return}
            pendingDocument=bytes
            saveDocument.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE);type=mime;putExtra(Intent.EXTRA_TITLE,NavigationPolicy.safeFileName(data.optString("name"))) })
        }.onFailure {pendingBlobNonce=null;pendingDocument=null;message("Could not prepare this download. Try Save / print page.")}
    }
    private fun openExternal(url:String) {
        if(!NavigationPolicy.externalAllowed(url))return
        runCatching { startActivity(Intent(if(url.startsWith("tel:")) Intent.ACTION_DIAL else Intent.ACTION_VIEW,Uri.parse(url))) }.onFailure {message("No app is available to open this link.")}
    }
    private fun message(text:String) {Toast.makeText(this,text,Toast.LENGTH_LONG).show()}
    override fun onDestroy() {splashAnimator?.cancel();finishFileSelection(null);webPermission?.deny();browser?.apply {stopLoading();destroy()};pendingDocument=null;super.onDestroy()}
}

/** A small native illustration in the same ink/cream/sun visual language. */
class WelcomeArt(context:android.content.Context):View(context) {
    private val p=Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onDraw(canvas:Canvas) {
        super.onDraw(canvas)
        val sx=width/340f;val sy=height/216f;canvas.save();canvas.scale(sx,sy)
        fun box(x:Float,y:Float,w:Float,h:Float,color:Int,r:Float=16f){p.color=Color.rgb(15,20,25);p.style=Paint.Style.FILL;canvas.drawRoundRect(x+4,y+4,x+w+4,y+h+4,r,r,p);p.color=color;canvas.drawRoundRect(x,y,x+w,y+h,r,r,p);p.color=Color.rgb(15,20,25);p.strokeWidth=2f;p.style=Paint.Style.STROKE;canvas.drawRoundRect(x,y,x+w,y+h,r,r,p);p.style=Paint.Style.FILL}
        fun text(s:String,x:Float,y:Float,size:Float,color:Int=Color.rgb(15,20,25),bold:Boolean=false){p.color=color;p.textSize=size;p.typeface=Typeface.create("sans-serif",if(bold)Typeface.BOLD else Typeface.NORMAL);canvas.drawText(s,x,y,p)}
        box(4f,18f,237f,163f,Color.rgb(18,48,95))
        text("YOUR BUSINESS",20f,43f,10f,Color.rgb(255,224,138),true)
        text("All in one place.",20f,68f,20f,Color.WHITE,true)
        listOf("Customers","Installments","Payments").forEachIndexed {i,s-> val y=94f+i*27;p.color=Color.rgb(123,224,194);canvas.drawCircle(25f,y-4,7f,p);text("✓",21f,y,10f,Color.rgb(15,20,25),true);text(s,41f,y+1,13f,Color.WHITE)}
        box(219f,2f,113f,192f,Color.rgb(255,253,246),22f)
        p.color=Color.rgb(15,20,25);canvas.drawRoundRect(251f,11f,300f,18f,4f,4f,p)
        text("ALMAS",242f,45f,13f,Color.rgb(18,48,95),true)
        p.color=Color.rgb(221,246,236);canvas.drawCircle(275f,91f,30f,p)
        text("✓",258f,105f,38f,Color.rgb(11,122,94),true)
        text("CLEAR CONTROL",233f,144f,9f,Color.rgb(18,48,95),true)
        p.color=Color.rgb(255,200,61);canvas.drawRoundRect(232f,155f,320f,179f,7f,7f,p)
        text("ON THE GO",246f,171f,10f,Color.rgb(15,20,25),true)
        canvas.restore()
    }
}

