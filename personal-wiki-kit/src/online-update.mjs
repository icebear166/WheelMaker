import {execFile} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {promisify} from 'node:util';

import {installSkills} from './install-skills.mjs';
import {renderInstalledLauncher} from './installed-launcher.mjs';
import {parseKitManifest} from './kit-manifest.mjs';
import {sha256File} from './kit-lock.mjs';
import {updateKit} from './update-kit.mjs';

const execFileAsync = promisify(execFile);
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const RELEASE_BASE_URL = 'https://release.wheelmaker.top';

async function pathExists(filename) {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function versionParts(value) {
  const match = EXACT_VERSION.exec(value ?? '');
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return String(left).localeCompare(String(right));
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  }
  return left.localeCompare(right);
}

export function validateOnlineKitStable(value, baseUrl = RELEASE_BASE_URL) {
  if (!value || value.schema !== 1 || !EXACT_VERSION.test(value.version ?? '')) {
    throw new Error('Personal Wiki Kit stable.json 无效');
  }
  const artifact = value.artifacts?.['windows-x64'];
  const expectedName = `personal-wiki-kit-v${value.version}-windows-x64.zip`;
  const expectedPath = `/personal-wiki-kit/releases/v${value.version}/${expectedName}`;
  if (!artifact
    || artifact.path !== expectedPath
    || !Number.isSafeInteger(artifact.size)
    || artifact.size <= 0
    || !SHA256.test(artifact.sha256 ?? '')) {
    throw new Error('Personal Wiki Kit Windows stable 指针无效');
  }
  const base = new URL(baseUrl);
  const artifactURL = new URL(artifact.path, `${base.origin}/`);
  if (artifactURL.origin !== base.origin) throw new Error('Personal Wiki Kit 下载地址跨越发布源');
  return {
    schema: 1,
    version: value.version,
    artifact: {...artifact, name: expectedName, url: artifactURL.href},
  };
}

export async function resolveOnlineKitUpdate({currentVersion}, {
  fetchStable,
  confirm,
  downloadAndActivate,
}) {
  const stable = await fetchStable();
  const targetVersion = stable.version;
  if (compareVersions(targetVersion, currentVersion) <= 0) {
    return {changed: false, currentVersion, targetVersion};
  }
  const approved = await confirm(`当前 Personal Wiki Kit：${currentVersion}\n可更新到：${targetVersion}\n现在下载并安全更新？`);
  if (!approved) {
    return {changed: false, cancelled: true, currentVersion, targetVersion};
  }
  return downloadAndActivate(stable);
}

async function replaceFile(filename, content, suffix, state) {
  const backup = `${filename}.backup-${suffix}`;
  const candidate = `${filename}.candidate-${suffix}`;
  if (await pathExists(backup) || await pathExists(candidate)) {
    throw new Error(`Kit 更新候选路径已存在：${filename}`);
  }
  await mkdir(path.dirname(filename), {recursive: true});
  await writeFile(candidate, content, {encoding: 'utf8', flag: 'wx'});
  const hadExisting = await pathExists(filename);
  if (hadExisting) await rename(filename, backup);
  try {
    await rename(candidate, filename);
  } catch (error) {
    if (hadExisting && await pathExists(backup)) await rename(backup, filename);
    throw error;
  }
  state.push({filename, backup, hadExisting});
}

async function rollbackFiles(entries) {
  for (const entry of [...entries].reverse()) {
    await rm(entry.filename, {force: true});
    if (entry.hadExisting && await pathExists(entry.backup)) {
      await rename(entry.backup, entry.filename);
    }
  }
}

async function finalizeFiles(entries) {
  for (const entry of entries) await rm(entry.backup, {force: true});
}

async function rollbackSkills(skillsDirectory, backups) {
  for (const skillName of ['lookup-knowledge', 'publish-knowledge']) {
    const target = path.join(skillsDirectory, skillName);
    const backup = backups.find(candidate => path.basename(candidate).startsWith(`.${skillName}.backup-`));
    await rm(target, {force: true, recursive: true});
    if (backup && await pathExists(backup)) await rename(backup, target);
  }
}

