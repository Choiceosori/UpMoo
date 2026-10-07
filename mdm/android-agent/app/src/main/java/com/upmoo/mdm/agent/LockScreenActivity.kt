package com.upmoo.mdm.agent

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import java.lang.ref.WeakReference

/** "선생님을 보세요" 전체 화면 잠금 */
class LockScreenActivity : Activity() {
    private lateinit var config: AgentConfig
    private lateinit var label: TextView
    private var startedLockTask = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = AgentConfig(this)
        if (!config.locked) return finish()
        current = WeakReference(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setShowWhenLocked(true)
        setTurnScreenOn(true)

        label = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 40f
            gravity = Gravity.CENTER
        }
        val sub = TextView(this).apply {
            text = "선생님이 화면을 잠갔습니다"
            setTextColor(Color.parseColor("#8FA0C4"))
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(0, 24, 0, 0)
        }
        val lockIcon = TextView(this).apply {
            text = "🔒"
            textSize = 64f
            gravity = Gravity.CENTER
        }
        setContentView(
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                setBackgroundColor(Color.parseColor("#121A2B"))
                addView(lockIcon)
                addView(label)
                addView(sub)
            },
        )
        hideSystemBars(this)
    }

    override fun onResume() {
        super.onResume()
        if (!config.locked) return finish()
        label.text = config.lockText
        // Device Owner면 Lock Task로 홈/최근 앱/알림창까지 완전히 차단
        val device = DeviceController(this)
        if (device.isDeviceOwner() && !device.isInLockTask()) {
            try {
                startLockTask()
                startedLockTask = true
            } catch (_: Exception) {
            }
        }
    }

    fun unlock() {
        if (startedLockTask && !config.policy.kioskEnabled) {
            try {
                stopLockTask()
            } catch (_: Exception) {
            }
        }
        finish()
    }

    override fun onDestroy() {
        if (current?.get() === this) current = null
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // 잠금 중 뒤로 가기 무시
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean =
        if (keyCode == KeyEvent.KEYCODE_BACK) true else super.onKeyDown(keyCode, event)

    companion object {
        private var current: WeakReference<LockScreenActivity>? = null

        fun show(context: Context) {
            val intent = Intent(context, LockScreenActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            AgentService.startActivityFromBackground(context, intent)
        }

        fun dismiss() {
            current?.get()?.unlock()
        }

        @Suppress("DEPRECATION")
        fun hideSystemBars(activity: Activity) {
            activity.window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                )
        }
    }
}
