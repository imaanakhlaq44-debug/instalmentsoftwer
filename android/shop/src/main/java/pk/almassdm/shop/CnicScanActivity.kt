package pk.almassdm.shop

import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Live CNIC scanner. The shop holds the card inside the frame; every camera
 * frame is read on the phone (ML Kit, offline) and the result is taken as soon
 * as two frames agree on the number and the name. No photo is kept, and nothing
 * leaves the phone except the fields the page puts in the sale form.
 *
 * Returns [EXTRA_JSON] in the same shape as [CnicCard.toJson], or {"ok":false,"reason":…}.
 * "fallback" asks the caller to use the phone's own camera app instead.
 */
class CnicScanActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_LANG = "lang"
        const val EXTRA_JSON = "json"
        /** After this long, whatever was read is good enough to hand back for checking. */
        private const val SETTLE_MS = 9_000L
        /** Once number and name agree, how long to keep reading for the father's name and the dates. */
        private const val EXTRAS_MS = 1_500L
        fun intent(context: Context, lang: String) = Intent(context, CnicScanActivity::class.java).putExtra(EXTRA_LANG, lang)
    }

    private val ink = Color.rgb(15, 20, 25)
    private val sun = Color.rgb(255, 200, 61)
    private val mint = Color.rgb(29, 185, 143)
    private val cream = Color.rgb(255, 253, 246)

    private lateinit var lang: String
    private lateinit var preview: PreviewView
    private lateinit var guide: CardGuide
    private lateinit var hint: TextView
    private lateinit var status: TextView
    private lateinit var torchButton: Button
    private lateinit var shutter: Button
    private var camera: Camera? = null
    private var capture: ImageCapture? = null
    private lateinit var analysis: ExecutorService
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private val vote = CnicVote()
    private val done = AtomicBoolean(false)
    private var started = 0L
    private var firstSeen = 0L
    private var completeAt = 0L
    private var torchOn = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        lang = intent.getStringExtra(EXTRA_LANG)?.takeIf { it in setOf("en", "ru", "ur") } ?: "ru"
        analysis = Executors.newSingleThreadExecutor()
        setContentView(layout())
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = finishWith("""{"ok":false,"reason":"cancelled"}""")
        })
        startCamera()
    }

    // ------------------------------------------------------------------ layout
    private fun layout(): View {
        val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        preview = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER; implementationMode = PreviewView.ImplementationMode.COMPATIBLE }
        guide = CardGuide(this)
        root.addView(preview, FrameLayout.LayoutParams(-1, -1))
        root.addView(guide, FrameLayout.LayoutParams(-1, -1))

        val top = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; setPadding(dp(20), dp(16), dp(20), 0) }
        hint = label(text("hold"), 17f, true)
        status = label("", 15f, false).apply { visibility = View.GONE; background = pill(Color.argb(200, 15, 20, 25)); setPadding(dp(14), dp(6), dp(14), dp(6)) }
        top.addView(hint)
        top.addView(status, LinearLayout.LayoutParams(-2, -2).apply { topMargin = dp(10) })
        root.addView(top, FrameLayout.LayoutParams(-1, -2, Gravity.TOP))

        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; setPadding(dp(16), 0, dp(16), dp(20)) }
        val cancel = button(text("cancel"), false) { finishWith("""{"ok":false,"reason":"cancelled"}""") }
        torchButton = button(text("light"), false) { toggleTorch() }
        shutter = button(text("photo"), true) { takePhoto() }
        bar.addView(cancel, LinearLayout.LayoutParams(0, dp(56), 1f).apply { marginEnd = dp(8) })
        bar.addView(torchButton, LinearLayout.LayoutParams(0, dp(56), 1f).apply { marginEnd = dp(8) })
        bar.addView(shutter, LinearLayout.LayoutParams(0, dp(56), 1.3f))
        root.addView(bar, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))

        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            top.setPadding(dp(20), bars.top + dp(16), dp(20), 0)
            bar.setPadding(dp(16), 0, dp(16), bars.bottom + dp(20))
            insets
        }
        if (lang == "ur") { root.layoutDirection = View.LAYOUT_DIRECTION_RTL }
        return root
    }

    private fun label(value: String, size: Float, bold: Boolean) = TextView(this).apply {
        text = value; textSize = size; setTextColor(Color.WHITE); gravity = Gravity.CENTER
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setShadowLayer(6f, 0f, 1f, Color.BLACK)
    }

    private fun button(value: String, primary: Boolean, click: () -> Unit) = Button(this).apply {
        text = value; isAllCaps = false; textSize = 15f; setTypeface(typeface, Typeface.BOLD)
        setTextColor(ink)
        background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(if (primary) sun else cream); setStroke(dp(2), ink) }
        setOnClickListener { performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY); click() }
    }

    private fun pill(color: Int) = GradientDrawable().apply { cornerRadius = dp(999).toFloat(); setColor(color) }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    // ------------------------------------------------------------------ camera
    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            runCatching {
                val provider = future.get()
                val previewCase = Preview.Builder().build().also { it.setSurfaceProvider(preview.surfaceProvider) }
                @Suppress("DEPRECATION")
                val analysisCase = ImageAnalysis.Builder()
                    .setTargetResolution(android.util.Size(1280, 960))
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build().also { it.setAnalyzer(analysis, ::analyze) }
                val captureCase = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build()
                provider.unbindAll()
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, previewCase, analysisCase, captureCase)
                capture = captureCase
                if (camera?.cameraInfo?.hasFlashUnit() != true) torchButton.visibility = View.GONE
                started = SystemClock.elapsedRealtime()
            }.onFailure { finishWith("""{"ok":false,"reason":"fallback"}""") }
        }, ContextCompat.getMainExecutor(this))
    }

    @androidx.annotation.OptIn(ExperimentalGetImage::class)
    private fun analyze(frame: ImageProxy) {
        val media = frame.image
        if (done.get() || media == null) { frame.close(); return }
        val rotation = frame.imageInfo.rotationDegrees
        val upright = if (rotation % 180 == 0) Size(frame.width, frame.height) else Size(frame.height, frame.width)
        val lines = runCatching {
            val text = Tasks.await(recognizer.process(InputImage.fromMediaImage(media, rotation)))
            text.textBlocks.flatMap { it.lines }.mapNotNull { l -> l.boundingBox?.let { OcrLine(l.text, it.left, it.top, it.right, it.bottom) } }
        }.getOrDefault(emptyList())
        frame.close()
        if (done.get()) return
        val inside = insideGuide(lines, upright)
        if (inside.isNotEmpty()) vote.add(CnicCardReader.read(inside))
        val now = SystemClock.elapsedRealtime()
        val elapsed = now - started
        // The time limits count from when a card was first seen, not from when the camera opened.
        if (firstSeen == 0L && vote.seenAnything) firstSeen = now
        if (completeAt == 0L && vote.complete) completeAt = now
        runOnUiThread { showProgress(inside.isNotEmpty(), elapsed) }
        when {
            vote.everything -> finishWith(vote.result().toJson().toString(), success = true)
            // Number and name agreed: a moment more for the father's name and dates, then go.
            completeAt != 0L && now - completeAt > EXTRAS_MS -> finishWith(vote.result().toJson().toString(), success = true)
            firstSeen != 0L && now - firstSeen > SETTLE_MS && vote.cnicConfirmed -> finishWith(vote.result(final = true).toJson().toString(), success = true)
        }
    }

    /**
     * Only text that sits inside the on-screen card frame counts, so a receipt,
     * a box label or another card on the counter cannot leak into the form.
     */
    private fun insideGuide(lines: List<OcrLine>, image: Size): List<OcrLine> {
        val frame = guide.frame
        val vw = preview.width.toFloat(); val vh = preview.height.toFloat()
        if (frame.isEmpty || vw == 0f || vh == 0f) return lines
        val scale = maxOf(vw / image.width, vh / image.height)
        val dx = (vw - image.width * scale) / 2f; val dy = (vh - image.height * scale) / 2f
        val slack = RectF(frame).apply { inset(-frame.width() * 0.08f, -frame.height() * 0.12f) }
        return lines.filter { l -> slack.contains((l.left + l.right) / 2f * scale + dx, (l.top + l.bottom) / 2f * scale + dy) }
    }

    private fun showProgress(cardInView: Boolean, elapsed: Long) {
        if (done.get()) return
        val seen = vote.result(final = true)
        guide.state = when { vote.cnicConfirmed -> CardGuide.State.LOCKED; cardInView -> CardGuide.State.READING; else -> CardGuide.State.IDLE }
        hint.text = when {
            vote.cnicConfirmed -> text("hold_name")
            elapsed > SETTLE_MS && !vote.seenAnything -> text("tips")
            cardInView -> text("reading")
            else -> text("hold")
        }
        val parts = listOfNotNull(seen.cnic, seen.name)
        status.visibility = if (parts.isEmpty()) View.GONE else View.VISIBLE
        status.text = parts.joinToString("  ·  ")
    }

    private fun toggleTorch() {
        val cam = camera ?: return
        torchOn = !torchOn
        cam.cameraControl.enableTorch(torchOn)
        torchButton.text = text(if (torchOn) "light_off" else "light")
    }

    /** The shop's own shutter: one sharp full-size photo, read the thorough way, merged with what the frames agreed. */
    private fun takePhoto() {
        val cap = capture ?: return
        if (done.get()) return
        shutter.isEnabled = false
        hint.text = text("reading")
        val photo = File.createTempFile("cnic-", ".jpg", File(cacheDir, "captures").apply { mkdirs() })
        cap.takePicture(ImageCapture.OutputFileOptions.Builder(photo).build(), ContextCompat.getMainExecutor(this), object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                lifecycleScope.launch {
                    val card = withContext(Dispatchers.Default) { runCatching { CnicPhotoReader.read(this@CnicScanActivity, photo) }.getOrNull() }
                    photo.delete()
                    // The still photo is sharper than any one frame, so it counts twice.
                    card?.let { vote.add(it); vote.add(it) }
                    val result = vote.result(final = true)
                    if (result.cnic != null || result.name != null) finishWith(result.toJson().toString(), success = true)
                    else { shutter.isEnabled = true; hint.text = text("tips") }
                }
            }
            override fun onError(error: ImageCaptureException) { photo.delete(); shutter.isEnabled = true; hint.text = text("tips") }
        })
    }

    private fun finishWith(json: String, success: Boolean = false) {
        if (!done.compareAndSet(false, true)) return
        runOnUiThread {
            if (success) { guide.state = CardGuide.State.LOCKED; buzz() }
            setResult(RESULT_OK, Intent().putExtra(EXTRA_JSON, json))
            // Test builds opened straight from adb have no page to answer: show what was read instead.
            if (BuildConfig.DEBUG && callingActivity == null) {
                android.util.Log.i("CnicScan", "frames=${vote.frames} ms=${SystemClock.elapsedRealtime() - started} $json")
                androidx.appcompat.app.AlertDialog.Builder(this).setTitle("CNIC scan result")
                    .setMessage(runCatching { org.json.JSONObject(json).toString(2) }.getOrDefault(json))
                    .setPositiveButton("OK") { _, _ -> finish() }.setOnCancelListener { finish() }.show()
                return@runOnUiThread
            }
            finish()
        }
    }

    private fun buzz() {
        runCatching {
            val vibrator = if (Build.VERSION.SDK_INT >= 31) (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
                           else @Suppress("DEPRECATION") (getSystemService(VIBRATOR_SERVICE) as Vibrator)
            vibrator.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE))
        }
    }

    override fun onDestroy() {
        done.set(true)
        analysis.shutdown()
        recognizer.close()
        super.onDestroy()
    }

    private data class Size(val width: Int, val height: Int)

    // ------------------------------------------------------------------ words
    private fun text(key: String): String = (WORDS[lang] ?: WORDS.getValue("ru"))[key] ?: key

    private val WORDS = mapOf(
        "en" to mapOf(
            "hold" to "Hold the FRONT of the CNIC inside the frame",
            "reading" to "Reading… keep the card still",
            "hold_name" to "Number read. Keep still for the name…",
            "tips" to "Can't read it. Use more light, avoid glare, bring the card closer — or press Take photo.",
            "cancel" to "Cancel", "light" to "Light", "light_off" to "Light off", "photo" to "Take photo",
        ),
        "ru" to mapOf(
            "hold" to "CNIC ka SAAMNE wala hissa frame ke andar rakhein",
            "reading" to "Parh raha hai… card hilayein nahi",
            "hold_name" to "Number parh liya. Naam ke liye ruk jayein…",
            "tips" to "Parha nahi ja raha. Roshni barhayein, chamak se bachayein, card qareeb karein — ya Photo lein dabayein.",
            "cancel" to "Wapas", "light" to "Roshni", "light_off" to "Roshni band", "photo" to "Photo lein",
        ),
        "ur" to mapOf(
            "hold" to "شناختی کارڈ کا سامنے والا حصہ فریم کے اندر رکھیں",
            "reading" to "پڑھا جا رہا ہے… کارڈ نہ ہلائیں",
            "hold_name" to "نمبر پڑھ لیا۔ نام کے لیے رکے رہیں…",
            "tips" to "پڑھا نہیں جا رہا۔ روشنی بڑھائیں، چمک سے بچائیں، کارڈ قریب کریں — یا تصویر لیں دبائیں۔",
            "cancel" to "واپس", "light" to "روشنی", "light_off" to "روشنی بند", "photo" to "تصویر لیں",
        ),
    )
}

