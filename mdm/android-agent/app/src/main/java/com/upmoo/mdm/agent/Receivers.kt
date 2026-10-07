package com.upmoo.mdm.agent

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class MdmDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        DeviceController(context).prepare()
    }
}

/**
 * 수업 중에는 앱이 뒤로 가도 연결이 끊기지 않도록 프로세스를 살려 두는 포그라운드 서비스.
 * 실제 연결(WebSocket)은 학생 화면(WebView)이 맺어요.
 */
class LessonService : Service() {
    override fun onCreate() {
        super.onCreate()
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val n = Notification.Builder(this, AgentApp.CHANNEL_LESSON)
            .setSmallIcon(android.R.drawable.ic_menu_edit)
            .setContentTitle("우리반 수업")
            .setContentText("수업에 들어와 있어요")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(1, n)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        fun start(context: Context) = context.startForegroundService(Intent(context, LessonService::class.java))

        fun stop(context: Context) = context.stopService(Intent(context, LessonService::class.java))
    }
}
