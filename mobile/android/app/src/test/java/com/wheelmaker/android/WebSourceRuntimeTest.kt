package com.wheelmaker.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebSourceRuntimeTest {
    @Test
    fun rejectsLoopbackRemoteCandidates() {
        val candidate = RemoteWebCandidate(
            source = "registry",
            registryAddress = "ws://127.0.0.1:9630/ws",
            remoteWebUrl = "http://127.0.0.1:9630/"
        )

        assertFalse(normalizeRemoteWebCandidate(candidate).accepted)
    }

    @Test
    fun acceptsRemoteCandidateWhenRegistryAndRemoteHostsMatch() {
        val candidate = RemoteWebCandidate(
            source = "registry",
            registryAddress = "wss://workspace.example.com/ws",
            remoteWebUrl = "https://workspace.example.com/"
        )

        val normalized = normalizeRemoteWebCandidate(candidate)

        assertTrue(normalized.accepted)
        assertEquals("https://workspace.example.com/", normalized.remoteWebUrl)
        assertEquals("wss://workspace.example.com", normalized.registryOrigin)
    }

    @Test
    fun rejectsRemoteCandidateWhenRegistryAndRemoteHostsDiffer() {
        val candidate = RemoteWebCandidate(
            source = "registry",
            registryAddress = "wss://workspace.example.com/ws",
            remoteWebUrl = "https://other.example.com/"
        )

        assertFalse(normalizeRemoteWebCandidate(candidate).accepted)
    }

    @Test
    fun stateFallsBackToEmbeddedWhenRemoteUrlIsEmpty() {
        val runtime = WebSourceRuntime(InMemoryWebSourceStore(WebSourceConfig()))

        val state = runtime.state()

        assertEquals("auto", state.preference)
        assertEquals("embedded", state.actualSource)
        assertEquals("", state.remoteUrl)
    }

    @Test
    fun pendingRemoteCandidateDoesNotSwitchLockedEmbeddedSource() {
        val runtime = WebSourceRuntime(InMemoryWebSourceStore(WebSourceConfig(
            webSourcePreference = WEB_SOURCE_AUTO,
            remoteWebUrl = "https://old.example.com/"
        )))

        runtime.lockActualSource(WEB_ACTUAL_EMBEDDED)
        val state = runtime.setRemoteCandidate(RemoteWebCandidate(
            source = "registry",
            registryAddress = "wss://workspace.example.com/ws",
            remoteWebUrl = "https://workspace.example.com/"
        ))

        assertEquals("embedded", state.actualSource)
        assertEquals("https://workspace.example.com/", state.remoteUrl)
        assertEquals("", runtime.remoteBaseForRequest())
    }

    @Test
    fun pendingRemoteCandidateDoesNotChangeLockedRemoteBase() {
        val runtime = WebSourceRuntime(InMemoryWebSourceStore(WebSourceConfig(
            webSourcePreference = WEB_SOURCE_AUTO,
            remoteWebUrl = "https://old.example.com/"
        )))

        runtime.lockActualSource(WEB_ACTUAL_REMOTE)
        val state = runtime.setRemoteCandidate(RemoteWebCandidate(
            source = "registry",
            registryAddress = "wss://new.example.com/ws",
            remoteWebUrl = "https://new.example.com/"
        ))

        assertEquals("remote", state.actualSource)
        assertEquals("https://old.example.com/", runtime.remoteBaseForRequest())
        assertEquals("https://new.example.com/", state.remoteUrl)
    }

    @Test
    fun pendingPreferenceDoesNotChangeLockedRemoteBase() {
        val runtime = WebSourceRuntime(InMemoryWebSourceStore(WebSourceConfig(
            webSourcePreference = WEB_SOURCE_AUTO,
            remoteWebUrl = "https://workspace.example.com/"
        )))

        runtime.lockActualSource(WEB_ACTUAL_REMOTE)
        val state = runtime.setPreference(WEB_SOURCE_EMBEDDED)

        assertEquals("remote", state.actualSource)
        assertEquals("https://workspace.example.com/", runtime.remoteBaseForRequest())
    }

    @Test
    fun remoteSourceSelectionIsAvailableBeforeSourceIsLocked() {
        val runtime = WebSourceRuntime(InMemoryWebSourceStore(WebSourceConfig(
            webSourcePreference = WEB_SOURCE_AUTO,
            remoteWebUrl = "https://workspace.example.com/"
        )))

        assertFalse(runtime.isSourceLocked())
        assertEquals("embedded", runtime.state().actualSource)
        assertEquals("https://workspace.example.com/", runtime.remoteBaseForSourceSelection())
        assertEquals("", runtime.remoteBaseForRequest())
    }
}
