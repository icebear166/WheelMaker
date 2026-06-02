# Android Response Image Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share completed response PNG exports through the Android system sharesheet in the APK while preserving browser/Desktop PNG downloads.

**Architecture:** Keep the existing hidden Markdown PNG renderer and replace its final output step with a small platform-aware service. Add an Android native image share runtime exposed through `WheelMakerAndroidNative.shareResponseImage`, backed by a temporary cache file and `FileProvider`.

**Tech Stack:** React 19, TypeScript, Jest, Kotlin Android WebView, Android `Intent.ACTION_SEND`, AndroidX `FileProvider`, Gradle JVM tests.

---

## File Structure

- Create `app/web/src/responseImageOutput.ts`: platform detection, blob-to-data-URL conversion, Android bridge call, browser download dispatch.
- Modify `app/web/src/chatMarkdownImageExport.ts`: keep renderer helpers and export `downloadBlobAsFile` for browser output.
- Modify `app/web/src/main.tsx`: route `MarkdownImageExportSurface` completion through `outputResponseImage`, track active export id, expose busy state on response camera buttons.
- Create `app/__tests__/web-response-image-output.test.ts`: Web TDD coverage for browser, Android bridge, old APK, and bridge failure paths.
- Modify `app/__tests__/web-chat-ui.test.ts`: structure checks for busy/disabled state and unchanged composer photo action.
- Create `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidImageShareRuntime.kt`: decode PNG data URL, write cache file, launch sharesheet, return JSON result.
- Modify `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`: expose `shareResponseImage(rawJson: String)`.
- Modify `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`: own and pass `AndroidImageShareRuntime`.
- Modify `mobile/android/app/src/main/res/xml/apk_update_paths.xml`: add an `image-shares/` cache path.
- Create `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidImageShareRuntimeTest.kt`: source-level JVM tests for bridge wiring, FileProvider path, share intent usage, and no local-save fallback.

## Task 1: Web Response Image Output Service

**Files:**
- Create: `app/web/src/responseImageOutput.ts`
- Test: `app/__tests__/web-response-image-output.test.ts`

- [ ] **Step 1: Write failing Web output tests**

```ts
import {
  blobToDataUrl,
  outputResponseImage,
} from '../web/src/responseImageOutput';

describe('response image output', () => {
  afterEach(() => {
    delete (globalThis as {window?: unknown}).window;
  });

  test('downloads response image outside Android native host', async () => {
    const download = jest.fn();
    const blob = new Blob(['png'], {type: 'image/png'});

    await expect(outputResponseImage({
      blob,
      fileName: 'response.png',
      download,
      env: {} as Window,
    })).resolves.toEqual({ok: true, status: 'downloaded'});

    expect(download).toHaveBeenCalledWith(blob, 'response.png');
  });

  test('shares response image through Android bridge when available', async () => {
    const native = {
      shareResponseImage: jest.fn(() => JSON.stringify({ok: true, status: 'shared'})),
    };
    const blob = new Blob(['png'], {type: 'image/png'});

    await expect(outputResponseImage({
      blob,
      fileName: 'response.png',
      download: jest.fn(),
      env: {WheelMakerAndroidNative: native} as unknown as Window,
    })).resolves.toEqual({ok: true, status: 'shared'});

    const raw = native.shareResponseImage.mock.calls[0][0];
    expect(JSON.parse(raw)).toMatchObject({
      fileName: 'response.png',
      dataUrl: 'data:image/png;base64,cG5n',
    });
  });

  test('asks users to update old Android APKs without falling back to blob download', async () => {
    const download = jest.fn();

    await expect(outputResponseImage({
      blob: new Blob(['png'], {type: 'image/png'}),
      fileName: 'response.png',
      download,
      env: {WheelMakerAndroidNative: {}} as unknown as Window,
    })).resolves.toEqual({
      ok: false,
      status: 'unsupported',
      error: 'Update the Android app to share response images.',
    });

    expect(download).not.toHaveBeenCalled();
  });

  test('returns Android bridge failures to the caller', async () => {
    await expect(outputResponseImage({
      blob: new Blob(['png'], {type: 'image/png'}),
      fileName: 'response.png',
      download: jest.fn(),
      env: {
        WheelMakerAndroidNative: {
          shareResponseImage: () => JSON.stringify({ok: false, status: 'share_failed', error: 'no target'}),
        },
      } as unknown as Window,
    })).resolves.toEqual({ok: false, status: 'share_failed', error: 'no target'});
  });

  test('converts blobs to data URLs', async () => {
    await expect(blobToDataUrl(new Blob(['png'], {type: 'image/png'}))).resolves.toBe(
      'data:image/png;base64,cG5n',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify red**

Run: `npm test -- --runTestsByPath __tests__/web-response-image-output.test.ts --runInBand`

Expected: FAIL because `../web/src/responseImageOutput` does not exist.

- [ ] **Step 3: Implement `responseImageOutput.ts`**

```ts
import { downloadBlobAsFile } from './chatMarkdownImageExport';