export async function activateInstalledKit(options = {}, {
  checkCompatibility,
  installSkillsImpl = installSkills,
  updateKitImpl = updateKit,
  timestamp = `${Date.now()}-${process.pid}`,
} = {}) {
  for (const field of ['configDirectory', 'repository', 'skillsDirectory', 'candidateKitRoot', 'candidateArtifact', 'targetLock']) {
    if (!options[field]) throw new Error(`在线 Kit 更新缺少 ${field}`);
  }
  const configDirectory = path.resolve(options.configDirectory);
  const repository = path.resolve(options.repository);
  const skillsDirectory = path.resolve(options.skillsDirectory);
  const candidateKitRoot = path.resolve(options.candidateKitRoot);
  const targetLock = options.targetLock;
  const manifest = parseKitManifest(await readFile(path.join(candidateKitRoot, 'kit.json'), 'utf8'));
  if (manifest.version !== targetLock.version) throw new Error('下载的 Kit 版本与 stable 不一致');
  const versionsRoot = path.join(configDirectory, 'kit', 'versions');
  const targetRoot = path.join(versionsRoot, targetLock.version);
  const stagedRoot = path.join(versionsRoot, `.candidate-${targetLock.version}-${timestamp}`);
  if (await pathExists(targetRoot) || await pathExists(stagedRoot)) {
    throw new Error(`目标 Kit 版本目录已存在，拒绝覆盖：${targetRoot}`);
  }
  await mkdir(versionsRoot, {recursive: true});
  await cp(candidateKitRoot, stagedRoot, {recursive: true, errorOnExist: true});

  const replacedFiles = [];
  let versionActivated = false;
  let skillsResult;
  try {
    return await updateKitImpl({
      repository,
      candidateKitRoot,
      candidateArtifact: path.resolve(options.candidateArtifact),
      targetLock,
    }, {
      checkCompatibility,
      beginMigration: async () => ({
        apply: async () => {
          await rename(stagedRoot, targetRoot);
          versionActivated = true;
          await replaceFile(
            path.join(configDirectory, 'kit', 'active-version.txt'),
            `${targetLock.version}\n`,
            timestamp,
            replacedFiles,
          );
          await replaceFile(
            path.join(configDirectory, 'bin', 'personal-wiki.cmd'),
            renderInstalledLauncher(configDirectory),
            timestamp,
            replacedFiles,
          );
          skillsResult = await installSkillsImpl({
            sourceRoot: path.join(targetRoot, 'skills'),
            destinationRoot: skillsDirectory,
            timestamp,
          });
        },
        rollback: async () => {
          if (skillsResult) await rollbackSkills(skillsDirectory, skillsResult.backups);
          await rollbackFiles(replacedFiles);
          if (versionActivated) await rm(targetRoot, {force: true, recursive: true});
        },
        finalize: async () => {
          await Promise.allSettled([
            finalizeFiles(replacedFiles),
            ...(skillsResult?.backups ?? []).map(backup => rm(backup, {force: true, recursive: true})),
          ]);
        },
      }),
    });
  } finally {
    await rm(stagedRoot, {force: true, recursive: true});
  }
}

async function defaultFetchStable(fetchImpl, baseUrl) {
  const response = await fetchImpl(`${baseUrl}/personal-wiki-kit/stable.json`, {
    cache: 'no-store',
    headers: {'Cache-Control': 'no-cache'},
  });
  if (!response.ok) throw new Error(`读取 Personal Wiki Kit stable 失败：HTTP ${response.status}`);
  return validateOnlineKitStable(await response.json(), baseUrl);
}

async function defaultExtractZip(archive, destination) {
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
    archive,
    destination,
  ], {windowsHide: true});
}

export async function updateFromReleaseServer(options = {}, {
  fetchImpl = fetch,
  confirm = async () => false,
  extractZip = defaultExtractZip,
  activate = activateInstalledKit,
  baseUrl = RELEASE_BASE_URL,
} = {}) {
  const configDirectory = path.resolve(options.configDirectory);
  const activeVersion = (await readFile(path.join(configDirectory, 'kit', 'active-version.txt'), 'utf8')).trim();
  if (!EXACT_VERSION.test(activeVersion)) throw new Error('当前 Kit active-version.txt 无效');
  return resolveOnlineKitUpdate({currentVersion: activeVersion}, {
    fetchStable: () => defaultFetchStable(fetchImpl, baseUrl),
    confirm,
    downloadAndActivate: async stable => {
      const temporary = await mkdtemp(path.join(tmpdir(), 'personal-wiki-kit-update-'));
      try {
        const archive = path.join(temporary, stable.artifact.name);
        const response = await fetchImpl(stable.artifact.url, {cache: 'no-store'});
        if (!response.ok || !response.body) throw new Error(`下载 Personal Wiki Kit 失败：HTTP ${response.status}`);
        await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, {flags: 'wx'}));
        const identity = await stat(archive);
        if (identity.size !== stable.artifact.size) {
          throw new Error(`下载的 Kit 大小不匹配：期望 ${stable.artifact.size}，实际 ${identity.size}`);
        }
        const digest = await sha256File(archive);
        if (digest !== stable.artifact.sha256) throw new Error('下载的 Kit SHA-256 不匹配');
        const extracted = path.join(temporary, 'extracted');
        await mkdir(extracted);
        await extractZip(archive, extracted);
        const candidateKitRoot = path.join(extracted, `personal-wiki-kit-v${stable.version}-windows-x64`);
        const candidateManifest = parseKitManifest(await readFile(path.join(candidateKitRoot, 'kit.json'), 'utf8'));
        if (candidateManifest.version !== stable.version) throw new Error('解压后的 Kit 版本不匹配');
        return activate({
          configDirectory,
          repository: options.repository,
          skillsDirectory: options.skillsDirectory || path.join(homedir(), '.codex', 'skills'),
          candidateKitRoot,
          candidateArtifact: archive,
          targetLock: {
            schema: 1,
            version: stable.version,
            source: stable.artifact.url,
            sha256: stable.artifact.sha256,
          },
        });
      } finally {
        await rm(temporary, {force: true, recursive: true, maxRetries: 5, retryDelay: 100});
      }
    },
  });
}
