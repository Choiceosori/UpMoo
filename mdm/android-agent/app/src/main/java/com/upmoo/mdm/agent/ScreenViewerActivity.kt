package com.upmoo.mdm.agent

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Bundle
import android.util.Base64
import android.view.Gravity
import android.view.KeyEvent
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import java.lang.ref.WeakReference

/** 교사 화면 / 발표 학생 화면을 전체 화면으로 표시 (전자칠판 모드) */
class ScreenViewerActivity : Activity() {
    private lateinit var image: ImageView
    private lateinit var label: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!active) return finish()
        current = WeakReference(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        image = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            setBackgroundColor(Color.BLACK)
        }
        label = TextView(this).apply {
            setTextColor(Color.WHITE)
            setBackgroundColor(Color.parseColor("#55000000"))
            setPadding(24, 8, 24, 8)
        }
        setContentView(
            FrameLayout(this).apply {
                addView(image, FrameLayout.LayoutParams(-1, -1))
                addView(
                    label,
                    FrameLayout.LayoutParams(-2, -2, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = 24 },
                )
            },
        )
        LockScreenActivity.hideSystemBars(this)
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        render()
    }

    private fun render() {
        label.text = viewerLabel
        lastFrame?.let { image.setImageBitmap(it) }
    }

    override fun onDestroy() {
        if (current?.get() === this) current = null
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // 화면 전송 중에는 학생이 임의로 닫을 수 없음
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean =
        if (keyCode == KeyEvent.KEYCODE_BACK) true else super.onKeyDown(keyCode, event)

    companion object {
        private var current: WeakReference<ScreenViewerActivity>? = null

        @Volatile
        private var active = false

        @Volatile
        private var lastFrame: Bitmap? = null

        @Volatile
        private var viewerLabel = ""

        fun show(context: Context, label: String) {
            active = true
            viewerLabel = label
            lastFrame = null
            val intent = Intent(context, ScreenViewerActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            AgentService.startActivityFromBackground(context, intent)
        }

        /** OkHttp 스레드에서 호출 — 디코딩 후 UI 스레드로 전달 */
        fun onFrame(base64: String) {
            if (!active) return
            val bytes = try {
                Base64.decode(base64, Base64.DEFAULT)
            } catch (e: IllegalArgumentException) {
                return
            }
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return
            lastFrame = bitmap
            current?.get()?.let { activity -> activity.runOnUiThread { activity.image.setImageBitmap(bitmap) } }
        }

        fun dismiss() {
            active = false
            lastFrame = null
            current?.get()?.let { it.runOnUiThread { it.finish() } }
        }
    }
}