export type ResponseImageOutputResult = {
  ok: boolean;
  status: string;
  error?: string;
};

type AndroidResponseImageBridge = {
  shareResponseImage?: (rawJson: string) => string;
};

type ResponseImageOutputEnv = Window & {
  WheelMakerAndroidNative?: AndroidResponseImageBridge;
};

type ResponseImageOutputOptions = {
  blob: Blob;
  fileName: string;
  env?: ResponseImageOutputEnv;
  download?: (blob: Blob, fileName: string) => void;
};

const ANDROID_UPDATE_REQUIRED_MESSAGE = 'Update the Android app to share response images.';

function parseBridgeResult(raw: string | undefined): ResponseImageOutputResult {
  try {
    const parsed = JSON.parse(raw || '{}') as Partial<ResponseImageOutputResult>;
    return {
      ok: parsed.ok === true,
      status: typeof parsed.status === 'string' && parsed.status ? parsed.status : 'share_failed',
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
    };
  } catch {
    return {ok: false, status: 'share_failed', error: 'invalid_bridge_response'};
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Image renderer returned an unreadable file.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read response image.'));
    reader.readAsDataURL(blob);
  });
}

export async function outputResponseImage({
  blob,
  fileName,
  env = window as ResponseImageOutputEnv,
  download = downloadBlobAsFile,
}: ResponseImageOutputOptions): Promise<ResponseImageOutputResult> {
  const native = env.WheelMakerAndroidNative;
  if (!native) {
    download(blob, fileName);
    return {ok: true, status: 'downloaded'};
  }
  if (typeof native.shareResponseImage !== 'function') {
    return {ok: false, status: 'unsupported', error: ANDROID_UPDATE_REQUIRED_MESSAGE};
  }
  const dataUrl = await blobToDataUrl(blob);
  return parseBridgeResult(native.shareResponseImage(JSON.stringify({fileName, dataUrl})));
}
```

- [ ] **Step 4: Run tests to verify green**

Run: `npm test -- --runTestsByPath __tests__/web-response-image-output.test.ts --runInBand`

Expected: PASS.

## Task 2: React Export Flow Busy State and Dispatch

**Files:**
- Modify: `app/web/src/main.tsx`
- Modify: `app/__tests__/web-chat-ui.test.ts`

- [ ] **Step 1: Write failing chat UI structure tests**

Add assertions to existing chat UI tests:

```ts
expect(mainTsx).toContain("import { outputResponseImage } from './responseImageOutput';");
expect(mainTsx).toContain('exportingMarkdownImageTurnIndex');
expect(mainTsx).toContain('disabled={copyDisabled || exportBusy}');
expect(mainTsx).toContain('aria-busy={exportBusy}');
expect(mainTsx).toContain('outputResponseImage({');
expect(mainTsx).toContain('setError(`Failed to share response image: ${result.error || result.status}`);');
expect(mainTsx).toContain('className="chat-attachment-action-button photo"');
expect(mainTsx).toContain('chatImageInputRef.current?.click();');
```

- [ ] **Step 2: Run tests to verify red**

Run: `npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts --runInBand`

Expected: FAIL because `outputResponseImage`, `exportingMarkdownImageTurnIndex`, and `exportBusy` are not wired yet.

- [ ] **Step 3: Wire React export flow**

Implement these edits:

```ts
import { outputResponseImage } from './responseImageOutput';
```

Extend `ChatTurnViewProps`:

```ts
  exportBusy?: boolean;
