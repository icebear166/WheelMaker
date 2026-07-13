package com.wheelmaker.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BaseUrlPolicyTest {
    @Test
    fun normalizesHttpsDomainIpPortAndSubpath() {
        val cases = mapOf(
            "example.com" to "https://example.com/",
            "192.0.2.10" to "https://192.0.2.10/",
            "example.com:8443/wheelmaker" to "https://example.com:8443/wheelmaker/",
            "https://example.com" to "https://example.com/",
            "https://example.com/a%20b" to "https://example.com/a%20b/"
        )
        cases.forEach { (raw, want) -> assertEquals(want, normalizeHttpsBaseUrl(raw)) }
    }

    @Test
    fun rejectsNonHttpsCredentialsQueryFragmentAndScriptUrls() {
        listOf(
            "",
            "http://example.com/",
            "https://user@example.com/",
            "https://example.com/?token=secret",
            "https://example.com/#fragment",
            "javascript:alert(1)",
            "data:text/html,evil",
            "file:///tmp/index.html"
        ).forEach { raw -> assertNull(raw, normalizeHttpsBaseUrl(raw)) }
    }

    @Test
    fun allowsOnlyConfiguredOriginAndBasePathInsideWebView() {
        val policy = BaseUrlPolicy("https://example.com/wheelmaker/")
        assertEquals(NavigationDecision.ALLOW, policy.decide("https://example.com/wheelmaker/", true))
        assertEquals(NavigationDecision.ALLOW, policy.decide("https://example.com/wheelmaker/projects/1", true))
        assertEquals(NavigationDecision.EXTERNAL, policy.decide("https://example.com/admin/", true))
        assertEquals(NavigationDecision.EXTERNAL, policy.decide("https://docs.example.net/help", true))
        assertEquals(NavigationDecision.BLOCK, policy.decide("https://docs.example.net/help", false))
        assertEquals(NavigationDecision.BLOCK, policy.decide("http://example.com/wheelmaker/", true))
        assertEquals(NavigationDecision.BLOCK, policy.decide("https://example.com/wheelmaker-evil/", false))
    }

    @Test
    fun probeRedirectsStayHttpsAndStopAfterFiveHops() {
        assertEquals(true, isAllowedProbeRedirect("https://example.com/next", 5))
        assertEquals(false, isAllowedProbeRedirect("https://example.com/next", 6))
        assertEquals(false, isAllowedProbeRedirect("http://example.com/next", 1))
    }
}
