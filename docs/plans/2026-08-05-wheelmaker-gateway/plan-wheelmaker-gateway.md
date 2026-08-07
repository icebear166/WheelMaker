# WheelMaker Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Implement a separately deployable `wheelmaker-gateway` binary embedding Caddy, and integrate its optional release artifact, semantic site configuration, deployment, and legacy Nginx migration without changing the protocol version.

**Architecture:** One host-level Gateway owns Caddy and its service lifecycle. Web, Hub, and Release Server remain independent. Gateway state lives under `~/.wheelmaker/gateway` (or the explicitly configured absolute home), with `config.json` for operator-owned global settings, `sites/*.json` for deployer-owned semantic site settings, and generated Caddy JSON/runtime state kept separate. Normal `deploy.mjs update` never touches Gateway; full interactive deployment asks only whether to write the Workspace site config, while download/install/start is the default behavior. Release Server publishes Gateway artifacts into fixed `/gateway/` current/previous slots and deploys only its own app plus `gateway/sites/release-server.json`.

**Tech Stack:** Go 1.26, embedded Caddy modules, Node.js ESM release/deploy scripts, existing Release Server HTTP API, platform service adapters for Windows/Linux/macOS, Node test runner and Go tests.

## Task 1: Add the embedded Gateway contracts and binary

- [x] Read `server/CLAUDE.md`; inspect existing command/bootstrap conventions and Go module dependencies.
- [x] Add `server/internal/gateway/` with typed global/site schemas, path resolution, JSON validation, deterministic semantic-to-Caddy JSON compilation, and `serve`, `validate`, `paths`, and `version` command support.
- [x] Add `server/cmd/wheelmaker-gateway/main.go`; expose a stable CLI suitable for service managers and deployment scripts.
- [x] Keep semantic route behavior exact: Workspace static root plus SPA fallback and `/ws` to `127.0.0.1:9630`; Release Server static public root plus GET/HEAD/Range/CORS and `/api/*`/`/healthz` to `127.0.0.1:9680`.
- [x] Implement HTTPS policy: `https://` with no certificate pair enables Caddy ACME/HTTP-to-HTTPS; `http://` disables TLS; a custom certificate requires both cert and key; never create self-signed fallback or manage DNS/firewall.
- [x] Create Go unit tests for schema validation, route compilation, path defaults, TLS validation, and compatibility with a missing optional Gateway stable pointer.
- [x] Run `go test ./internal/gateway ./cmd/wheelmaker-gateway` (or the repository-equivalent package command) and `gofmt`.

## Task 2: Implement Gateway runtime and platform service integration

- [x] Add runtime reload/health behavior in `server/internal/gateway` (atomic generated config write, validate-before-reload, status/health endpoint, and clear errors when Caddy is absent or stopped).
- [x] Add `scripts/deploy/gateway-runtime.mjs` with platform adapters for Windows, Linux, and macOS, using the existing same-user service conventions; install registers boot autostart and starts Gateway, while `start`/`stop` only change current runtime.
- [x] Ensure service metadata uses the configured Gateway home and the existing deploy user; initial privileged registration is explicit, and no enable/disable command or firewall operation is introduced.
- [x] Add tests for reload, start/stop idempotency, service command generation, and failure diagnostics.
- [x] Run the focused Node tests and a local Gateway `validate`/`serve` smoke check.

## Task 3: Add optional Gateway release artifacts to the WheelMaker release flow

- [x] Add `scripts/release/gateway.mjs` to build/package `wheelmaker-gateway` for `windows-amd64`, `linux-amd64`, `darwin-amd64`, and `darwin-arm64`, with SHA-256 and byte-size metadata.
- [x] Extend release CLI options and prompts with `--with-gateway` (same release version as the WheelMaker release; no separate Gateway version input), while preserving existing Desktop/Android options.
- [x] Extend build, package, upload, and commit plumbing so Gateway artifacts are included only when selected; any selected Gateway build/upload/commit failure aborts the complete release/stable update; when unselected, the previous stable Gateway pointer is carried forward.
- [x] Extend release manifest/stable metadata validation with an optional `stable.gateway` pointer and fixed `/gateway/` artifact namespace; preserve old stable files that omit it.
- [x] Add release unit tests for all four targets, option parsing, checksums, carry-forward behavior, and transactional failure handling.
- [x] Run focused release tests plus a local non-publishing package build.

## Task 4: Extend Release Server sessions and atomic Gateway artifact commits

