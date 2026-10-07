package com.upmoo.mdm.agent

import android.app.Activity
import android.app.Notification
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import kotlin.math.min
import kotlin.math.roundToInt

data class CaptureConfig(
    val enabled: Boolean = false,
    val intervalMs: Long = 3000,
    val maxWidth: Int = 320,
    val quality: Int = 45,
)

/**
 * MediaProjection으로 화면을 캡처해 JPEG 썸네일을 서버로 전송합니다.
 * 전송 주기/해상도는 서버가 capture_config로 지시합니다
 * (교사가 아무도 보지 않으면 중지, 그리드 보기는 저빈도·저해상도, 확대 보기/발표는 고빈도·고해상도).
 */
class ScreenCaptureService : Service() {
    private lateinit var thread: HandlerThread
    private lateinit var handler: Handler
    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null

    private val tick = object : Runnable {
        override fun run() {
            captureOnce()
            val c = config
            handler.postDelayed(this, if (c.enabled && c.intervalMs > 0) c.intervalMs else IDLE_POLL_MS)
        }
    }

    override fun onCreate() {
        super.onCreate()
        thread = HandlerThread("screen-capture").also { it.start() }
        handler = Handler(thread.looper)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = Notification.Builder(this, AgentApp.CHANNEL_SERVICE)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("선생님이 화면을 볼 수 있습니다")
            .setContentText("수업 모니터링을 위해 화면을 공유하고 있습니다")
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
        @Suppress("DEPRECATION")
        val data: Intent? = intent?.getParcelableExtra(EXTRA_DATA)
        if (resultCode != Activity.RESULT_OK || data == null || projection != null) {
            if (projection == null) stopSelf()
            return START_NOT_STICKY
        }

        val mpm = service<MediaProjectionManager>()
        val mp = mpm.getMediaProjection(resultCode, data) ?: run {
            stopSelf()
            return START_NOT_STICKY
        }
        projection = mp
        mp.registerCallback(
            object : MediaProjection.Callback() {
                override fun onStop() {
                    stopSelf()
                }
            },
            handler,
        )
        createDisplay(mp)
        running = true
        handler.post(tick)
        return START_NOT_STICKY
    }

    /** 최대 해상도(포커스 모드 기준)로 한 번 만들어 두고, 전송 시 config.maxWidth로 축소합니다. */
    private fun createDisplay(mp: MediaProjection) {
        val metrics = resources.displayMetrics
        val scale = min(1f, MAX_CAPTURE_WIDTH.toFloat() / metrics.widthPixels)
        val width = (metrics.widthPixels * scale).roundToInt()
        val height = (metrics.heightPixels * scale).roundToInt()
        val r = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
        reader = r
        display = mp.createVirtualDisplay(
            "upmoo-capture",
            width,
            height,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            r.surface,
            null,
            handler,
        )
    }

    private fun captureOnce() {
        val c = config
        val agent = AgentService.instance ?: return
        if (!c.enabled || c.intervalMs <= 0) return
        val image = try {
            reader?.acquireLatestImage()
        } catch (e: IllegalStateException) {
            null
        } ?: return
        try {
            val plane = image.planes[0]
            val pixelStride = plane.pixelStride
            val rowPadding = plane.rowStride - pixelStride * image.width
            val padded = Bitmap.createBitmap(image.width + rowPadding / pixelStride, image.height, Bitmap.Config.ARGB_8888)
            padded.copyPixelsFromBuffer(plane.buffer)
            val cropped = Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
            val scale = min(1f, c.maxWidth.toFloat() / image.width)
            val out = if (scale < 1f) {
                Bitmap.createScaledBitmap(cropped, (image.width * scale).roundToInt(), (image.height * scale).roundToInt(), true)
            } else {
                cropped
            }
            val bytes = ByteArrayOutputStream()
            out.compress(Bitmap.CompressFormat.JPEG, c.quality.coerceIn(10, 90), bytes)
            agent.sendFrame(Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP), out.width, out.height)
            if (out !== cropped) out.recycle()
            if (cropped !== padded) cropped.recycle()
            padded.recycle()
        } catch (e: Exception) {
            Log.w(TAG, "capture failed", e)
        } finally {
            image.close()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        running = false
        handler.removeCallbacksAndMessages(null)
        display?.release()
        reader?.close()
        projection?.stop()
        projection = null
        thread.quitSafely()
        super.onDestroy()
    }

    companion object {
        private const val TAG = "ScreenCapture"
        private const val NOTIFICATION_ID = 2
        private const val MAX_CAPTURE_WIDTH = 960
        private const val IDLE_POLL_MS = 1000L
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_DATA = "data"

        @Volatile
        var running = false
            private set

        @Volatile
        var config = CaptureConfig()
            private set

        fun updateConfig(newConfig: CaptureConfig) {
            config = newConfig
        }

        fun start(context: Context, resultCode: Int, data: Intent) {
            val intent = Intent(context, ScreenCaptureService::class.java)
                .putExtra(EXTRA_RESULT_CODE, resultCode)
                .putExtra(EXTRA_DATA, data)
            context.startForegroundService(intent)
        }
    }
}

/** 화면 캡처 동의 대화상자를 띄우기 위한 투명 액티비티 */
class CapturePermissionActivity : Activity() {
    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        super.onCreate(savedInstanceState)
        val mpm = service<MediaProjectionManager>()
        @Suppress("DEPRECATION")
        startActivityForResult(mpm.createScreenCaptureIntent(), REQUEST_CODE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE && resultCode == RESULT_OK && data != null) {
            ScreenCaptureService.start(this, resultCode, data)
        }
        finish()
    }

    companion object {
        private const val REQUEST_CODE = 1001
    }
}
