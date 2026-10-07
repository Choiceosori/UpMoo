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

/** 화면 한 장을 JPEG(base64)로 */
fun Bitmap.toJpegBase64(maxWidth: Int, quality: Int = 60): Triple<String, Int, Int> {
    val scale = min(1f, maxWidth.toFloat() / width)
    val out = if (scale < 1f) Bitmap.createScaledBitmap(this, (width * scale).roundToInt(), (height * scale).roundToInt(), true) else this
    val bytes = ByteArrayOutputStream()
    out.compress(Bitmap.CompressFormat.JPEG, quality, bytes)
    val result = Triple(Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP), out.width, out.height)
    if (out !== this) out.recycle()
    return result
}

/**
 * 실시간 화면: MediaProjection(학생이 "녹화 또는 전송을 시작할까요?"에서 시작을 누름)으로
 * 태블릿 화면 전체를 그림으로 보내요. 앱 밖 화면도 보여요.
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
            handler.postDelayed(this, intervalMs.coerceAtLeast(100))
        }
    }

    override fun onCreate() {
        super.onCreate()
        thread = HandlerThread("projection").also { it.start() }
        handler = Handler(thread.looper)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = Notification.Builder(this, AgentApp.CHANNEL_LESSON)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("선생님이 내 화면을 실시간으로 보는 중")
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(2, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(2, n)
        }
        val code = intent?.getIntExtra(EXTRA_CODE, Activity.RESULT_CANCELED) ?: Activity.RESULT_CANCELED
        @Suppress("DEPRECATION")
        val data: Intent? = intent?.getParcelableExtra(EXTRA_DATA)
        if (projection != null) return START_NOT_STICKY
        if (code != Activity.RESULT_OK || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val mp = service<MediaProjectionManager>().getMediaProjection(code, data) ?: run {
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
        val m = resources.displayMetrics
        val scale = min(1f, 1280f / m.widthPixels)
        val w = (m.widthPixels * scale).roundToInt()
        val h = (m.heightPixels * scale).roundToInt()
        val r = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
        reader = r
        display = mp.createVirtualDisplay("woori-live", w, h, m.densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, handler)
        running = true
        handler.post(tick)
        return START_NOT_STICKY
    }

    private fun captureOnce() {
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
            val bmp = Bitmap.createBitmap(padded, 0, 0, image.width, image.height)
            val (b64, w, h) = bmp.toJpegBase64(maxWidth)
            if (bmp !== padded) bmp.recycle()
            padded.recycle()
            sink?.invoke(b64, w, h)
        } catch (e: Exception) {
            Log.w("ScreenCapture", "capture failed", e)
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
        stopped?.invoke()
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_CODE = "code"
        private const val EXTRA_DATA = "data"

        @Volatile
        var running = false
            private set

        @Volatile
        var intervalMs = 250L

        @Volatile
        var maxWidth = 960

        /** 프레임 받는 곳 (base64, 너비, 높이) — 백그라운드 스레드에서 불려요 */
        @Volatile
        var sink: ((String, Int, Int) -> Unit)? = null

        @Volatile
        var stopped: (() -> Unit)? = null

        fun start(context: Context, code: Int, data: Intent) {
            context.startForegroundService(
                Intent(context, ScreenCaptureService::class.java).putExtra(EXTRA_CODE, code).putExtra(EXTRA_DATA, data),
            )
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ScreenCaptureService::class.java))
        }
    }
}
