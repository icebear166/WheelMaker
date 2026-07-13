package com.wheelmaker.android

import android.content.Context

class BaseUrlStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun load(): String = normalizeHttpsBaseUrl(preferences.getString(BASE_URL_KEY, "").orEmpty()).orEmpty()

    fun save(rawBaseUrl: String): String {
        val normalized = requireNotNull(normalizeHttpsBaseUrl(rawBaseUrl)) { "invalid HTTPS base URL" }
        check(preferences.edit().putString(BASE_URL_KEY, normalized).commit()) {
            "failed to persist base URL"
        }
        return normalized
    }

    fun clear() {
        check(preferences.edit().remove(BASE_URL_KEY).commit()) {
            "failed to clear base URL"
        }
    }

    private companion object {
        const val PREFERENCES_NAME = "wheelmaker_remote_shell"
        const val BASE_URL_KEY = "base_url"
    }
}
