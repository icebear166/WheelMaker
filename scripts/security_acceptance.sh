#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
server_root="$repo_root/server"
app_root="$repo_root/app"
android_root="$repo_root/mobile/android"
deferred_document="$repo_root/docs/security-dependency-deferred.md"
audit_production=$(mktemp)
audit_complete=$(mktemp)
scan_output=$(mktemp)
trap 'rm -f "$audit_production" "$audit_complete" "$scan_output"' EXIT HUP INT TERM

gate() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf 'security acceptance failed: %s\n' "$1" >&2
  exit 1
}

run_powershell_test() {
  if command -v pwsh >/dev/null 2>&1; then
    pwsh -NoProfile -ExecutionPolicy Bypass -File "$repo_root/$1"
  elif command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$repo_root/$1"
  else
    fail 'PowerShell is required for publish and deployment script tests'
  fi
}

assert_no_production_matches() {
  label=$1
  pattern=$2
  if rg -n --hidden \
      --glob '!**/*_test.go' \
      --glob '!**/__tests__/**' \
      --glob '!**/test/**' \
      --glob '!**/security/token.go' \
      -e "$pattern" \
      "$repo_root/server" "$repo_root/app/web/src" "$repo_root/mobile/android/app/src/main" >"$scan_output" 2>&1; then
    fail "$label found a forbidden production source pattern"
  else
    code=$?
    [ "$code" -eq 1 ] || fail "$label could not complete rg scan"
  fi
}

cd "$repo_root"

gate 'Gitleaks current tree'
gitleaks dir --redact --no-banner . >"$scan_output" 2>&1 || fail 'gitleaks current tree'

gate 'Baseline security regressions'
(
  cd "$server_root"
  go test ./internal/security -run 'Test(NewRegistryToken|ValidateRegistryToken|RequireLoopbackAddress|ForwardedHeaders)'
  go test ./internal/shared -run 'Test(WriteConfigFileAtomicallyReplacesContent|SecureConfigFileRestrictsWindowsDACL)'
  go test ./internal/registry ./internal/portrelay -run 'Test(SecurityE2E|RunRejectsNonLoopbackAddress|RelayListenerBindsLoopbackOnly|RelayEnableAllowsOnlyExactLoopbackTargetHost|RelayForwardedHeadersRequireLoopbackPeer)'
)

gate 'Go full tests'
(cd "$server_root" && go test ./...)

gate 'Web Jest'
(cd "$app_root" && npm test -- --runInBand)

gate 'Web typecheck'
(cd "$app_root" && npm run tsc:web)

gate 'Web release build'
(cd "$app_root" && npm run build:web:release)

gate 'Production npm audit'
(cd "$app_root" && npm audit --omit=dev --audit-level=moderate --json >"$audit_production" 2>/dev/null) || fail 'production npm audit'

gate 'Complete npm audit'
(cd "$app_root" && npm audit --audit-level=high --json >"$audit_complete" 2>/dev/null) || fail 'complete npm audit'
node - "$audit_complete" "$deferred_document" <<'NODE'
const fs = require('fs');
const audit = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const deferred = fs.readFileSync(process.argv[3], 'utf8');
const counts = audit?.metadata?.vulnerabilities;
if (!counts || counts.high > 0 || counts.critical > 0) process.exit(1);
for (const [name, finding] of Object.entries(audit.vulnerabilities || {})) {
  if (finding.severity !== 'low' && finding.severity !== 'moderate') continue;
  const majorOnly = finding.fixAvailable && typeof finding.fixAvailable === 'object' && finding.fixAvailable.isSemVerMajor === true;
  if (!majorOnly || !deferred.includes('`' + name + '`')) process.exit(1);
}
NODE

gate 'Android JVM tests and lint'
(cd "$android_root" && gradle test lint)

gate 'Node release and deployment tests'
node --test "$repo_root"/scripts/release/*.test.mjs "$repo_root"/scripts/deploy/*.test.mjs

gate 'Publish and deployment script tests'
for script_test in \
  scripts/test_android_project_ps1.ps1 \
  scripts/test_android_release_signing.ps1 \
  scripts/test_security_hooks.ps1 \
  scripts/test_security_docs.ps1 \
  scripts/test_security_acceptance_ps1.ps1
do
  run_powershell_test "$script_test"
done

gate 'Forbidden production source gate'
assert_no_production_matches 'legacy default token' 'wheelmaker-local-token'
assert_no_production_matches 'retired interfaces' 'LOCAL_TOKEN_KEY|LocalHubRead|addJavascriptInterface|RegistryRoleMonitor|registry\.monitor|monitor\.(listHub|status|log|db|action|restart)|:9632|InsecureSkipVerify'
assert_no_production_matches 'retired backend key migration' 'migrateLegacyBackendSecrets|extractLegacyBackendSecrets|getLegacyBackendSecrets|clearLegacyBackendSecret|retryBackendSecretMigration|config\.json.{0,80}secrets'
assert_no_production_matches 'Android Server Data key persistence' '(SharedPreferences|DataStore|Room|SQLite|FileOutputStream).{0,120}(accessToken|speechCredential|volcengine)|(accessToken|speechCredential|volcengine).{0,120}(SharedPreferences|DataStore|Room|SQLite|FileOutputStream)'
debug_signing_fallback='signingConfigs.getByName("debug")'
if grep -F "$debug_signing_fallback" "$android_root/app/build.gradle.kts" >"$scan_output" 2>&1; then
  fail 'Android release build contains a debug signing fallback'
fi

gate 'Working tree whitespace check'
git diff --check

printf '\nSecurity acceptance: PASS\n'
