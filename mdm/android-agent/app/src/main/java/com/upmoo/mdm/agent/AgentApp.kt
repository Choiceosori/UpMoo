package com.upmoo.mdm.agent

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

class AgentApp : Application() {
    override fun onCreate() {
        super.onCreate()
        service<NotificationManager>().createNotificationChannel(
            NotificationChannel(CHANNEL_LESSON, "수업 연결", NotificationManager.IMPORTANCE_LOW),
        )
        // 학교 기기를 관리자 모드(Device Owner)로 설정해 두었다면 앱 고정·삭제 방지를 준비해요.
        DeviceController(this).prepare()
    }

    companion object {
        const val CHANNEL_LESSON = "lesson"
    }
}

/** 시스템 서비스 조회 (플랫폼 서비스는 항상 있으므로 non-null로 다룹니다) */
inline fun <reified T : Any> Context.service(): T =
    getSystemService(T::class.java) ?: error("System service ${T::class.java.simpleName} unavailable")

/** 서버 주소 저장 */
class Prefs(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("woori", Context.MODE_PRIVATE)

    var server: String
        get() = prefs.getString("server", "") ?: ""
        set(value) = prefs.edit().putString("server", value).apply()

    companion object {
        /** "192.168.0.10:8787" → "http://192.168.0.10:8787" */
        fun normalize(input: String): String {
            var s = input.trim().trimEnd('/')
            if (s.isEmpty()) return s
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
            return s
        }
    }
}
