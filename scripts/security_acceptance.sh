#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
server_root="$repo_root/server"
app_root="$repo_root/app"
android_root="$repo_root/mobile/android"
wiki_kit_root="$repo_root/personal-wiki-kit"
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
node --test "$repo_root"/scripts/release-server/*.test.mjs "$repo_root"/scripts/release/*.test.mjs "$repo_root"/scripts/deploy/*.test.mjs "$repo_root"/scripts/disable-nginx.test.mjs "$repo_root"/scripts/personal-wiki-kit-release.test.mjs

gate 'Personal Wiki Kit security'
(
  cd "$wiki_kit_root"
  npm test
  npm run typecheck
  npm run build
  npm run check:public
  cd server
  go test ./...
)

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
retired_release_pattern='raw\.githubusercontent\.com/swm8023/wheelmaker-release|api\.github\.com/repos/swm8023/wheelmaker-release|github\.com/swm8023/wheelmaker-release/releases|WHEELMAKER_RELEASE_APP_ID|WHEELMAKER_RELEASE_INSTALLATION_ID|WHEELMAKER_RELEASE_APP_PRIVATE_KEY'
if rg -n --glob '!**/*.test.mjs' --glob '!**/__tests__/**' \
    -e "$retired_release_pattern" \
    "$repo_root/README.md" "$repo_root/INSTALL.md" "$repo_root/CLAUDE.md" \
    "$repo_root/server/CLAUDE.md" "$repo_root/.github" \
    "$repo_root/scripts/release" "$repo_root/scripts/deploy" "$repo_root/scripts/release-server" \
    "$repo_root/app/web/src" "$repo_root/app/web/webpack.config.js" \
    "$repo_root/mobile/android/app/src/main" >"$scan_output" 2>&1; then
  fail 'retired GitHub release hosting or App credentials remain in active sources'
else
  code=$?
  [ "$code" -eq 1 ] || fail 'retired release source scan could not complete'
fi

release_deploy="$repo_root/scripts/release-server/deploy.mjs"
remote_install="$repo_root/scripts/release-server/remote-install.mjs"
publisher_config="$repo_root/scripts/release/publisher-config.mjs"
grep -F '"listen":"127.0.0.1:9680"' "$remote_install" >/dev/null || fail 'release service application listener is not loopback-only'
grep -F '$deploy_home/.wheelmaker/release-server' "$remote_install" >/dev/null || fail 'release deployment is not rooted in the SSH login Home'
grep -F 'gateway_config_path="$gateway_home/config.json"' "$remote_install" >/dev/null || fail 'release deployment does not use the Gateway config'
grep -F 'configure-public-url --config "$gateway_config_candidate"' "$remote_install" >/dev/null || fail 'release deployment does not update the Gateway release section'
grep -F 'systemctl --user' "$remote_install" >/dev/null || fail 'release deployment does not use a user service'
if grep -F 'gateway/sites' "$remote_install" >/dev/null || grep -F 'release-server.json' "$remote_install" >/dev/null; then
  fail 'release deployment still writes the retired Gateway site file'
fi
grep -F '$HOME/.wheelmaker/gateway/config.json' "$publisher_config" >/dev/null || fail 'publisher token provisioning does not target the Gateway release section'
if grep -F '$HOME/.wheelmaker/release-server/config.json' "$publisher_config" >/dev/null; then
  fail 'publisher token provisioning still targets the retired release config'
fi
retired_root_target='root@release.'"wheelmaker.top"
retired_gateway_home='/etc/'"wheelmaker-gateway/home"
retired_gateway_data='/srv/wheelmaker-release/'"gateway"
retired_legacy_flag='--legacy-'"nginx"
retired_bootstrap='bootstrap-release-'"gateway"
retired_admin='127.0.0.1:2019/'"load"
retired_bridge_pattern="$retired_root_target|$retired_gateway_home|$retired_gateway_data|$retired_legacy_flag|$retired_bootstrap|gateway_binary.*(validate|render)|$retired_admin|systemctl\s+(start|stop|restart|enable|disable)\s+(nginx|caddy)"
if rg -n -e "$retired_bridge_pattern" "$release_deploy" "$remote_install" >"$scan_output" 2>&1; then
  fail 'release server deployment contains a retired bridge or proxy lifecycle action'
fi
grep -F "join(homeDirectory, '.wheelmaker')" "$publisher_config" >/dev/null || fail 'publisher Token config is not rooted below the publisher user home'
if sed -n '/const files = \[/,/\];/p' "$release_deploy" | grep -E 'release-server\.json|WHEELMAKER_RELEASE_TOKEN|identityFile' >/dev/null; then
  fail 'release server deployment upload list contains a credential or SSH private key'
fi
debug_signing_fallback='signingConfigs.getByName("debug")'
if grep -F "$debug_signing_fallback" "$android_root/app/build.gradle.kts" >"$scan_output" 2>&1; then
  fail 'Android release build contains a debug signing fallback'
fi

gate 'Working tree whitespace check'
git diff --check

printf '\nSecurity acceptance: PASS\n'
