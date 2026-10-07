package com.upmoo.mdm.agent

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.UserManager
import android.util.Log

/**
 * 학교 기기 관리(선택).
 * 기기를 Device Owner로 설정하면(adb shell dpm set-device-owner com.upmoo.mdm.agent/.MdmDeviceAdminReceiver)
 * - 앱 고정(Lock Task)이 확인 창 없이 되고 홈·최근 앱·알림창·전원 메뉴가 막혀요.
 * - 학생이 앱을 지우거나 안전모드로 부팅해 우회할 수 없어요.
 * Device Owner가 아니면 안드로이드 '앱 고정' 확인 창으로 동작해요.
 */
class DeviceController(private val context: Context) {
    private val dpm = context.service<DevicePolicyManager>()
    private val admin = ComponentName(context, MdmDeviceAdminReceiver::class.java)

    fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(context.packageName)

    fun isPinned(): Boolean =
        context.service<ActivityManager>().lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE

    fun prepare() {
        if (!isDeviceOwner()) return
        safely("lockTaskPackages") {
            // 구글 로그인 탭(크롬 탭)은 고정 중에도 열 수 있게 함께 허용해요.
            dpm.setLockTaskPackages(admin, arrayOf(context.packageName, CHROME))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            safely("lockTaskFeatures") { dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE) }
        }
        safely("uninstall") { dpm.setUninstallBlocked(admin, context.packageName, true) }
        safely("safeBoot") { dpm.addUserRestriction(admin, UserManager.DISALLOW_SAFE_BOOT) }
    }

    private inline fun safely(what: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            Log.w("DeviceController", "적용 실패: $what", e)
        }
    }

    companion object {
        const val CHROME = "com.android.chrome"
    }
}
