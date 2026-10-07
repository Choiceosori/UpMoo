package com.upmoo.mdm.agent

import android.app.ActivityManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.os.UserManager
import android.provider.Settings
import android.util.Log

/**
 * DevicePolicyManager 기반 기기 통제.
 *
 * - 기기 관리자(Device Admin): 카메라 비활성화 정도만 가능 (Android 10+에서는 이마저 제한)
 * - Device Owner: 사용자 제한(블루투스/테더링/설치/삭제/안전모드…), 앱 숨기기, 상태바 비활성화,
 *   키오스크(Lock Task) 허용 목록, 밝기 고정, 에이전트 삭제 방지까지 모두 적용
 *
 * Device Owner 설정: adb shell dpm set-device-owner com.upmoo.mdm.agent/.MdmDeviceAdminReceiver
 */
class DeviceController(private val context: Context) {
    private val dpm = context.service<DevicePolicyManager>()
    private val config = AgentConfig(context)
    val admin = ComponentName(context, MdmDeviceAdminReceiver::class.java)

    fun isAdminActive(): Boolean = dpm.isAdminActive(admin)

    fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(context.packageName)

    fun isInLockTask(): Boolean =
        context.service<ActivityManager>().lockTaskModeState != ActivityManager.LOCK_TASK_MODE_NONE

    fun apply(policy: Policy) {
        if (isAdminActive()) {
            safely("camera") { dpm.setCameraDisabled(admin, policy.restricted("camera")) }
        }
        applyVolume(policy)
        if (!isDeviceOwner()) return

        for ((key, restrictions) in RESTRICTIONS) {
            for (r in restrictions) {
                safely(r) {
                    if (policy.restricted(key)) dpm.addUserRestriction(admin, r) else dpm.clearUserRestriction(admin, r)
                }
            }
        }

        // 보안: 에이전트 앱 자체 삭제 방지 (학생 우회 차단)
        safely("uninstallBlocked") { dpm.setUninstallBlocked(admin, context.packageName, true) }
        safely("statusBar") { dpm.setStatusBarDisabled(admin, policy.restricted("statusBar") || policy.kioskEnabled) }

        applyHiddenApps(policy)
        applyLockTask(policy)
        applyBrightness(policy)
    }

    /** 블랙리스트 앱은 앱 서랍에서 아예 숨깁니다 (정책 해제 시 자동 복원). */
    private fun applyHiddenApps(policy: Policy) {
        val target = if (policy.appMode == "off") emptySet() else policy.blockedApps - context.packageName
        val previous = config.hiddenApps
        for (pkg in previous - target) safely("unhide $pkg") { dpm.setApplicationHidden(admin, pkg, false) }
        val hidden = mutableSetOf<String>()
        for (pkg in target) {
            safely("hide $pkg") { if (dpm.setApplicationHidden(admin, pkg, true)) hidden += pkg }
        }
        config.hiddenApps = hidden
    }

    /** 키오스크 모드에서 실행이 허용되는 패키지 목록 + 홈/최근앱/알림/전원 메뉴 차단 */
    private fun applyLockTask(policy: Policy) {
        val packages = linkedSetOf(context.packageName)
        if (policy.kioskEnabled) {
            if (policy.kioskPackage.isNotEmpty()) packages += policy.kioskPackage
            else packages += policy.allowedApps
        }
        safely("lockTaskPackages") { dpm.setLockTaskPackages(admin, packages.toTypedArray()) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            safely("lockTaskFeatures") { dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE) }
        }
    }

    private fun applyBrightness(policy: Policy) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return
        if (policy.brightnessLocked) {
            safely("brightness") {
                dpm.setSystemSetting(
                    admin,
                    Settings.System.SCREEN_BRIGHTNESS_MODE,
                    Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL.toString(),
                )
                dpm.setSystemSetting(admin, Settings.System.SCREEN_BRIGHTNESS, (policy.brightnessLevel * 255 / 100).toString())
                dpm.addUserRestriction(admin, UserManager.DISALLOW_CONFIG_BRIGHTNESS)
            }
        } else {
            safely("brightness") { dpm.clearUserRestriction(admin, UserManager.DISALLOW_CONFIG_BRIGHTNESS) }
        }
    }

    /** 볼륨 고정: 미디어 볼륨을 지정 값으로 맞춥니다 (변경 감지 시 AgentService가 재적용). */
    fun applyVolume(policy: Policy) {
        if (!policy.volumeLocked) {
            if (isDeviceOwner()) safely("unmute") { dpm.setMasterVolumeMuted(admin, false) }
            return
        }
        val audio = context.service<AudioManager>()
        val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val target = (policy.volumeLevel * max + 50) / 100
        if (audio.getStreamVolume(AudioManager.STREAM_MUSIC) != target) {
            safely("volume") { audio.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0) }
        }
        if (isDeviceOwner()) safely("mute") { dpm.setMasterVolumeMuted(admin, policy.volumeLevel == 0) }
    }

    /** 수업 나가기 시 모든 제한을 해제합니다. */
    fun releaseAll() {
        apply(Policy())
        if (isDeviceOwner()) {
            safely("uninstallBlocked") { dpm.setUninstallBlocked(admin, context.packageName, false) }
        }
    }

    /** 기기 관리자 활성화 화면 */
    fun adminRequestIntent(): Intent =
        Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
            .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin)
            .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, "수업 중 카메라 제한 등 기기 통제 정책을 적용하기 위해 필요합니다.")

    private inline fun safely(what: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            Log.w(TAG, "정책 적용 실패: $what", e)
        }
    }

    companion object {
        private const val TAG = "DeviceController"

        private val RESTRICTIONS: Map<String, List<String>> = mapOf(
            "bluetooth" to listOf(UserManager.DISALLOW_BLUETOOTH, UserManager.DISALLOW_CONFIG_BLUETOOTH),
            "tethering" to listOf(UserManager.DISALLOW_CONFIG_TETHERING),
            "installApps" to listOf(UserManager.DISALLOW_INSTALL_APPS, UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES),
            "uninstallApps" to listOf(UserManager.DISALLOW_UNINSTALL_APPS),
            "safeBoot" to listOf(UserManager.DISALLOW_SAFE_BOOT),
            "factoryReset" to listOf(UserManager.DISALLOW_FACTORY_RESET),
            "usbFileTransfer" to listOf(UserManager.DISALLOW_USB_FILE_TRANSFER),
            // "settings"(설정 앱 차단)와 "camera"는 별도 처리: 접근성 서비스 / setCameraDisabled
        )
    }
}
