package com.upmoo.mdm.agent

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.widget.GridLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.lang.ref.WeakReference

/**
 * 락다운(키오스크) 모드.
 * - 정책의 kiosk.packageName이 있으면 해당 학습 앱 하나로 고정
 * - 없으면 허용 앱(allowedApps)만 보여주는 전용 런처 화면으로 고정
 * Device Owner면 Lock Task(홈/최근 앱/알림창/전원 메뉴 차단), 아니면 접근성 서비스가 복귀시킴.
 */
class KioskActivity : Activity() {
    private lateinit var config: AgentConfig
    private lateinit var grid: GridLayout
    private lateinit var header: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = AgentConfig(this)
        if (!config.policy.kioskEnabled) return finish()
        current = WeakReference(this)

        header = TextView(this).apply {
            textSize = 20f
            setTextColor(Color.parseColor("#1B2230"))
            setPadding(48, 64, 48, 16)
        }
        val hint = TextView(this).apply {
            text = "선생님이 화면을 고정했습니다. 아래 앱만 사용할 수 있습니다."
            setTextColor(Color.parseColor("#6B7486"))
            setPadding(48, 0, 48, 32)
        }
        grid = GridLayout(this).apply {
            columnCount = 4
            setPadding(32, 0, 32, 32)
        }
        setContentView(
            ScrollView(this).apply {
                setBackgroundColor(Color.parseColor("#F4F6FA"))
                addView(
                    LinearLayout(this@KioskActivity).apply {
                        orientation = LinearLayout.VERTICAL
                        addView(header)
                        addView(hint)
                        addView(grid)
                    },
                )
            },
        )
    }

    override fun onResume() {
        super.onResume()
        val policy = config.policy
        if (!policy.kioskEnabled) return exitKiosk()

        val device = DeviceController(this)
        if (device.isDeviceOwner() && !device.isInLockTask()) {
            try {
                startLockTask()
            } catch (_: Exception) {
            }
        }
        header.text = "📌 키오스크 모드 · ${config.className}"

        if (policy.kioskPackage.isNotEmpty()) {
            // 단일 앱 고정: 이 화면으로 돌아오면 즉시 학습 앱을 다시 실행
            val launch = packageManager.getLaunchIntentForPackage(policy.kioskPackage)
            if (launch != null) {
                startActivity(launch)
                return
            }
        }
        renderApps(policy)
    }

    private fun renderApps(policy: Policy) {
        grid.removeAllViews()
        val packages = if (policy.kioskPackage.isNotEmpty()) listOf(policy.kioskPackage) else policy.allowedApps.sorted()
        val size = resources.displayMetrics.widthPixels / 4 - 32
        for (pkg in packages) {
            val launch = packageManager.getLaunchIntentForPackage(pkg) ?: continue
            val info = try {
                packageManager.getApplicationInfo(pkg, 0)
            } catch (e: Exception) {
                continue
            }
            val cell = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(8, 16, 8, 16)
                isClickable = true
                setOnClickListener { startActivity(launch) }
                addView(ImageView(this@KioskActivity).apply { setImageDrawable(packageManager.getApplicationIcon(info)) }, LinearLayout.LayoutParams(size / 2, size / 2))
                addView(
                    TextView(this@KioskActivity).apply {
                        text = packageManager.getApplicationLabel(info)
                        gravity = Gravity.CENTER
                        maxLines = 2
                        textSize = 12f
                    },
                )
            }
            grid.addView(cell, GridLayout.LayoutParams().apply { width = size })
        }
        if (grid.childCount == 0) {
            grid.addView(TextView(this).apply { text = "사용 가능한 앱이 없습니다. 선생님의 안내를 기다리세요." })
        }
    }

    private fun exitKiosk() {
        try {
            stopLockTask()
        } catch (_: Exception) {
        }
        finish()
    }

    override fun onDestroy() {
        if (current?.get() === this) current = null
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean =
        if (keyCode == KeyEvent.KEYCODE_BACK) true else super.onKeyDown(keyCode, event)

    companion object {
        private var current: WeakReference<KioskActivity>? = null

        fun show(context: Context) {
            val intent = Intent(context, KioskActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            AgentService.startActivityFromBackground(context, intent)
        }

        fun dismiss() {
            current?.get()?.let { it.runOnUiThread { it.exitKiosk() } }
        }
    }
}
