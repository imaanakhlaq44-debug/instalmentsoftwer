package pk.almassdm.dpc.ui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import pk.almassdm.dpc.R
import pk.almassdm.dpc.admin.LockController

/**
 * What a customer sees once the shop has let the phone go.
 *
 * Usually that is the last installment being paid. Every restriction is
 * already gone by the time this shows; it says so plainly and offers the one
 * thing left to do, which is to remove the app.
 */
class ReleasedActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dp = resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(px(24), px(48), px(24), px(32))
        }

        column.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_shield)
            contentDescription = getString(R.string.app_name)
            layoutParams = LinearLayout.LayoutParams(px(72), px(72))
        })

        column.addView(TextView(this).apply {
            text = getString(R.string.released_title)
            textSize = 24f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            gravity = Gravity.CENTER
            setPadding(0, px(16), 0, 0)
        })

        column.addView(TextView(this).apply {
            text = getString(R.string.released_body)
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(0, px(12), 0, 0)
        })

        // Only offer removal once Android will actually allow it.
        val removable = !LockController(this).isDeviceOwner
        column.addView(TextView(this).apply {
            text = getString(if (removable) R.string.released_remove_hint else R.string.released_owner_left)
            textSize = 14f
            gravity = Gravity.CENTER
            setPadding(0, px(16), 0, 0)
        })

        if (removable) {
            column.addView(Button(this).apply {
                text = getString(R.string.released_remove_app)
                setOnClickListener {
                    runCatching {
                        startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:$packageName")))
                    }
                }
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = px(24) }
            })
        }

        column.addView(Button(this).apply {
            text = getString(R.string.released_close)
            setOnClickListener { finish() }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = px(8) }
        })

        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(column)
        })
    }
}
