package com.upmoo.mdm.agent

import android.app.admin.DeviceAdminReceiver
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class MdmDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        DeviceController(context).apply(AgentConfig(context).policy)
    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence =
        "기기 관리자를 해제하면 수업 관리 기능이 동작하지 않으며, 선생님에게 표시됩니다."
}

/** 재부팅/업데이트 후 수업 연결과 마지막 정책을 자동 복원합니다. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val config = AgentConfig(context)
        if (!config.joined) return
        DeviceController(context).apply(config.policy)
        AgentService.start(context)
    }
}
