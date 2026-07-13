# WheelMaker security staging checklist

This checklist records the device and reverse-proxy evidence that cannot be established by repository-only automation. Use non-production credentials. Never paste a Token, Cookie, Authorization header, API key, signing secret, reusable access URL, or raw scanner report into this file.

## Run metadata

| Field | Value |
| --- | --- |
| Date/time (UTC) | NOT RUN |
| Commit SHA | NOT RUN |
| Registry OS/version | NOT RUN |
| Nginx version | NOT RUN |
| Browser/version | NOT RUN |
| Desktop version | NOT RUN |
| Android device/API/WebView | NOT RUN |
| Operator | NOT RUN |

Allowed Status values are `PASS`, `FAIL`, `BLOCKED`, and `NOT RUN`. Evidence must be non-sensitive: use status codes, timestamps, version numbers, redacted screenshots, certificate issuer names, or local log event names.

## Repository automation evidence

The repository-only acceptance gate passed on 2026-07-13 after rebasing commit `ea50103f` onto `origin/main`. Evidence: Gitleaks current tree zero findings; baseline and full Go tests passed; 177 Jest suites / 862 tests passed; Web typecheck and release build passed; production and complete npm audits passed; Android `test lint` completed 69 tasks successfully; publish/deployment source tests and forbidden production-source checks passed.

This evidence does not replace the staging and real-device rows below. Those rows remain `NOT RUN` or `BLOCKED` until an operator with the required Nginx environment, Desktop/Android devices, signing material, and credential-owner access records separate evidence.

## Reverse proxy, login, and sessions

| ID | Scenario | Expected result | Status (PASS/FAIL) | Evidence |
| --- | --- | --- | --- | --- |
| RP-01 | Root path `/`: Web, login, and WSS | Page loads; login succeeds; `/ws` upgrades without query/subprotocol credentials | NOT RUN | — |
| RP-02 | Subpath `/wheelmaker/`: Web, login, and WSS | Base Path is preserved; `/wheelmaker/ws` upgrades; root Cookie is not accepted | NOT RUN | — |
| RP-03 | First browser login | Token is submitted once over HTTPS; later status and WSS use the browser Session Cookie | NOT RUN | — |
| RP-04 | Registry restart | Existing authenticated browser reconnects without entering Token again | NOT RUN | — |
| RP-05 | 180-day clock test | Activity slides expiry; inactivity at expiry invalidates the Session | NOT RUN | — |
| RP-06 | Single device revocation | Selected device status/WSS fail; other device stays authenticated | NOT RUN | — |
| RP-07 | Revoke all / Token rotation | Every prior browser Session fails; old Hub Token fails; new Token reconnects trusted Hubs | NOT RUN | — |

## Desktop and Android remote shells

| ID | Scenario | Expected result | Status (PASS/FAIL) | Evidence |
| --- | --- | --- | --- | --- |
| NA-01 | Desktop first launch Bootstrap | Dedicated bootstrap page accepts the user's HTTPS Base URL and loads remote Web | NOT RUN | — |
| NA-02 | Android first launch Bootstrap | Dedicated bootstrap page accepts the user's HTTPS Base URL and loads remote Web | NOT RUN | — |
| NA-03 | System certificate error | Desktop and Android reject an untrusted chain without an ignore option | NOT RUN | — |
| NA-04 | Offline retry/change server | Failure remains on bootstrap/recovery UI; retry works after network recovery | NOT RUN | — |
| NA-05 | Server switch | Old Origin/Base Path state is cleared before the new server loads | NOT RUN | — |
| NA-06 | Bridge Origin/Base Path/iframe rejection | Wrong Origin, stale Base Path, and iframe requests receive no native capability | NOT RUN | — |
| NA-07 | Bridge gesture and capability expiry | No-gesture, wrong-action, and expired capability requests are rejected | NOT RUN | — |

## Android update verification

| ID | Scenario | Expected result | Status (PASS/FAIL) | Evidence |
| --- | --- | --- | --- | --- |
| APK-01 | APK size/hash/package/version/signature rejection matrix | Every incorrect size, hash, package, version, or signer is rejected and the temporary file is removed | NOT RUN | — |
| APK-02 | Valid signed upgrade | HTTPS download with exact metadata and approved signer reaches the system installer | NOT RUN | — |

## Relay

| ID | Scenario | Expected result | Status (PASS/FAIL) | Evidence |
| --- | --- | --- | --- | --- |
| RL-01 | Correct Relay code | Temporary target opens and authentication Cookie is scoped to the active generation | NOT RUN | — |
| RL-02 | Wrong code source limit | Sixth attempt from one source is rate-limited after the five-attempt burst | NOT RUN | — |
| RL-03 | Wrong code global limit | Attempts exceeding the 20-attempt global burst are rate-limited | NOT RUN | — |
| RL-04 | Relay generation/code change | Old code and old authenticated state stop working immediately | NOT RUN | — |

## HTTP headers and listeners

| ID | Scenario | Expected result | Status (PASS/FAIL) | Evidence |
| --- | --- | --- | --- | --- |
| HD-01 | Root and subpath HTTP responses | CSP, Referrer-Policy, nosniff, and frame denial headers are present on HTML and static assets | NOT RUN | — |
| HD-02 | Registry listener inspection | Registry listens only on `127.0.0.1`/loopback; Nginx owns the external port | NOT RUN | — |
| HD-03 | wildcard/LAN listener configuration | Registry and Relay startup reject wildcard/LAN binding or non-loopback targets | NOT RUN | — |
| HD-04 | Forwarded header spoofing | A non-loopback direct peer cannot make itself HTTPS or change its rate-limit source using forwarded headers | NOT RUN | — |

## Credential response prerequisite

| ID | Scenario | Expected result | Status (PASS/FAIL) | Evidence |
| --- | --- | --- | --- | --- |
| CR-01 | Historical Registry credential owner review | Every suspected historical value is identified, rotated/revoked, and verified without recording the value | BLOCKED | Owner access is still required; see `security-credential-response.md` |

## Sign-off

| Role | Name | Date | Decision | Evidence reference |
| --- | --- | --- | --- | --- |
| Registry owner | NOT RUN | NOT RUN | NOT RUN | — |
| Device tester | NOT RUN | NOT RUN | NOT RUN | — |
| Security reviewer | NOT RUN | NOT RUN | NOT RUN | — |