```

Disable/mark the completed-response camera button:

```tsx
disabled={copyDisabled || exportBusy}
aria-busy={exportBusy}
```

Track active turn index in `App`:

```ts
const [exportingMarkdownImageTurnIndex, setExportingMarkdownImageTurnIndex] = useState<number | null>(null);
```

Set it when export starts:

```ts
setExportingMarkdownImageTurnIndex(doneTurnIndex);
```

Make `MarkdownImageExportSurface` call `outputResponseImage` after render:

```ts
const result = await outputResponseImage({blob, fileName: request.fileName});
if (!result.ok) {
  throw new Error(result.error || result.status);
}
```

Clear active state in completion and failure callbacks:

```ts
setExportingMarkdownImageTurnIndex(null);
```

Pass busy state only for the matching prompt-done turn:

```tsx
exportBusy={message.method === 'prompt_done' && exportingMarkdownImageTurnIndex === doneTurnIndex}
```

- [ ] **Step 4: Run tests to verify green**

Run: `npm test -- --runTestsByPath __tests__/web-chat-ui.test.ts __tests__/web-response-image-output.test.ts --runInBand`

Expected: PASS.

## Task 3: Android Image Share Runtime and Bridge

**Files:**
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/AndroidImageShareRuntime.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Modify: `mobile/android/app/src/main/res/xml/apk_update_paths.xml`
- Test: `mobile/android/app/src/test/java/com/wheelmaker/android/AndroidImageShareRuntimeTest.kt`

- [ ] **Step 1: Write failing Android JVM tests**

```kotlin
package com.wheelmaker.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Paths

class AndroidImageShareRuntimeTest {
    private fun source(path: String): String =
        String(Files.readAllBytes(Paths.get(path)))

    @Test
    fun bridgeExposesResponseImageShareMethod() {
        val bridge = source("src/main/java/com/wheelmaker/android/WheelMakerBridge.kt")
        val mainActivity = source("src/main/java/com/wheelmaker/android/MainActivity.kt")

        assertTrue(bridge.contains("private val androidImageShareRuntime: AndroidImageShareRuntime"))
        assertTrue(bridge.contains("fun shareResponseImage(rawJson: String): String"))
        assertTrue(mainActivity.contains("private lateinit var androidImageShareRuntime: AndroidImageShareRuntime"))
        assertTrue(mainActivity.contains("AndroidImageShareRuntime(this)"))
    }

    @Test
    fun providerAllowsTemporaryResponseImageShares() {
        val providerPaths = source("src/main/res/xml/apk_update_paths.xml")

        assertTrue(providerPaths.contains("image_shares"))
        assertTrue(providerPaths.contains("image-shares/"))
    }

    @Test
    fun runtimeUsesSystemImageShareIntentWithoutLocalSaveFallback() {
        val runtime = source("src/main/java/com/wheelmaker/android/AndroidImageShareRuntime.kt")

        assertTrue(runtime.contains("Intent.ACTION_SEND"))
        assertTrue(runtime.contains("image/png"))
        assertTrue(runtime.contains("Intent.EXTRA_STREAM"))
        assertTrue(runtime.contains("Intent.FLAG_GRANT_READ_URI_PERMISSION"))
        assertTrue(runtime.contains("Intent.createChooser"))
        assertTrue(runtime.contains("FileProvider.getUriForFile"))
        assertFalse(runtime.contains("DownloadManager"))
        assertFalse(runtime.contains("MediaStore"))
        assertFalse(runtime.contains("DIRECTORY_DOWNLOADS"))
    }
}
```

- [ ] **Step 2: Run tests to verify red**

Run: `gradle testDebugUnitTest --tests com.wheelmaker.android.AndroidImageShareRuntimeTest`

Expected: FAIL because the test file references runtime/wiring that does not exist.

- [ ] **Step 3: Implement Android runtime and wiring**

Create `AndroidImageShareRuntime.kt`:

```kotlin
package com.wheelmaker.android

import android.content.ActivityNotFoundException
import android.content.Intent
import android.util.Base64
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

private const val RESPONSE_IMAGE_MIME_TYPE = "image/png"
private const val RESPONSE_IMAGE_DATA_URL_PREFIX = "data:image/png;base64,"

