package com.upmoo.mdm.agent

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import kotlin.concurrent.thread

/**
 * '우리반 수업' 앱.
 * 학생 화면(웹)을 그대로 띄우고, 사이트가 여는 새 창은 크롬으로 나가지 않고 앱 위쪽 탭으로 열어요.
 * 선생님은 열린 탭을 보고(카드 "탭: …"), 모두 돌아오기·앱 탭 모두 닫기로 닫을 수 있어요.
 */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var device: DeviceController
    private lateinit var root: LinearLayout
    private lateinit var tabBar: LinearLayout
    private lateinit var tabScroll: HorizontalScrollView
    private lateinit var content: FrameLayout
    private var main: WebView? = null
    private var capture: CaptureController? = null
    private val tabs = mutableListOf<Tab>()
    private var current: Tab? = null
    private var pinned = false

    private class Tab(val id: Int, val view: WebView, var title: String, var url: String)
    private var nextTabId = 1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        device = DeviceController(this)
        intent?.data?.getQueryParameter("server")?.let { prefs.server = Prefs.normalize(it) }
        if (prefs.server.isEmpty()) showSetup(null) else showLesson()
    }

    // ================================================================== 서버 주소 설정

    private fun showSetup(error: String?) {
        destroyWebViews()
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), dp(48), dp(28), dp(28))
            setBackgroundColor(Color.parseColor("#F3F6FA"))
        }
        box.addView(text("우리반 수업", 28f, Color.parseColor("#0459AA"), bold = true))
        box.addView(text("선생님이 알려 준 서버 주소를 처음 한 번 넣어요", 16f, Color.parseColor("#3F4A59")).apply { setPadding(0, dp(8), 0, dp(20)) })
        val input = EditText(this).apply {
            hint = "예: 192.168.0.10:8787"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
            setText(prefs.server.removePrefix("http://"))
        }
        box.addView(input, LinearLayout.LayoutParams(dp(420).coerceAtMost(resources.displayMetrics.widthPixels - dp(56)), ViewGroup.LayoutParams.WRAP_CONTENT))
        val msg = text(error ?: "", 14f, Color.parseColor("#E5484D")).apply { setPadding(0, dp(10), 0, dp(10)) }
        box.addView(msg)
        box.addView(Button(this).apply {
            text = "연결하기"
            setOnClickListener {
                val server = Prefs.normalize(input.text.toString())
                if (server.isEmpty()) return@setOnClickListener
                msg.text = "확인하는 중…"
                isEnabled = false
                thread {
                    val ok = try {
                        val conn = URI("$server/api/config").toURL().openConnection() as HttpURLConnection
                        conn.connectTimeout = 5000
                        conn.readTimeout = 5000
                        val code = conn.responseCode
                        conn.disconnect()
                        code == 200
                    } catch (e: Exception) {
                        false
                    }
                    runOnUiThread {
                        isEnabled = true
                        if (ok) {
                            prefs.server = server
                            showLesson()
                        } else {
                            msg.text = "서버에 연결하지 못했어요. 주소와 학교 와이파이를 확인해 주세요."
                        }
                    }
                }
            }
        })
        setContentView(box)
    }

    // ================================================================== 수업 화면

    @SuppressLint("SetJavaScriptEnabled")
    private fun showLesson() {
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        tabBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(6), dp(4), dp(6), dp(4))
        }
        tabScroll = HorizontalScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#E8F7FD"))
            isHorizontalScrollBarEnabled = false
            addView(tabBar)
            visibility = View.GONE
        }
        content = FrameLayout(this)
        root.addView(tabScroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)

        val web = newWebView(isMain = true)
        web.addJavascriptInterface(Bridge(), "WooriApp")
        content.addView(web)
        main = web
        capture = CaptureController(
            this,
            onFrame = { data, w, h -> js("window.wooriApp&&window.wooriApp.onFrame(${JSONObject.quote(data)},$w,$h,'image')") },
            onState = { state -> js("window.wooriApp&&window.wooriApp.onCaptureState(${JSONObject.quote(state)})") },
        )
        val code = intent?.data?.getQueryParameter("c")
        web.loadUrl(if (code != null) "${prefs.server}/?c=${Uri.encode(code)}" else "${prefs.server}/")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun newWebView(isMain: Boolean): WebView = WebView(this).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.setSupportMultipleWindows(true)
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                val scheme = uri.scheme ?: return true
                if (scheme != "http" && scheme != "https") return true // intent:, market: 등으로 앱 밖에 나가지 않게
                if (isGoogleLogin(uri)) {
                    openGoogleLoginTab(uri)
                    return true
                }
                // 학생 화면 자체의 이동은 그대로, 바깥 사이트로 가려 하면 탭으로
                if (isMain && request.isForMainFrame && !uri.toString().startsWith(prefs.server)) {
                    openTab(uri.toString(), "")
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView, url: String) {
                tabs.find { it.view === view }?.let {
                    it.url = url
                    if (!view.title.isNullOrBlank()) it.title = view.title!!
                    drawTabs()
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                if (isMain && request.isForMainFrame) showSetup("서버에 연결하지 못했어요 (${error.description}). 주소를 확인해 주세요.")
            }
        }
        webChromeClient = object : WebChromeClient() {
            // 사이트가 연 새 창 → 앱 안의 새 탭
            override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
                val tab = addTab("", "새 탭")
                (resultMsg.obj as WebView.WebViewTransport).webView = tab.view
                resultMsg.sendToTarget()
                return true
            }

            override fun onCloseWindow(window: WebView) {
                tabs.find { it.view === window }?.let { closeTab(it) }
            }

            override fun onReceivedTitle(view: WebView, title: String?) {
                tabs.find { it.view === view }?.let {
                    it.title = title ?: it.title
                    drawTabs()
                }
            }
        }
    }

    // ================================================================== 탭

    private fun openTab(url: String, title: String) {
        val uri = Uri.parse(url)
        if (isGoogleLogin(uri)) return openGoogleLoginTab(uri)
        tabs.find { it.url == url }?.let { return showTab(it) }
        addTab(url, title.ifBlank { uri.host ?: "탭" }).view.loadUrl(url)
    }

    private fun addTab(url: String, title: String): Tab {
        if (tabs.size >= MAX_TABS) closeTab(tabs.first())
        val tab = Tab(nextTabId++, newWebView(isMain = false), title, url)
        tabs += tab
        content.addView(tab.view)
        showTab(tab)
        return tab
    }

    private fun showTab(tab: Tab?) {
        current = tab
        main?.visibility = if (tab == null) View.VISIBLE else View.INVISIBLE
        for (t in tabs) t.view.visibility = if (t === tab) View.VISIBLE else View.GONE
        drawTabs()
    }

    private fun closeTab(tab: Tab) {
        tabs.remove(tab)
        content.removeView(tab.view)
        tab.view.destroy()
        if (current === tab) showTab(tabs.lastOrNull()) else drawTabs()
    }

    private fun closeAllTabs() {
        for (t in tabs.toList()) {
            content.removeView(t.view)
            t.view.destroy()
        }
        tabs.clear()
        showTab(null)
    }

    private fun drawTabs() {
        if (!::tabBar.isInitialized) return
        tabBar.removeAllViews()
        tabScroll.visibility = if (tabs.isEmpty()) View.GONE else View.VISIBLE
        tabBar.addView(chip("📚 수업", current == null, null) { showTab(null) })
        for (t in tabs) tabBar.addView(chip(t.title.ifBlank { "새 탭" }, current === t, { closeTab(t) }) { showTab(t) })
        reportTabs()
    }

    private fun chip(label: String, selected: Boolean, onClose: (() -> Unit)?, onClick: () -> Unit): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(6), dp(8), dp(6))
            setBackgroundColor(if (selected) Color.WHITE else Color.TRANSPARENT)
            setOnClickListener { onClick() }
        }
        row.addView(TextView(this).apply {
            text = label
            maxWidth = dp(180)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            setTextColor(Color.parseColor(if (selected) "#0459AA" else "#3F4A59"))
            if (selected) setTypeface(typeface, Typeface.BOLD)
        })
        if (onClose != null) {
            row.addView(TextView(this).apply {
                text = "  ✕"
                setTextColor(Color.parseColor("#6B7686"))
                setOnClickListener { onClose() }
            })
        }
        return row.also {
            it.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(4) }
        }
    }

    /** 선생님 카드에 "앱 · 탭 2", "탭: 리딩앤"이 보이도록 학생 화면에 알려요 */
    private fun reportTabs() {
        val arr = JSONArray()
        for (t in tabs) arr.put(JSONObject().put("title", t.title).put("url", t.url).put("current", t === current))
        js("window.wooriApp&&window.wooriApp.onTabs(${JSONObject.quote(arr.toString())})")
    }

    // ================================================================== 구글 로그인 탭

    private fun isGoogleLogin(uri: Uri) = uri.host == "accounts.google.com"

    /** 구글은 앱 안 화면(WebView) 로그인을 막아서 크롬 탭(Custom Tab)으로 열어요 */
    private fun openGoogleLoginTab(uri: Uri) {
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            putExtras(Bundle().apply { putBinder(EXTRA_CUSTOM_TABS_SESSION, null) })
            putExtra(EXTRA_CUSTOM_TABS_TOOLBAR_COLOR, Color.parseColor("#0459AA"))
            setPackage(DeviceController.CHROME)
        }
        try {
            startActivity(intent)
        } catch (e: Exception) {
            try {
                startActivity(intent.setPackage(null))
            } catch (_: Exception) {
                Toast.makeText(this, "구글 로그인 탭을 열 수 없어요. 크롬이 설치되어 있는지 확인해 주세요.", Toast.LENGTH_LONG).show()
                return
            }
        }
        val arr = JSONArray()
        for (t in tabs) arr.put(JSONObject().put("title", t.title).put("url", t.url).put("current", false))
        arr.put(JSONObject().put("title", "구글 로그인 탭").put("url", "").put("current", true))
        js("window.wooriApp&&window.wooriApp.onTabs(${JSONObject.quote(arr.toString())})")
    }

    // ================================================================== 학생 화면 ↔ 앱 다리

    private inner class Bridge {
        @JavascriptInterface
        fun setCapture(mode: String, intervalMs: Long, maxWidth: Int) = runOnUiThread { capture?.set(mode, intervalMs, maxWidth) }

        @JavascriptInterface
        fun openTab(url: String, title: String) = runOnUiThread { this@MainActivity.openTab(url, title) }

        @JavascriptInterface
        fun closeTabs() = runOnUiThread { closeAllTabs() }

        @JavascriptInterface
        fun setPinned(on: Boolean) = runOnUiThread { pin(on) }

        @JavascriptInterface
        fun changeServer() = runOnUiThread { showSetup(null) }
    }

    private fun pin(on: Boolean) {
        if (on == pinned) return
        pinned = on
        try {
            if (on) {
                LessonService.start(this)
                if (!device.isPinned()) startLockTask()
            } else {
                LessonService.stop(this)
                if (device.isPinned()) stopLockTask()
            }
        } catch (_: Exception) {
            // 고정을 거절해도 수업은 계속돼요 (선생님 화면에 '앱 벗어남'으로 보여요)
        }
    }

    private fun js(code: String) {
        runOnUiThread { main?.evaluateJavascript(code, null) }
    }

    // ================================================================== 생명주기

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == CaptureController.REQUEST) capture?.onProjectionResult(resultCode, data)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val server = intent.data?.getQueryParameter("server")
        if (server != null) {
            prefs.server = Prefs.normalize(server)
            showLesson()
        }
    }

    override fun onResume() {
        super.onResume()
        main?.onResume()
    }

    override fun onPause() {
        // 학생 화면이 '앱 벗어남'을 알 수 있도록 페이지를 숨김 상태로 바꿔요(연결은 유지).
        main?.onPause()
        super.onPause()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            val tab = current
            when {
                tab != null && tab.view.canGoBack() -> tab.view.goBack()
                tab != null -> showTab(null)
                else -> Unit // 수업 화면에서는 뒤로 가기로 앱을 나가지 않아요
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        capture?.release()
        destroyWebViews()
        LessonService.stop(this)
        super.onDestroy()
    }

    private fun destroyWebViews() {
        for (t in tabs) t.view.destroy()
        tabs.clear()
        current = null
        main?.destroy()
        main = null
    }

    private fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(color)
        gravity = Gravity.CENTER
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    companion object {
        private const val MAX_TABS = 5
        private const val EXTRA_CUSTOM_TABS_SESSION = "android.support.customtabs.extra.SESSION"
        private const val EXTRA_CUSTOM_TABS_TOOLBAR_COLOR = "android.support.customtabs.extra.TOOLBAR_COLOR"
    }
}