- [x] Extend publish session request/state with `withGateway` and allow only the four Gateway artifact names plus their manifest in the fixed Gateway namespace.
- [x] Validate Gateway manifest version, target, size, SHA-256, and archive contents before commit; reject path traversal and unexpected files.
- [x] Commit Gateway artifacts by swapping fixed `current` and `previous` slots under `public/gateway/`, then write `stable.json` last; preserve/restore the prior stable pointer on failure and retain the previous slot for rollback.
- [x] Keep existing release/Desktop/Android commit behavior and backward compatibility unchanged.
- [x] Add server tests for session authorization, manifest validation, current/previous swap, stable-last ordering, rollback, and missing-Gateway compatibility.
- [x] Run `go test ./internal/releaseserver ./cmd/wheelmaker-release-server` and relevant integration tests.

## Task 5: Integrate Gateway into deploy without affecting normal updates

- [x] Add `scripts/deploy/gateway-config.mjs` for reading existing global/site files, prompting on every interactive full deployment, validating `publicUrl`/roots/upstreams/cert pairs, and writing only the Workspace site file when the user confirms; a negative answer leaves the existing site unchanged.
- [x] Add `scripts/deploy/gateway-install.mjs` to resolve the stable Gateway pointer, download the selected platform artifact, verify size/SHA-256, stage/rollback atomically, install the service, and start it by default; missing pointer remains a clear “run explicit Gateway deployment” condition for Release Server hosts.
- [x] Wire full install/repair deployment to these modules; wire `deploy.mjs update` so it performs zero Gateway inspect/download/config/start/stop work.
- [x] Preserve the existing Web delete+rename update and accepted transient 404 behavior.
- [x] Support explicit noninteractive write/skip flags; do not silently overwrite `gateway/config.json` or the Release Server site file.
- [x] Add deploy tests for prompt semantics, checksum/rollback, path ownership, update isolation, and service startup.
- [x] Run focused deploy tests and a local dry-run/validation.

## Task 6: Hard-migrate Release Server deployment to semantic Gateway configuration

- [x] Read and update `scripts/release-server/deploy.mjs` and its tests so deployment installs/updates only the Release Server app/service/data and writes/validates `gateway/sites/release-server.json`.
- [x] Remove external Caddy installation/restart and all Nginx stop/disable/config/certificate/firewall actions from the Release Server deploy path; do not delete unrelated user changes without replacing their behavior in tests/docs.
- [x] Discover the installed Gateway home through its stable metadata/`paths` command; fail with an actionable explicit Gateway deployment instruction when absent.
- [x] If Gateway is running, request/verify hot reload; if stopped, report that the site config applies on the next manual Gateway `start`; loopback Release health and site validation determine deployment success, while public HTTPS is informational when Gateway is stopped.
- [x] Update release-server deployment docs and acceptance scripts to assert semantic config and the no-proxy-lifecycle boundary.
- [x] Run `node --test scripts/release-server/deploy.test.mjs` and the release-server acceptance checks.

## Task 7: Provide a standalone Nginx disable helper

- [x] Add `scripts/disable-nginx.sh` and `scripts/disable-nginx.ps1` (plus tests/docs) that only stop Nginx and disable boot autostart for known service-manager forms.
- [x] Do not remove packages, configs, certificates, firewall rules, or mention/operate Gateway; unknown service state must return manual instructions without destructive guesses.
- [x] Run shell/PowerShell syntax checks and helper tests on representative service states.

## Task 8: Finish documentation, integration checks, and review

- [x] Update `docs/wiki/architecture/gateway.md`, the architecture index, release/build wiki, self-hosted Release Server design, and deployment docs to match the implemented commands and ownership boundaries.
- [x] Add end-to-end fixtures covering release-with/without-Gateway, fixed `/gateway/` publication, deploy prompt choices, Gateway config generation, reload, and legacy Nginx coexistence/disable workflow.
- [x] Run repository formatting and verification: `go test ./...`, focused Node tests, `git diff --check`, and security acceptance scripts (the acceptance run reached the existing npm audit baseline; external deployment infrastructure was not invoked).
- [x] Re-check the approved Spec against implementation, inspect `git status -sb` and the complete diff, and report any platform-specific validation that could not run.

## Review checkpoints

- After Tasks 1–2: Gateway can validate/compile/serve and has independent service lifecycle.
- After Tasks 3–4: a selected Gateway artifact is published atomically and an old stable server remains compatible.
- After Tasks 5–6: full deployment writes semantic site config, normal update is isolated, and Release Server no longer manages a proxy.
- After Tasks 7–8: migration helper/docs/tests match the final operational contract.

## Self-review checklist

- [x] No protocol version change.
- [x] No raw Caddyfile or generated Caddy JSON is treated as user-owned configuration.
- [x] `config.json`, `sites/workspace.json`, and `sites/release-server.json` ownership is distinct and documented.
- [x] HTTPS automatic issuance is opt-out only through `http://` or a complete custom cert/key pair.
- [x] Gateway is never touched by normal `deploy.mjs update`.
- [x] Release failures with `--with-gateway` are transactional; unchecked releases carry the prior pointer.
- [x] Release Server deploy has no Gateway/Nginx lifecycle or firewall side effects.