class AndroidImageShareRuntime(
    private val activity: MainActivity
) {
    fun shareResponseImage(rawJson: String): String {
        val input = try {
            JSONObject(rawJson)
        } catch (_: Exception) {
            return androidImageShareResultJson(false, "invalid_payload", "invalid_payload")
        }
        val fileName = sanitizeResponseImageFileName(input.optString("fileName"))
        val dataUrl = input.optString("dataUrl")
        if (dataUrl.isBlank()) {
            return androidImageShareResultJson(false, "invalid_payload", "missing_data_url")
        }
        if (!dataUrl.startsWith(RESPONSE_IMAGE_DATA_URL_PREFIX)) {
            return androidImageShareResultJson(false, "invalid_data_url", "invalid_data_url")
        }
        val bytes = try {
            Base64.decode(dataUrl.removePrefix(RESPONSE_IMAGE_DATA_URL_PREFIX), Base64.DEFAULT)
        } catch (_: Exception) {
            return androidImageShareResultJson(false, "decode_failed", "decode_failed")
        }
        val imageFile = try {
            writeResponseImage(fileName, bytes)
        } catch (error: Exception) {
            return androidImageShareResultJson(false, "write_failed", error.message ?: "write_failed")
        }
        return try {
            startShareChooser(imageFile)
            androidImageShareResultJson(true, "shared")
        } catch (_: ActivityNotFoundException) {
            androidImageShareResultJson(false, "no_share_target", "no_share_target")
        } catch (error: Exception) {
            androidImageShareResultJson(false, "share_failed", error.message ?: "share_failed")
        }
    }

    private fun writeResponseImage(fileName: String, bytes: ByteArray): File {
        val outputDir = File(activity.cacheDir, "image-shares")
        outputDir.mkdirs()
        val output = File(outputDir, fileName)
        output.writeBytes(bytes)
        return output
    }

    private fun startShareChooser(imageFile: File) {
        val imageUri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.apkprovider",
            imageFile
        )
        val sendIntent = Intent(Intent.ACTION_SEND).apply {
            type = RESPONSE_IMAGE_MIME_TYPE
            putExtra(Intent.EXTRA_STREAM, imageUri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(sendIntent, "Share response image")
        activity.runOnUiThread {
            activity.startActivity(chooser)
        }
    }
}

private fun sanitizeResponseImageFileName(value: String): String {
    val cleaned = value.replace(Regex("[^A-Za-z0-9._-]"), "_")
    return if (cleaned.endsWith(".png") && cleaned != ".png") cleaned else "wheelmaker-response.png"
}

private fun androidImageShareResultJson(ok: Boolean, status: String, error: String = ""): String {
    val output = JSONObject()
        .put("ok", ok)
        .put("status", status)
    if (error.isNotBlank()) {
        output.put("error", error)
    }
    return output.toString()
}
```

Wire `WheelMakerBridge`:

```kotlin
private val androidImageShareRuntime: AndroidImageShareRuntime,

@JavascriptInterface
fun shareResponseImage(rawJson: String): String = androidImageShareRuntime.shareResponseImage(rawJson)
```

Wire `MainActivity`:

```kotlin
private lateinit var androidImageShareRuntime: AndroidImageShareRuntime

androidImageShareRuntime = AndroidImageShareRuntime(this)
```

Add it to the `WheelMakerBridge(...)` constructor call.

Extend provider paths:

```xml
<cache-path
    name="image_shares"
    path="image-shares/" />
```

- [ ] **Step 4: Run tests to verify green**

Run: `gradle testDebugUnitTest --tests com.wheelmaker.android.AndroidImageShareRuntimeTest --tests com.wheelmaker.android.AndroidApkUpdateRuntimeTest`

Expected: PASS.

## Task 4: Typecheck, Build, and Regression Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused Web tests**

Run: `npm test -- --runTestsByPath __tests__/web-response-image-output.test.ts __tests__/web-chat-markdown-image-export.test.ts __tests__/web-chat-ui.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 2: Run Web typecheck**

Run: `npm run tsc:web`

Expected: PASS.

- [ ] **Step 3: Run focused Android tests**

Run: `gradle testDebugUnitTest --tests com.wheelmaker.android.AndroidImageShareRuntimeTest --tests com.wheelmaker.android.AndroidApkUpdateRuntimeTest --tests com.wheelmaker.android.MainActivityFileChooserTest`

Expected: PASS.

- [ ] **Step 4: Run Android compile check**

Run: `gradle assembleDebug`

Expected: PASS.

- [ ] **Step 5: Review diff**

Run: `git diff --check` and `git status --short`

Expected: no whitespace errors; only planned files changed.

- [ ] **Step 6: Final commit and push**

Run:

```powershell
git add -A
git commit -m "feat: share response images on android"
git push origin main
```

Expected: commit created and pushed.
