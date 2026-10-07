package com.upmoo.mdm.agent

import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

/** 서버 policy.js의 정책 모델과 동일한 구조 */
data class Policy(
    val appMode: String = "off",
    val allowedApps: Set<String> = emptySet(),
    val blockedApps: Set<String> = emptySet(),
    val webMode: String = "off",
    val allowedDomains: List<String> = emptyList(),
    val blockedDomains: List<String> = emptyList(),
    val blockedKeywords: List<String> = emptyList(),
    val restrictions: Map<String, Boolean> = emptyMap(),
    val volumeLocked: Boolean = false,
    val volumeLevel: Int = 50,
    val brightnessLocked: Boolean = false,
    val brightnessLevel: Int = 60,
    val kioskEnabled: Boolean = false,
    val kioskPackage: String = "",
) {
    fun restricted(key: String): Boolean = restrictions[key] == true

    /**
     * @param alwaysAllowed 런처·시스템UI·키보드·전화 등 항상 허용되는 패키지
     */
    fun isAppAllowed(pkg: String, alwaysAllowed: Set<String>): Boolean {
        if (pkg in alwaysAllowed) return true
        if (restricted("settings") && pkg in SETTINGS_PACKAGES) return false
        if (kioskEnabled && kioskPackage.isNotEmpty() && pkg == kioskPackage) return true
        return when (appMode) {
            "whitelist" -> pkg !in blockedApps && pkg in allowedApps
            "blacklist" -> pkg !in blockedApps
            else -> true
        }
    }

    fun isUrlAllowed(url: String): Boolean {
        if (webMode == "off") return true
        val lower = url.trim().lowercase()
        if (blockedKeywords.any { lower.contains(it) }) return false

        val withScheme = if (SCHEME_RE.containsMatchIn(lower)) lower else "https://$lower"
        val host = Uri.parse(withScheme).host?.removePrefix("www.")
        if (host.isNullOrEmpty()) return webMode != "whitelist"

        fun matches(domain: String) = host == domain || host.endsWith(".$domain")
        return if (webMode == "whitelist") allowedDomains.any(::matches) else blockedDomains.none(::matches)
    }

    companion object {
        private val SCHEME_RE = Regex("^[a-z][a-z0-9+.-]*:")

        val SETTINGS_PACKAGES = setOf("com.android.settings", "com.samsung.android.settings")

        fun parse(json: String): Policy = try {
            parse(JSONObject(json))
        } catch (e: Exception) {
            Policy()
        }

        fun parse(o: JSONObject): Policy {
            val r = o.optJSONObject("restrictions")
            val restrictions = mutableMapOf<String, Boolean>()
            r?.keys()?.forEach { k -> restrictions[k] = r.optBoolean(k, false) }
            val vol = o.optJSONObject("volume")
            val bri = o.optJSONObject("brightness")
            val kiosk = o.optJSONObject("kiosk")
            return Policy(
                appMode = o.optString("appMode", "off"),
                allowedApps = o.optJSONArray("allowedApps").strings().toSet(),
                blockedApps = o.optJSONArray("blockedApps").strings().toSet(),
                webMode = o.optString("webMode", "off"),
                allowedDomains = o.optJSONArray("allowedDomains").strings(),
                blockedDomains = o.optJSONArray("blockedDomains").strings(),
                blockedKeywords = o.optJSONArray("blockedKeywords").strings(),
                restrictions = restrictions,
                volumeLocked = vol?.optBoolean("locked", false) ?: false,
                volumeLevel = vol?.optInt("level", 50) ?: 50,
                brightnessLocked = bri?.optBoolean("locked", false) ?: false,
                brightnessLevel = bri?.optInt("level", 60) ?: 60,
                kioskEnabled = kiosk?.optBoolean("enabled", false) ?: false,
                kioskPackage = kiosk?.optString("packageName", "") ?: "",
            )
        }

        private fun JSONArray?.strings(): List<String> {
            if (this == null) return emptyList()
            return (0 until length()).mapNotNull { i -> optString(i, "").takeIf { it.isNotEmpty() } }
        }
    }
}
