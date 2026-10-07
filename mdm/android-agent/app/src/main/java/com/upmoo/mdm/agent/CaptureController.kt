package com.upmoo.mdm.agent

import android.app.Activity
import android.graphics.Bitmap
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.view.PixelCopy

/**
 * 선생님 지시(capture)에 따라 화면 그림을 보내요.
 *  - snap: 앱 화면을 4초마다 작게 (PixelCopy, 허락 창 없음 — 앱 안 화면만 찍혀요)
 *  - live: "녹화 또는 전송을 시작할까요?"를 허락하면 MediaProjection으로 태블릿 화면 전체를,
 *          취소하면 앱 화면(PixelCopy)으로 이어서 보내요.
 */
class CaptureController(
    private val activity: Activity,
    private val onFrame: (data: String, w: Int, h: Int) -> Unit,
    private val onState: (String) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val worker = HandlerThread("pixelcopy").also { it.start() }
    private val workerHandler = Handler(worker.looper)
    private var mode = "off"
    private var intervalMs = 4000L
    private var maxWidth = 360
    private var projectionAsked = false
    private var projectionDenied = false

    private val loop = object : Runnable {
        override fun run() {
            if (mode == "off") return
            if (!(mode == "live" && ScreenCaptureService.running)) copyWindow()
            main.postDelayed(this, intervalMs.coerceAtLeast(100))
        }
    }

    init {
        ScreenCaptureService.sink = { data, w, h -> if (mode == "live") onFrame(data, w, h) }
        ScreenCaptureService.stopped = { main.post { if (mode == "live") onState("stopped") } }
    }

    fun set(newMode: String, interval: Long, width: Int) {
        val prev = mode
        mode = if (newMode in setOf("snap", "live")) newMode else "off"
        intervalMs = interval.coerceAtLeast(100)
        maxWidth = width.coerceIn(120, 1600)
        ScreenCaptureService.intervalMs = intervalMs
        ScreenCaptureService.maxWidth = maxWidth
        main.removeCallbacks(loop)
        if (mode == "off") {
            if (ScreenCaptureService.running) ScreenCaptureService.stop(activity)
            projectionAsked = false
            projectionDenied = false
            return
        }
        if (mode == "live" && prev != "live" && !ScreenCaptureService.running && !projectionAsked) {
            projectionAsked = true
            onState("asking")
            @Suppress("DEPRECATION")
            activity.startActivityForResult(activity.service<MediaProjectionManager>().createScreenCaptureIntent(), REQUEST)
        }
        if (mode == "snap" && ScreenCaptureService.running) ScreenCaptureService.stop(activity)
        main.post(loop)
    }

    /** MainActivity.onActivityResult에서 넘겨받아요 */
    fun onProjectionResult(resultCode: Int, data: android.content.Intent?) {
        if (resultCode == Activity.RESULT_OK && data != null) {
            ScreenCaptureService.start(activity, resultCode, data)
            onState("sharing")
        } else {
            projectionDenied = true
            onState("denied")
        }
    }

    private fun copyWindow() {
        val view = activity.window.decorView
        if (view.width == 0 || view.height == 0) return
        val bmp = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        try {
            PixelCopy.request(activity.window, bmp, { result ->
                if (result == PixelCopy.SUCCESS) {
                    val (data, w, h) = bmp.toJpegBase64(maxWidth, if (mode == "snap") 50 else 60)
                    onFrame(data, w, h)
                }
                bmp.recycle()
            }, workerHandler)
        } catch (e: IllegalArgumentException) {
            bmp.recycle()
        }
    }

    fun release() {
        set("off", 0, 0)
        ScreenCaptureService.sink = null
        ScreenCaptureService.stopped = null
        worker.quitSafely()
    }

    companion object {
        const val REQUEST = 4101
    }
}
