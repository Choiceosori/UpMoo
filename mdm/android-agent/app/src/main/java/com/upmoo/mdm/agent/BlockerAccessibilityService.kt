package com.upmoo.mdm.agent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Point
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.Toast

/**
 * 접근성 서비스 — Phase 1 MVP의 핵심 차단 엔진.
 *
 * 1. TYPE_WINDOW_STATE_CHANGED로 전면 앱 패키지를 실시간 감지 → 차단 앱이면 즉시 홈으로 튕겨냄
 * 2. 브라우저 주소창 텍스트를 읽어 차단 사이트면 뒤로 가기 (웹 필터링)
 * 3. 화면 잠금/키오스크 상태에서 다른 앱으로 빠져나가면 다시 잠금/키오스크 화면으로 복귀
 * 4. 교사의 원격 제어 입력(탭/스와이프/뒤로/홈)을 dispatchGesture로 수행
 */
class BlockerAccessibilityService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var config: AgentConfig
    private val lastViolation = mutableMapOf<String, Long>()
    private var lastUrlCheck = 0L
    private var lastRelaunch = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        config = AgentConfig(this)
        instance = this
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onInterrupt() {}

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null || !config.joined) return
        val pkg = event.packageName?.toString() ?: return
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> onWindowChanged(pkg)
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> if (pkg in BROWSER_URL_BAR_IDS) checkBrowserUrl(pkg)
        }
    }

    private fun onWindowChanged(pkg: String) {
        if (pkg == packageName) return
        val essential = essentialPackages()
        if (pkg !in essential) foregroundPackage = pkg

        val policy = config.policy

        // 상단 알림창 내리기 차단 (Device Owner가 아니어도 동작하는 보조 수단)
        if (pkg == SYSTEM_UI && (policy.restricted("statusBar") || policy.kioskEnabled || config.locked)) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
            }
            return
        }
        if (pkg in essential) return

        // 잠금 화면에서 빠져나가려는 시도(홈 화면 포함) → 다시 잠금 화면
        if (config.locked) return relaunch { LockScreenActivity.show(this) }

        // 키오스크(소프트) 모드: Device Owner의 Lock Task가 없을 때 대체 수단
        if (policy.kioskEnabled) {
            val allowed = if (policy.kioskPackage.isNotEmpty()) setOf(policy.kioskPackage) else policy.allowedApps
            if (pkg !in allowed) {
                report("app", pkg)
                return relaunch { KioskActivity.show(this) }
            }
            return
        }

        val launchers = launcherPackages()
        if (pkg in launchers) return
        if (!policy.isAppAllowed(pkg, essential + launchers)) {
            performGlobalAction(GLOBAL_ACTION_HOME)
            toast("수업 중에는 사용할 수 없는 앱입니다")
            report("app", pkg)
            return
        }
        if (pkg in BROWSER_URL_BAR_IDS) checkBrowserUrl(pkg)
    }

    private fun checkBrowserUrl(pkg: String) {
        val policy = config.policy
        if (policy.webMode == "off" && policy.blockedKeywords.isEmpty()) return
        val now = System.currentTimeMillis()
        if (now - lastUrlCheck < URL_CHECK_INTERVAL_MS) return
        lastUrlCheck = now

        val root = rootInActiveWindow ?: return
        val ids = BROWSER_URL_BAR_IDS[pkg] ?: return
        for (id in ids) {
            val node = root.findAccessibilityNodeInfosByViewId("$pkg:id/$id").firstOrNull() ?: continue
            // 학생이 주소를 입력하는 중에는 판정하지 않음 (입력 완료 후 페이지 이동 시 판정)
            if (node.isFocused) return
            val text = node.text?.toString()?.trim() ?: return
            if (!looksLikeUrl(text)) return
            if (!policy.isUrlAllowed(text)) {
                performGlobalAction(GLOBAL_ACTION_BACK)
                toast("수업 중에는 접속할 수 없는 사이트입니다")
                report("web", text)
            }
            return
        }
    }

    private fun looksLikeUrl(text: String) = text.isNotEmpty() && !text.contains(' ') && text.contains('.')

    private fun relaunch(block: () -> Unit) {
        val now = System.currentTimeMillis()
        if (now - lastRelaunch < 500) return
        lastRelaunch = now
        block()
    }

    private fun report(kind: String, target: String) {
        val now = System.currentTimeMillis()
        val key = "$kind:$target"
        if (now - (lastViolation[key] ?: 0L) < VIOLATION_THROTTLE_MS) return
        lastViolation[key] = now
        AgentService.instance?.reportViolation(kind, target)
    }

    private fun toast(text: String) {
        handler.post { Toast.makeText(this, text, Toast.LENGTH_SHORT).show() }
    }

    // ------------------------------------------------------------------ allowed packages

    private fun currentImePackage(): String? =
        Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
            ?.let { ComponentName.unflattenFromString(it)?.packageName }

    /** 잠금/키오스크 중에도 허용: 시스템 UI·키보드·전화(긴급 통화)·권한 대화상자 */
    private fun essentialPackages(): Set<String> {
        val set = mutableSetOf(packageName, SYSTEM_UI, "android")
        set += PHONE_PACKAGES
        set += PERMISSION_PACKAGES
        currentImePackage()?.let { set += it }
        return set
    }

    /** 일반 수업 중에는 홈 화면(런처)으로 돌아가는 것을 허용 */
    private fun launcherPackages(): Set<String> {
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
        return packageManager.queryIntentActivities(home, 0).map { it.activityInfo.packageName }.toSet()
    }

    // ------------------------------------------------------------------ remote control

    fun performRemote(action: String, x: Float, y: Float, x2: Float, y2: Float, durationMs: Long) {
        handler.post {
            when (action) {
                "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
                "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
                "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
                "tap" -> gesture(x, y, x, y, 60)
                "long_press" -> gesture(x, y, x, y, 800)
                "swipe" -> gesture(x, y, x2, y2, durationMs.coerceIn(50, 3000))
            }
        }
    }

    private fun gesture(x: Float, y: Float, x2: Float, y2: Float, duration: Long) {
        val size = screenSize()
        val path = Path().apply {
            moveTo(x * size.x, y * size.y)
            if (x != x2 || y != y2) lineTo(x2 * size.x, y2 * size.y)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, duration)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    private fun screenSize(): Point {
        val wm = service<WindowManager>()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = wm.currentWindowMetrics.bounds
            Point(b.width(), b.height())
        } else {
            Point().also {
                @Suppress("DEPRECATION")
                wm.defaultDisplay.getRealSize(it)
            }
        }
    }

    companion object {
        private const val URL_CHECK_INTERVAL_MS = 700L
        private const val VIOLATION_THROTTLE_MS = 5_000L
        private const val SYSTEM_UI = "com.android.systemui"

        @Volatile
        var instance: BlockerAccessibilityService? = null
            private set

        /** 하트비트로 교사에게 보고되는 현재 전면 앱 */
        @Volatile
        var foregroundPackage: String = ""

        private val PHONE_PACKAGES = setOf(
            "com.android.phone",
            "com.android.server.telecom",
            "com.android.dialer",
            "com.google.android.dialer",
            "com.samsung.android.dialer",
            "com.android.emergency",
            "com.google.android.apps.safetyhub",
        )

        private val PERMISSION_PACKAGES = setOf(
            "com.android.permissioncontroller",
            "com.google.android.permissioncontroller",
        )

        /** 주요 브라우저의 주소창 View ID */
        val BROWSER_URL_BAR_IDS: Map<String, List<String>> = mapOf(
            "com.android.chrome" to listOf("url_bar"),
            "com.chrome.beta" to listOf("url_bar"),
            "com.brave.browser" to listOf("url_bar"),
            "com.microsoft.emmx" to listOf("url_bar"),
            "com.naver.whale" to listOf("url_bar"),
            "com.sec.android.app.sbrowser" to listOf("location_bar_edit_text"),
            "org.mozilla.firefox" to listOf("mozac_browser_toolbar_url_view", "url_bar_title"),
            "com.opera.browser" to listOf("url_field"),
        )

        fun isEnabled(context: Context): Boolean {
            val enabled = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ) ?: return false
            val me = ComponentName(context, BlockerAccessibilityService::class.java)
            return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
        }
    }
}
