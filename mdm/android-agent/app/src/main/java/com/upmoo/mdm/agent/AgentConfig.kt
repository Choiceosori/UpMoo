package com.upmoo.mdm.agent

import android.content.Context
import java.util.UUID

/**
 * 에이전트 설정/상태 저장소.
 * 서버에서 받은 정책과 잠금 상태를 저장해, 네트워크가 끊겨도 마지막 정책을 계속 적용합니다.
 */
class AgentConfig(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("agent", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString("serverUrl", "") ?: ""
        set(value) = prefs.edit().putString("serverUrl", value).apply()

    var pin: String
        get() = prefs.getString("pin", "") ?: ""
        set(value) = prefs.edit().putString("pin", value).apply()

    var name: String
        get() = prefs.getString("name", "") ?: ""
        set(value) = prefs.edit().putString("name", value).apply()

    var number: String
        get() = prefs.getString("number", "") ?: ""
        set(value) = prefs.edit().putString("number", value).apply()

    var token: String?
        get() = prefs.getString("token", null)
        set(value) = prefs.edit().putString("token", value).apply()

    var joined: Boolean
        get() = prefs.getBoolean("joined", false)
        set(value) = prefs.edit().putBoolean("joined", value).apply()

    var className: String
        get() = prefs.getString("className", "") ?: ""
        set(value) = prefs.edit().putString("className", value).apply()

    var locked: Boolean
        get() = prefs.getBoolean("locked", false)
        set(value) = prefs.edit().putBoolean("locked", value).apply()

    var lockText: String
        get() = prefs.getString("lockText", null) ?: "선생님을 보세요"
        set(value) = prefs.edit().putString("lockText", value).apply()

    var policyJson: String
        get() = prefs.getString("policy", "{}") ?: "{}"
        set(value) {
            prefs.edit().putString("policy", value).apply()
            cachedPolicy = null
        }

    /** DeviceController가 숨긴(setApplicationHidden) 앱 목록 — 정책 해제 시 복원용 */
    var hiddenApps: Set<String>
        get() = prefs.getStringSet("hiddenApps", emptySet()) ?: emptySet()
        set(value) = prefs.edit().putStringSet("hiddenApps", value).apply()

    val deviceId: String
        get() {
            prefs.getString("deviceId", null)?.let { return it }
            val id = UUID.randomUUID().toString()
            prefs.edit().putString("deviceId", id).apply()
            return id
        }

    val policy: Policy
        get() = cachedPolicy ?: Policy.parse(policyJson).also { cachedPolicy = it }

    fun leave() {
        prefs.edit()
            .putBoolean("joined", false)
            .remove("token")
            .putBoolean("locked", false)
            .putString("policy", "{}")
            .apply()
        cachedPolicy = null
    }

    companion object {
        @Volatile
        private var cachedPolicy: Policy? = null

        /** "192.168.0.10:8787" → "ws://192.168.0.10:8787/ws" */
        fun normalizeServerUrl(input: String): String {
            var url = input.trim()
            if (url.isEmpty()) return url
            url = when {
                url.startsWith("http://") -> "ws://" + url.removePrefix("http://")
                url.startsWith("https://") -> "wss://" + url.removePrefix("https://")
                url.startsWith("ws://") || url.startsWith("wss://") -> url
                else -> "ws://$url"
            }
            val afterScheme = url.substringAfter("://")
            if (!afterScheme.contains('/')) url = "$url/ws"
            return url
        }
    }
}
