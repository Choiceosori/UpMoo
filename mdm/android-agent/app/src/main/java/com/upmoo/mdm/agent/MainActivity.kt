package com.upmoo.mdm.agent

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast

/** 수업 참여 + 필수 권한 설정 화면 */
class MainActivity : Activity() {
    private lateinit var config: AgentConfig
    private lateinit var device: DeviceController
    private lateinit var server: EditText
    private lateinit var pin: EditText
    private lateinit var name: EditText
    private lateinit var number: EditText
    private lateinit var joinButton: Button
    private lateinit var status: TextView
    private lateinit var permissions: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = AgentConfig(this)
        device = DeviceController(this)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(28), dp(20), dp(28))
        }
        root.addView(text("UpMoo 수업 관리", 24f, bold = true))
        root.addView(text("선생님이 알려준 서버 주소와 수업 PIN을 입력하세요.", 14f, Color.GRAY))

        server = input("서버 주소 (예: 192.168.0.10:8787)", InputType.TYPE_TEXT_VARIATION_URI)
        pin = input("수업 PIN 6자리", InputType.TYPE_CLASS_NUMBER)
        name = input("이름", InputType.TYPE_TEXT_VARIATION_PERSON_NAME)
        number = input("번호 (선택)", InputType.TYPE_CLASS_NUMBER)
        listOf(server, pin, name, number).forEach(root::addView)

        joinButton = Button(this).apply { setOnClickListener { onJoinClicked() } }
        root.addView(joinButton)
        status = text("", 14f, Color.DKGRAY).apply { setPadding(0, dp(8), 0, dp(16)) }
        root.addView(status)

        root.addView(text("필수 권한", 18f, bold = true))
        permissions = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(permissions)

        setContentView(ScrollView(this).apply { addView(root) })

        server.setText(config.serverUrl)
        pin.setText(config.pin)
        name.setText(config.name)
        number.setText(config.number)
        handleDeepLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    /** upmoo-mdm://join?server=ws://...&pin=123456 */
    private fun handleDeepLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme != "upmoo-mdm") return
        data.getQueryParameter("server")?.let { server.setText(it) }
        data.getQueryParameter("pin")?.let { pin.setText(it) }
        if (!config.joined) name.requestFocus()
    }

    override fun onResume() {
        super.onResume()
        AgentService.statusListener = { runOnUiThread { refresh() } }
        refresh()
    }

    override fun onPause() {
        AgentService.statusListener = null
        super.onPause()
    }

    private fun onJoinClicked() {
        if (config.joined) {
            // 수업 중(정책 적용 중)에는 학생이 임의로 나갈 수 없도록 잠금/키오스크 상태에서는 차단
            if (config.locked || config.policy.kioskEnabled) {
                Toast.makeText(this, "선생님이 제한 중일 때는 나갈 수 없습니다", Toast.LENGTH_SHORT).show()
                return
            }
            AgentService.leaveClass(this, null)
            refresh()
            return
        }
        val url = AgentConfig.normalizeServerUrl(server.text.toString())
        if (url.isEmpty() || pin.text.isBlank() || name.text.isBlank()) {
            Toast.makeText(this, "서버 주소, PIN, 이름을 모두 입력하세요", Toast.LENGTH_SHORT).show()
            return
        }
        if (config.pin != pin.text.toString().trim() || config.serverUrl != url) config.token = null
        config.serverUrl = url
        config.pin = pin.text.toString().trim()
        config.name = name.text.toString().trim()
        config.number = number.text.toString().trim()
        config.joined = true
        server.setText(url)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        AgentService.start(this)
        refresh()
    }

    private fun refresh() {
        val joined = config.joined
        listOf(server, pin, name, number).forEach { it.isEnabled = !joined }
        joinButton.text = if (joined) "수업 나가기" else "수업 참여하기"
        status.text = if (joined) AgentService.status else "참여하지 않음"

        permissions.removeAllViews()
        permissionRow(
            "접근성 서비스",
            "앱·웹 차단과 원격 지원에 필요합니다. 설정 > 접근성 > 설치된 앱 > UpMoo 수업 관리를 켜세요.",
            BlockerAccessibilityService.isEnabled(this),
        ) { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        permissionRow(
            "화면 공유",
            "선생님이 수업 중 화면을 볼 수 있도록 합니다. 기기를 다시 켜면 다시 허용해야 합니다.",
            ScreenCaptureService.running,
        ) { startActivity(Intent(this, CapturePermissionActivity::class.java)) }
        permissionRow(
            "기기 관리자",
            "카메라 제한 등 기본 통제 기능에 필요합니다.",
            device.isAdminActive(),
        ) { startActivity(device.adminRequestIntent()) }
        val power = service<PowerManager>()
        permissionRow(
            "배터리 최적화 제외",
            "백그라운드에서 연결이 끊기지 않도록 합니다.",
            power.isIgnoringBatteryOptimizations(packageName),
        ) {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")),
            )
        }
        permissions.addView(
            text(
                if (device.isDeviceOwner()) {
                    "✅ Device Owner 모드: 하드웨어 제한·키오스크·앱 삭제 방지가 모두 적용됩니다."
                } else {
                    "ℹ️ Device Owner가 아니어서 일부 기능(블루투스/핫스팟 제한, 완전한 키오스크, 앱 삭제 방지)은 제한적으로 동작합니다. 관리자는 PC에서 다음 명령으로 설정하세요:\nadb shell dpm set-device-owner $packageName/.MdmDeviceAdminReceiver"
                },
                12f,
                Color.GRAY,
            ).apply { setPadding(0, dp(12), 0, 0) },
        )
    }

    private fun permissionRow(title: String, desc: String, granted: Boolean, onClick: () -> Unit) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(10), 0, dp(10))
        }
        row.addView(text("${if (granted) "✅" else "⚠️"} $title", 16f, bold = true))
        row.addView(text(desc, 12f, Color.GRAY))
        if (!granted) {
            row.addView(Button(this).apply {
                text = "$title 허용하기"
                setOnClickListener { onClick() }
            })
        }
        permissions.addView(row)
    }

    private fun input(hint: String, type: Int) = EditText(this).apply {
        this.hint = hint
        inputType = if (type == InputType.TYPE_CLASS_NUMBER) type else InputType.TYPE_CLASS_TEXT or type
        isSingleLine = true
    }

    private fun text(value: String, size: Float, color: Int = Color.BLACK, bold: Boolean = false) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        textAlignment = View.TEXT_ALIGNMENT_VIEW_START
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
