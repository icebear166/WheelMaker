# Android Release Signing Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Android publishing prefer the release-directory certificate and create/configure a new PKCS12 signing certificate only when no usable certificate exists.

**Architecture:** `publish_android.ps1` will resolve signing material before invoking Gradle. It uses `<OutputDir>/wheelmaker-android-release.p12` whenever it exists, and otherwise creates a 4096-bit RSA PKCS12 keystore there. Passwords stay in current-user environment variables and never enter the repository or release assets.

**Tech Stack:** PowerShell, Java `keytool`, Gradle Android signing, existing PowerShell script checks.

---

### Task 1: Add a failing publishing-flow regression check

**Files:**
- Modify: `scripts/test_publish_android_ps1.ps1`
- Test: `scripts/test_publish_android_ps1.ps1`

- [ ] **Step 1: Add a test for first-run signing bootstrap**

  Add a temporary empty output directory and run:

  ```powershell
  $whatIfOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath -WhatIf -OutputDir $tempOutput 2>&1
  Assert-Contains -Label "publish_android.ps1 -WhatIf" -Text $joined -Needle "[whatif] create Android release keystore"
  Assert-Contains -Label "publish_android.ps1 -WhatIf" -Text $joined -Needle "wheelmaker-android-release.p12"
  ```

  Replace the obsolete assertion that the signing-password variable names cannot occur in the script with assertions that prohibit literal `STORE_PASSWORD=` and `KEY_PASSWORD=` assignments.

- [ ] **Step 2: Verify the regression test fails**

  Run:

  ```powershell
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\test_publish_android_ps1.ps1
  ```

  Expected: fail because `publish_android.ps1` does not yet emit the first-run keystore creation plan.

### Task 2: Bootstrap and prefer the release-directory certificate

**Files:**
- Modify: `scripts/publish_android.ps1`
- Test: `scripts/test_publish_android_ps1.ps1`

- [ ] **Step 1: Add signing configuration helpers**

  Add helpers that:

  ```powershell
  $script:ReleaseKeystorePath = Join-Path $script:OutputDir 'wheelmaker-android-release.p12'
  ```

  - load missing process settings from the current-user environment;
  - prefer the existing `ReleaseKeystorePath` and configure it as `WHEELMAKER_ANDROID_KEYSTORE`;
  - create a random-password, RSA-4096, PKCS12 keystore with alias `wheelmaker` only when the release-directory certificate is absent;
  - persist the generated settings for the current Windows user without printing passwords.

- [ ] **Step 2: Invoke signing bootstrap before Gradle**

  Call the resolver after `$script:OutputDir` is calculated and before `Build-AndroidApk`, so Gradle always receives a configured release keystore.

- [ ] **Step 3: Verify the regression test passes**

  Run:

  ```powershell
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\test_publish_android_ps1.ps1
  ```

  Expected: exit 0 and print `publish_android.ps1 checks passed`.

### Task 3: Verify release behavior and publish the source change

**Files:**
- Modify: `scripts/publish_android.ps1`
- Modify: `scripts/test_publish_android_ps1.ps1`

- [ ] **Step 1: Run all Android publishing checks**

  ```powershell
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\test_android_project_ps1.ps1
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\test_publish_android_ps1.ps1
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\test_publish_android_github_release_ps1.ps1
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\test_android_release_signing.ps1
  ```

- [ ] **Step 2: Run a WhatIf release bootstrap verification**

  ```powershell
  pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\publish_android.ps1 -WhatIf -OutputDir $env:TEMP\wheelmaker-android-signing-whatif
  ```

  Expected: output identifies the release-directory keystore action and does not expose a password.

- [ ] **Step 3: Commit and push**

  ```powershell
  git add -A
  git commit -m "feat: bootstrap Android release signing"
  git push origin main
  ```