/** Darkens everything but a CNIC-shaped window (85.6 × 54 mm) and draws its corners. */
class CardGuide(context: Context) : View(context) {
    enum class State { IDLE, READING, LOCKED }
    var state = State.IDLE
        set(value) { if (field != value) { field = value; invalidate() } }
    val frame = RectF()
    private val shade = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(150, 0, 0, 0) }
    private val clear = Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR) }
    private val corner = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeWidth = 6 * resources.displayMetrics.density }

    init { setLayerType(LAYER_TYPE_HARDWARE, null) }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        val width = minOf(w * 0.9f, h * 0.62f * 85.6f / 54f)
        val height = width * 54f / 85.6f
        val cx = w / 2f; val cy = h * 0.46f
        frame.set(cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2)
    }

    override fun onDraw(canvas: Canvas) {
        val r = 14 * resources.displayMetrics.density
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), shade)
        canvas.drawRoundRect(frame, r, r, clear)
        corner.color = when (state) { State.LOCKED -> Color.rgb(29, 185, 143); State.READING -> Color.rgb(255, 200, 61); State.IDLE -> Color.WHITE }
        val len = frame.width() * 0.12f
        with(frame) {
            canvas.drawLine(left, top + len, left, top + r, corner); canvas.drawLine(left + r, top, left + len, top, corner)
            canvas.drawLine(right - len, top, right - r, top, corner); canvas.drawLine(right, top + r, right, top + len, corner)
            canvas.drawLine(left, bottom - len, left, bottom - r, corner); canvas.drawLine(left + r, bottom, left + len, bottom, corner)
            canvas.drawLine(right - len, bottom, right - r, bottom, corner); canvas.drawLine(right, bottom - r, right, bottom - len, corner)
        }
    }
}
