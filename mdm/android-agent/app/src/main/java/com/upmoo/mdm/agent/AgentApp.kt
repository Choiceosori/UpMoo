package com.upmoo.mdm.agent

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

class AgentApp : Application() {
    override fun onCreate() {
        super.onCreate()
        val nm = service<NotificationManager>()
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_SERVICE, "수업 연결 상태", NotificationManager.IMPORTANCE_LOW),
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_MESSAGE, "선생님 알림", NotificationManager.IMPORTANCE_HIGH),
        )
    }

    companion object {
        const val CHANNEL_SERVICE = "agent_service"
        const val CHANNEL_MESSAGE = "teacher_message"
    }
}

/** 시스템 서비스 조회 (플랫폼 서비스는 항상 존재하므로 non-null로 다룹니다) */
inline fun <reified T : Any> Context.service(): T =
    getSystemService(T::class.java) ?: error("System service ${T::class.java.simpleName} unavailable")
