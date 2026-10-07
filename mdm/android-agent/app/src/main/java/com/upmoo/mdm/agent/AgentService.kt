package com.upmoo.mdm.agent

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import android.widget.Toast
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 서버와의 실시간 연결을 유지하는 포그라운드 서비스.
 * 연결이 끊겨도 저장된 정책은 접근성 서비스/DeviceController가 계속 적용하며, 자동 재연결합니다.
 */
class AgentService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .build()
    private lateinit var config: AgentConfig
    private lateinit var device: DeviceController
    private var socket: WebSocket? = null
    private var connected = false
    private var stopped = false
    private var retryMs = INITIAL_RETRY_MS

    private val heartbeat = object : Runnable {
        override fun run() {
            sendHeartbeat()
            handler.postDelayed(this, HEARTBEAT_MS)
        }
    }

    private val reconnect = Runnable { connect() }

    private val volumeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val policy = config.policy
            if (policy.volumeLocked) device.applyVolume(policy)
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        config = AgentConfig(this)
        device = DeviceController(this)
        val notification = buildNotification("서버에 연결하는 중…")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        val filter = IntentFilter("android.media.VOLUME_CHANGED_ACTION")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(volumeReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(volumeReceiver, filter)
        }
        // 오프라인 상태로 시작해도 마지막 정책/잠금 상태를 즉시 복원
        applyPolicy(showToast = false)
        if (config.locked) LockScreenActivity.show(this)
        connect()
        handler.postDelayed(heartbeat, HEARTBEAT_MS)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopped = true
        handler.removeCallbacksAndMessages(null)
        socket?.close(1000, "service stopped")
        socket = null
        try {
            unregisterReceiver(volumeReceiver)
        } catch (_: Exception) {
        }
        if (instance === this) instance = null
        if (config.joined) {
            status = "연결 안 됨"
            statusListener?.invoke(status)
        }
        super.onDestroy()
    }

    // ------------------------------------------------------------------ connection

    private fun connect() {
        if (stopped || socket != null) return
        val url = config.serverUrl
        if (url.isEmpty()) return setStatus("서버 주소가 없습니다")
        setStatus("서버에 연결하는 중…")
        val request = try {
            Request.Builder().url(url).build()
        } catch (e: IllegalArgumentException) {
            return setStatus("서버 주소 형식 오류: $url")
        }
        socket = client.newWebSocket(request, Listener())
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            handler.post {
                if (webSocket !== socket) return@post
                val hello = JSONObject()
                    .put("type", "hello")
                    .put("role", "student")
                    .put("pin", config.pin)
                    .put("name", config.name)
                    .put("number", config.number)
                    .put("deviceId", config.deviceId)
                    .put("platform", "android ${Build.VERSION.RELEASE} · ${Build.MODEL}")
                config.token?.let { hello.put("token", it) }
                webSocket.send(hello.toString())
            }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val msg = try {
                JSONObject(text)
            } catch (e: Exception) {
                return
            }
            // 화면 전송 프레임은 디코딩 비용이 커서 메인 스레드를 거치지 않습니다.
            if (msg.optString("type") == "broadcast_frame") {
                ScreenViewerActivity.onFrame(msg.optString("data"))
                return
            }
            handler.post { if (webSocket === socket) handle(msg) }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            handler.post { onDisconnected(webSocket) }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "connection failure", t)
            handler.post { onDisconnected(webSocket) }
        }
    }

    private fun onDisconnected(webSocket: WebSocket) {
        if (webSocket !== socket) return
        socket = null
        connected = false
        ScreenViewerActivity.dismiss()
        if (stopped) return
        setStatus("연결 끊김 — ${retryMs / 1000}초 후 재연결 (정책은 계속 적용 중)")
        handler.removeCallbacks(reconnect)
        handler.postDelayed(reconnect, retryMs)
        retryMs = (retryMs * 2).coerceAtMost(MAX_RETRY_MS)
    }

    // ------------------------------------------------------------------ messages

    private fun handle(msg: JSONObject) {
        when (msg.optString("type")) {
            "welcome" -> {
                connected = true
                retryMs = INITIAL_RETRY_MS
                config.token = msg.optString("token")
                config.className = msg.optString("className")
                msg.optJSONObject("policy")?.let { config.policyJson = it.toString() }
                applyPolicy(showToast = false)
                setLock(msg.optBoolean("locked"), null)
                setStatus("수업 연결됨: ${config.className}")
                sendHeartbeat()
            }
            "rejected", "removed" -> {
                val reason = if (msg.optString("type") == "removed") "선생님이 수업에서 내보냈습니다" else msg.optString("error")
                leaveClass(this, reason)
            }
            "policy" -> {
                msg.optJSONObject("policy")?.let { config.policyJson = it.toString() }
                applyPolicy(showToast = true)
            }
            "lock" -> setLock(msg.optBoolean("locked"), msg.optString("text").takeIf { it.isNotEmpty() })
            "open_url" -> openUrl(msg.optString("url"))
            "message" -> showMessage(msg.optString("text"))
            "capture_config" -> ScreenCaptureService.updateConfig(
                CaptureConfig(
                    enabled = msg.optBoolean("enabled"),
                    intervalMs = msg.optLong("intervalMs", 3000),
                    maxWidth = msg.optInt("maxWidth", 320),
                    quality = msg.optInt("quality", 45),
                ),
            )
            "broadcast_start" -> ScreenViewerActivity.show(
                this,
                if (msg.optString("source") == "teacher") "선생님 화면" else "친구 발표 화면",
            )
            "broadcast_stop" -> ScreenViewerActivity.dismiss()
            "remote_input" -> BlockerAccessibilityService.instance?.performRemote(
                action = msg.optString("action"),
                x = msg.optDouble("x", 0.0).toFloat(),
                y = msg.optDouble("y", 0.0).toFloat(),
                x2 = msg.optDouble("x2", 0.0).toFloat(),
                y2 = msg.optDouble("y2", 0.0).toFloat(),
                durationMs = msg.optLong("durationMs", 300),
            )
        }
    }

    private fun applyPolicy(showToast: Boolean) {
        val policy = config.policy
        device.apply(policy)
        if (policy.kioskEnabled) KioskActivity.show(this) else KioskActivity.dismiss()
        if (showToast) Toast.makeText(this, "선생님이 기기 사용 정책을 변경했습니다", Toast.LENGTH_SHORT).show()
    }

    private fun setLock(locked: Boolean, text: String?) {
        config.locked = locked
        if (text != null) config.lockText = text
        if (locked) LockScreenActivity.show(this) else LockScreenActivity.dismiss()
    }

    private fun openUrl(url: String) {
        if (!config.policy.isUrlAllowed(url)) {
            reportViolation("web", url)
            return
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivityFromBackground(this, intent)
    }

    private fun showMessage(text: String) {
        val nm = service<NotificationManager>()
        val n = Notification.Builder(this, AgentApp.CHANNEL_MESSAGE)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("선생님 알림")
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .build()
        nm.notify(System.currentTimeMillis().toInt(), n)
        Toast.makeText(this, "📢 $text", Toast.LENGTH_LONG).show()
    }

    // ------------------------------------------------------------------ outgoing

    private fun send(msg: JSONObject): Boolean {
        val ws = socket ?: return false
        if (!connected) return false
        return ws.send(msg.toString())
    }

    private fun sendHeartbeat() {
        val pkg = BlockerAccessibilityService.foregroundPackage
        val label = try {
            if (pkg.isEmpty()) "" else packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
        } catch (e: Exception) {
            ""
        }
        val battery = service<BatteryManager>().getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        send(
            JSONObject()
                .put("type", "heartbeat")
                .put("foregroundApp", pkg)
                .put("foregroundLabel", label)
                .put("battery", battery)
                .put("kioskActive", device.isInLockTask())
                .put(
                    "capabilities",
                    JSONObject()
                        .put("accessibility", BlockerAccessibilityService.isEnabled(this))
                        .put("capture", ScreenCaptureService.running)
                        .put("deviceAdmin", device.isAdminActive())
                        .put("deviceOwner", device.isDeviceOwner()),
                ),
        )
    }

    /** ScreenCaptureService에서 호출 (백그라운드 스레드) */
    fun sendFrame(base64Jpeg: String, width: Int, height: Int) {
        val ws = socket ?: return
        // 네트워크가 밀려있으면 프레임을 버려 지연 누적/메모리 증가를 방지
        if (!connected || ws.queueSize() > MAX_QUEUE_BYTES) return
        ws.send(
            JSONObject().put("type", "frame").put("data", base64Jpeg).put("w", width).put("h", height).toString(),
        )
    }

    fun reportViolation(kind: String, target: String) {
        handler.post { send(JSONObject().put("type", "violation").put("kind", kind).put("target", target)) }
    }

    // ------------------------------------------------------------------ status / notification

    private fun setStatus(text: String) {
        status = text
        service<NotificationManager>().notify(NOTIFICATION_ID, buildNotification(text))
        statusListener?.invoke(text)
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(this, AgentApp.CHANNEL_SERVICE)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle("UpMoo 수업 관리")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val TAG = "AgentService"
        private const val NOTIFICATION_ID = 1
        private const val HEARTBEAT_MS = 5_000L
        private const val INITIAL_RETRY_MS = 1_000L
        private const val MAX_RETRY_MS = 30_000L
        private const val MAX_QUEUE_BYTES = 1_000_000L

        @Volatile
        var instance: AgentService? = null
            private set

        @Volatile
        var status: String = "연결 안 됨"
            private set

        /** MainActivity 상태 표시용 (메인 스레드에서 호출) */
        var statusListener: ((String) -> Unit)? = null

        fun start(context: Context) {
            context.startForegroundService(Intent(context, AgentService::class.java))
        }

        fun leaveClass(context: Context, reason: String?) {
            val config = AgentConfig(context)
            config.leave()
            DeviceController(context).releaseAll()
            LockScreenActivity.dismiss()
            KioskActivity.dismiss()
            ScreenViewerActivity.dismiss()
            context.stopService(Intent(context, ScreenCaptureService::class.java))
            context.stopService(Intent(context, AgentService::class.java))
            status = reason ?: "수업에서 나왔습니다"
            statusListener?.invoke(status)
            if (reason != null) Toast.makeText(context, reason, Toast.LENGTH_LONG).show()
        }

        /**
         * Android 10+ 백그라운드 액티비티 실행 제한: 접근성 서비스(시스템 바인딩)나
         * Device Owner 앱은 예외이므로 가능한 컨텍스트를 우선 사용합니다.
         */
        fun startActivityFromBackground(context: Context, intent: Intent) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val ctx: Context = BlockerAccessibilityService.instance ?: context
            try {
                ctx.startActivity(intent)
            } catch (e: Exception) {
                Log.w(TAG, "startActivity failed", e)
            }
        }
    }
}
