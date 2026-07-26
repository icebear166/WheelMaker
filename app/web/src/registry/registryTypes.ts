export type RegistryMessageType = 'request' | 'response' | 'error' | 'event';

export interface RegistryErrorPayload {
  code?: string;
  message?: string;
  details?: unknown;
}

export interface RegistrySpeechAudioConfig {
  format: 'pcm';
  codec: 'raw';
  rate: 16000;
  bits: 16;
  channel: 1;
}

export interface RegistrySpeechStartPayload {
  provider: 'volcengine';
  audio: RegistrySpeechAudioConfig;
}

export interface RegistrySpeechStartResponse {
  streamId: string;
}

export interface RegistrySpeechChunkPayload {
  streamId: string;
  seq: number;
  pcm: string;
}

export interface RegistrySpeechFinishPayload {
  streamId: string;
}

export interface RegistrySpeechCancelPayload {
  streamId: string;
  reason: 'user' | 'gesture' | 'error' | 'disconnect';
}

export interface RegistrySpeechTranscriptEvent {
  streamId: string;
  text: string;
  final: boolean;
}

export interface RegistrySpeechErrorEvent {
  streamId?: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface RegistryDebugUploadLogPayload {
  source: string;
  text: string;
}

export interface RegistryDebugUploadLogResponse {
  ok: boolean;
  fileName: string;
}

export interface RegistryTTSSynthesizePayload {
	model: 'mimo-v2-tts' | 'mimo-v2.5-tts' | 'mimo-v2.5-tts-voiceclone' | 'mimo-v2.5-tts-voicedesign';
	voice: 'mimo_default' | '冰糖' | '茉莉' | '苏打' | '白桦' | 'Mia' | 'Chloe' | 'Milo' | 'Dean';
	text: string;
}

export interface RegistryTTSSynthesizeResponse {
	audioBase64: string;
	format: string;
}

export interface RegistryDeviceSession {
  deviceId: string;
  deviceName: string;
  basePath: string;
	lastLoginIp: string;
	lastLoginLocation: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export type RegistryClientName = 'wheelmaker-web' | 'wheelmaker-desktop' | 'wheelmaker-android';

export interface RegistryServerConfigUpdatePayload {
  section: 'voiceInput' | 'textToSpeech';
  field: 'key' | 'model' | 'voice';
  action: 'set' | 'clear';
  value?: string;
}

export interface RegistryAndroidSpeechCredentialResponse {
  accessToken: string;
  version: string;
  model: 'doubao-streaming-asr-2.0';
}

export interface RegistryEnvelope<TPayload = unknown> {
  requestId?: number;
  type: RegistryMessageType;
  method?: string;
  projectId?: string;
  hubId?: string;
  payload?: TPayload;
}

export type RegistryHubStateStatus = 'empty' | 'ready' | 'refreshing' | 'partial' | 'error' | string;
export type RegistryHubStateSectionStatus = 'empty' | 'ready' | 'refreshing' | 'error' | string;
export type RegistryHubStateActionStatus = 'running' | 'succeeded' | 'failed' | string;
export type RegistryHubStateSectionName =
  | 'agentPackages'
  | 'wheelmakerUpdate'
  | 'skills'
  | 'tokenStats'
  | 'fileIndex'
	  | 'releasePublish'
  | string;

export interface RegistryHubStateAction {
  id: string;
  name: string;
  status: RegistryHubStateActionStatus;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  params?: Record<string, unknown>;
  result?: unknown;
}

export interface RegistryHubStateSection<TData = unknown> {
  status: RegistryHubStateSectionStatus;
  updatedAt?: string;
  startedAt?: string;
  error?: string;
  data?: TData;
  action?: RegistryHubStateAction;
}

export interface RegistryHubState {
  hubId: string;
  status: RegistryHubStateStatus;
  updatedAt?: string;
  sections: Record<string, RegistryHubStateSection>;
}

export interface RegistryReleasePublishJob {
  id: string;
  hubId: string;
  kind: 'version' | 'debugWeb';
  status: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  errorCode?: string;
  log?: string;
  targetState?: 'accepted' | 'success' | 'failed' | string;
}

export interface RegistryReleasePublishResponse {
  ok: boolean;
  accepted?: boolean;
  status: string;
  error?: string;
  job?: RegistryReleasePublishJob;
}

export interface RegistrySessionContentBlock {
  type: 'text' | 'image' | 'resource_link';
  text?: string;
  mimeType?: string;
  data?: string;
  uri?: string;
  name?: string;
  size?: number;
}

export interface RegistrySessionAttachmentView {
  id: string;
  name: string;
  mimeType?: string;
  size: number;
  sha256?: string;
  uri: string;
}

export interface RegistrySessionAttachmentStartPayload {
  sessionId: string;
  name: string;
  mimeType?: string;
  size: number;
}

export interface RegistrySessionAttachmentStartResponse {
  ok: boolean;
  sessionId: string;
  uploadId: string;
  chunkSize: number;
  expiresIn?: number;
}

export interface RegistrySessionAttachmentChunkPayload {
  sessionId: string;
  uploadId: string;
  offset: number;
  data: string;
}

export interface RegistrySessionAttachmentChunkResponse {
  ok: boolean;
  sessionId: string;
  uploadId: string;
  received: number;
}

export interface RegistrySessionAttachmentFinishPayload {
  sessionId: string;
  uploadId: string;
  sha256: string;
}

export interface RegistrySessionAttachmentFinishResponse {
  ok: boolean;
  sessionId: string;
  attachment: RegistrySessionAttachmentView;
  block: RegistrySessionContentBlock;
}

export interface RegistrySessionAttachmentCancelPayload {
  sessionId: string;
  uploadId: string;
}

export interface RegistrySessionAttachmentCancelResponse {
  ok: boolean;
  sessionId: string;
  uploadId: string;
}

export interface RegistrySessionAttachmentDeletePayload {
  sessionId: string;
  attachmentId: string;
}

export interface RegistrySessionAttachmentDeleteResponse {
  ok: boolean;
  sessionId: string;
  attachmentId: string;
}

export interface RegistrySessionAttachmentReadPayload {
  sessionId: string;
  attachmentId?: string;
  uri?: string;
}

export interface RegistrySessionAttachmentContentResponse {
  ok: boolean;
  sessionId: string;
  attachmentId: string;
  mimeType?: string;
  encoding: 'base64' | 'utf-8' | string;
  content: string;
  isBinary?: boolean;
  width?: number;
  height?: number;
  size?: number;
  hash?: string;
}

export type RegistryTerminalStatus = 'running' | 'exited' | 'error';

export type RegistryTerminal = {
  terminalId: string;
  runId: string;
  hubId: string;
  projectId: string;
  projectName: string;
  initialCwd: string;
  shell: string;
  status: RegistryTerminalStatus;
  cols: number;
  rows: number;
  exitCode?: number;
  createdAt: string;
  exitedAt?: string;
};

export type RegistryTerminalListResponse = {terminals: RegistryTerminal[]};
export type RegistryTerminalCreateResponse = {terminal: RegistryTerminal; resizeToken: string};
export type RegistryTerminalGetResponse = {terminal: RegistryTerminal; snapshotSeq: number; snapshot: string};
export type RegistryTerminalResizeResponse = {terminal: RegistryTerminal; resizeToken?: string};
export type RegistryTerminalResizeRequest = {
  terminalId: string;
  cols: number;
  rows: number;
  claim?: boolean;
  resizeToken?: string;
};
export type RegistryTerminalInputEvent = {terminalId: string; runId: string; data: string};
export type RegistryTerminalOutputEvent = {terminalId: string; runId: string; seq: number; data: string};
export type RegistryTerminalChangedEvent = {
  change: 'created' | 'running' | 'resized' | 'exited' | 'restarted' | 'closed' | 'error';
  terminalId: string;
  terminal?: RegistryTerminal;
};

export interface RegistrySessionMessage {
  sessionId: string;
  turnIndex: number;
  method: string;
  param: Record<string, unknown>;
  finished: boolean;
}

export interface RegistrySessionTurn {
  turnIndex: number;
  content: string;
  finished: boolean;
}

export interface RegistrySessionPlanEntry {
  content: string;
  status?: string;
}

export interface RegistrySessionPromptArtifactFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface RegistrySessionPromptArtifact {
  artifactId: string;
  type: 'diff' | string;
  format: 'unified-diff' | string;
  fileCount: number;
  files?: RegistrySessionPromptArtifactFile[];
}

export interface RegistrySessionArtifactReadResponse {
  artifactId: string;
  type: 'diff' | string;
  format: 'unified-diff' | string;
  content: string;
}



export interface RegistrySessionConfigOptionValue {
  value: string;
  name?: string;
  description?: string;
}

export interface RegistrySessionConfigOption {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  type?: string;
  currentValue?: string;
  options?: RegistrySessionConfigOptionValue[];
}

export interface RegistrySessionCommand {
  name: string;
  description?: string;
}

export interface RegistrySessionUsage {
  used: number;
  size?: number;
  updatedAt?: string;
}

export interface RegistrySessionActionCapability {
  supported: boolean;
  reason?: string;
}

export interface RegistrySessionActionCapabilities {
  status: RegistrySessionActionCapability;
  compact: RegistrySessionActionCapability;
  steer: RegistrySessionActionCapability;
  fork: RegistrySessionActionCapability;
}

export type RegistrySessionSteerOutcome = 'steered' | 'sent';

export interface RegistrySessionSteerAccepted {
  ok: boolean;
  accepted: boolean;
  sessionId: string;
  clientMessageId: string;
  outcome: RegistrySessionSteerOutcome;
}

export interface RegistrySessionStatusContext {
  used: number;
  size?: number;
  updatedAt?: string;
}

export interface RegistrySessionRateLimit {
  id: string;
  name: string;
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins?: number;
  resetsAt?: string;
}

export interface RegistrySessionCredits {
  hasCredits: boolean;
  unlimited: boolean;
  balance?: string;
}

export interface RegistrySessionIndividualLimit {
  limit: string;
  used: string;
  remainingPercent: number;
  resetsAt?: string;
}

export interface RegistrySessionResetCredits {
  availableCount: number;
}

export interface RegistrySessionStatusAccount {
  planType?: string;
  credits?: RegistrySessionCredits;
  individualLimit?: RegistrySessionIndividualLimit;
  rateLimitReachedType?: string;
  rateLimitResetCredits?: RegistrySessionResetCredits;
}

export interface RegistrySessionStatusResult {
  ok: boolean;
  sessionId: string;
  context?: RegistrySessionStatusContext;
  limits: RegistrySessionRateLimit[];
  account?: RegistrySessionStatusAccount;
  updatedAt: string;
}

export interface RegistrySessionCompactAccepted {
  ok: boolean;
  accepted: boolean;
  sessionId: string;
  operationId: string;
}

export interface RegistrySessionForkPoint {
  provider: string;
  ref: string;
}

export interface RegistrySessionForkOrigin {
  sessionId: string;
  turnIndex: number;
  title?: string;
}

export interface RegistrySessionForkResponse {
  ok: boolean;
  session: RegistrySessionSummary;
}

export type RegistrySessionMarkColor = 'red' | 'yellow' | 'green' | 'blue';

export type RegistrySessionOperationStatus = 'queued' | 'started' | 'completed' | 'failed';

export interface RegistrySessionOperationPayload {
  operationId: string;
  type: 'compact' | 'fork';
  status: RegistrySessionOperationStatus;
  startedAt?: string;
  completedAt?: string;
  message?: string;
  forkedFrom?: RegistrySessionForkOrigin;
}

export interface RegistrySessionSummary {
  sessionId: string;
  title: string;
  preview: string;
  updatedAt: string;
  messageCount: number;
  unreadCount?: number;
  agentType?: string;
  createRequestId?: string;
  latestTurnIndex?: number;
  running?: boolean;
  pendingPermissionCount?: number;
  lastDoneTurnIndex?: number;
  lastDoneSuccess?: boolean;
  lastReadTurnIndex?: number;
  pinned?: boolean;
  markColor?: RegistrySessionMarkColor;
  configOptions?: RegistrySessionConfigOption[];
  commands?: RegistrySessionCommand[];
  usage?: RegistrySessionUsage;
  sessionActions?: RegistrySessionActionCapabilities;
  forkedFrom?: RegistrySessionForkOrigin;
}

export interface RegistryPermissionRespondResponse {
  accepted: boolean;
  permissionId: string;
  outcome: 'selected' | string;
  optionId: string;
}

export interface RegistryArchivedSessionSummary extends RegistrySessionSummary {
  projectName?: string;
  createdAt?: string;
  archivedAt: string;
  restoredAt?: string;
  turnCount: number;
  gapCount: number;
  nativeArchivedAt?: string;
  nativeUnarchivedAt?: string;
  nativeSyncWarning?: string;
}

export interface RegistrySessionArchiveReadResponse {
  sessionId: string;
  session: RegistryArchivedSessionSummary;
  turns: RegistrySessionTurn[];
  messages: RegistrySessionMessage[];
  latestTurnIndex: number;
  readOnly: true;
}

export interface RegistrySessionArchiveRestoreResponse {
  ok: boolean;
  sessionId: string;
  session: RegistrySessionSummary;
  warning?: string;
}

export interface RegistrySessionReadResponse {
  sessionId: string;
  session?: RegistrySessionSummary;
  turns: RegistrySessionTurn[];
  messages: RegistrySessionMessage[];
  latestTurnIndex: number;
}

export type RegistrySessionSearchAction = 'start' | 'query' | 'cancel';

export interface RegistrySessionSearchResult {
  projectId: string;
  sessionId: string;
  source: 'title' | 'prompt';
  turnIndex?: number;
}

export interface RegistrySessionSearchError {
  projectId: string;
  sessionId?: string;
  message: string;
}

export interface RegistrySessionSearchResponse {
  searchId: string;
  done: boolean;
  results: RegistrySessionSearchResult[];
  errors: RegistrySessionSearchError[];
}

export interface RegistrySessionSearchStatusResponse {
  searchId: string;
  done: boolean;
}

export type RegistryNpmPackageStatus =
  | 'checking_latest'
  | 'not_installed'
  | 'up_to_date'
  | 'update_available'
  | 'latest_unknown'
  | 'checking_failed'
  | 'deprecated'
  | 'installing'
  | 'updating'
  | 'uninstalling'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface RegistryNpmPackage {
  packageName: string;
  displayName: string;
  agentTypes: string[];
  kind: 'runtime' | 'deprecated';
  installed: boolean;
  installedVersion: string;
  latestVersion: string;
  status: RegistryNpmPackageStatus;
  error: string;
  canInstall: boolean;
  canUpdate: boolean;
  canUninstall: boolean;
}

export interface RegistryNpmHubSnapshot {
  hubId: string;
  nodeVersion: string;
  npmVersion: string;
  npmPrefix: string;
  warning: string;
  error: string;
  packages: RegistryNpmPackage[];
}

export interface RegistryNpmOperation {
  running: boolean;
  action: 'scan_latest' | 'install' | 'install_many' | 'uninstall' | 'reinstall' | string;
  packageName: string;
  packageNames?: string[];
  version: string;
  status: RegistryNpmPackageStatus;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  errorSummary: string;
  message?: string;
}

export interface RegistryNpmCommandResponse {
  ok: boolean;
  accepted?: boolean;
  updatedAt?: string;
  hub?: RegistryNpmHubSnapshot;
  operation: RegistryNpmOperation | null;
}

export type RegistryWheelMakerUpdateStatus =
  | 'installed'
  | 'up_to_date'
  | 'update_available'
  | 'update_pending'
  | 'not_installed'
  | 'checking_failed'
  | 'local_newer';

export interface RegistryWheelMakerInstalledRelease {
  schemaVersion: number;
  version: string;
  publishedAt: string;
  sourceSha: string;
  manifestSha256: string;
  installedAt: string;
}

export interface RegistryWheelMakerStableRelease {
  version: string;
  publishedAt: string;
  sourceSha: string;
}

export type RegistryWheelMakerUpdateJobState =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'applying'
  | 'restarting'
  | 'succeeded'
  | 'failed';

export interface RegistryWheelMakerUpdateJob {
  schema: number;
  jobId: string;
  state: RegistryWheelMakerUpdateJobState | string;
  version?: string;
  startedAt: string;
  updatedAt: string;
  errorCode?: string;
}

export interface RegistryWheelMakerPublishStatus {
  schema: number;
  state: string;
  phase: string;
  version?: string;
  sourceSha?: string;
  publisher?: string;
  startedAt?: string;
  updatedAt?: string;
  errorCode?: string;
}

export interface RegistryWheelMakerUpdateResponse {
  ok: boolean;
  accepted?: boolean;
  jobId?: string;
  status: RegistryWheelMakerUpdateStatus | string;
  hubId: string;
  installed?: RegistryWheelMakerInstalledRelease;
  job?: RegistryWheelMakerUpdateJob;
  canRequestUpdate: boolean;
  errorCode?: string;
}

export type RegistrySkillScope = 'hub' | 'project';

export interface RegistrySkillSnapshot {
  name: string;
  path?: string;
  category: string;
  categoryKey: string;
  managed?: boolean;
  agents?: string[];
}

export interface RegistrySkillSupportingFile {
  relativePath: string;
  size?: number;
  directory?: boolean;
}

export interface RegistrySkillDetail {
  name: string;
  scope: RegistrySkillScope;
  projectName?: string;
  path?: string;
  category: string;
  categoryKey: string;
  managed?: boolean;
  agents?: string[];
  source?: string;
  sourceUrl?: string;
  sourceType?: string;
  ref?: string;
  skillPath?: string;
  pluginName?: string;
  installedAt?: string;
  updatedAt?: string;
  skillMarkdown: string;
  supportingFiles: RegistrySkillSupportingFile[];
}

export interface RegistrySkillScopeSnapshot {
  scope: RegistrySkillScope;
  skills: RegistrySkillSnapshot[];
}

export interface RegistrySkillProjectSnapshot {
  projectName: string;
  projectId?: string;
  online: boolean;
  path?: string;
  skills: RegistrySkillSnapshot[];
  error?: string;
}

export interface RegistrySkillSourceCandidate {
  name: string;
  description?: string;
  category: string;
  categoryKey: string;
}

export interface RegistrySkillOperation {
  running: boolean;
  action: 'install' | 'uninstall' | 'update' | string;
  scope?: RegistrySkillScope;
  projectName?: string;
  source?: string;
  skills?: string[];
  includeProjects?: boolean;
  status: 'running' | 'succeeded' | 'failed' | string;
  startedAt: string;
  finishedAt?: string;
  exitCode: number | null;
  errorSummary?: string;
  message?: string;
}

export interface RegistrySkillCommandResponse {
  ok: boolean;
  accepted?: boolean;
  hubId: string;
  updatedAt?: string;
  source?: string;
  scope?: RegistrySkillScope;
  projectName?: string;
  hubSkills?: RegistrySkillScopeSnapshot;
  projects?: RegistrySkillProjectSnapshot[];
  skills?: RegistrySkillSnapshot[];
  detail?: RegistrySkillDetail;
  candidates?: RegistrySkillSourceCandidate[];
  operation?: RegistrySkillOperation | null;
  message?: string;
  errorSummary?: string;
}

export interface RegistrySkillInstallPayload {
  hubId: string;
  scope: RegistrySkillScope;
  projectName?: string;
  source: string;
  skills: string[];
}

export interface RegistrySkillScopePayload {
  hubId: string;
  scope: RegistrySkillScope;
  projectName?: string;
  skills?: string[];
  includeProjects?: boolean;
}

export interface RegistrySkillDetailPayload {
  hubId: string;
  scope: RegistrySkillScope;
  projectName?: string;
  skillName: string;
}

export interface RegistrySessionMessageEventPayload {
  sessionId: string;
  turn: RegistrySessionTurn;
}

export type RegistryChatContentBlock = RegistrySessionContentBlock;
export type RegistryChatMessage = RegistrySessionMessage;
export type RegistryChatSession = RegistrySessionSummary;
export type RegistryChatSessionReadResponse = RegistrySessionReadResponse;
export type RegistryChatMessageEventPayload = RegistrySessionMessageEventPayload;

export interface RegistryResumableSession {
  sessionId: string;
  title: string;
  preview?: string;
  updatedAt: string;
  messageCount: number;
  cwd: string;
}

export interface RegistryProjectGitState {
  branch: string;
  headSha: string;
  dirty: boolean;
  gitRev: string;
  worktreeRev: string;
}

export interface RegistryGitRev {
  gitRev: string;
  worktreeRev: string;
}

export interface RegistryProjectAgentProfile {
  name: string;
  skills?: string[];
}

export interface RegistryHub {
  hubId: string;
}

export interface RegistryProjectListResponse {
  projects: RegistryProject[];
  hubs: RegistryHub[];
}

export type RegistryPortRelayStatus = 'Disabled' | 'Opening' | 'Up' | 'Error';

export interface RegistryPortRelaySnapshot {
  ok: boolean;
  enabled: boolean;
  status: RegistryPortRelayStatus;
  listenPort?: number;
  hubId?: string;
  targetHost?: string;
  targetPort?: number;
  relayUrl?: string;
  accessCodeGeneration?: number;
  tunnelConnectedAt?: string;
  error?: string;
}

export interface RegistryPortRelayEnablePayload {
  listenPort: number;
  hubId: string;
  targetHost: string;
  targetPort: number;
  accessCode: string;
}

export interface RegistryProject {
  projectId: string;
  name: string;
  online: boolean;
  path: string;
  hubId?: string;
  agent?: string;
  agents?: string[];
  agentProfiles?: RegistryProjectAgentProfile[];
  projectRev?: string;
  git?: RegistryProjectGitState;
}

export interface RegistryFsEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  size?: number;
  mtime?: string;
}

export interface RegistryFsListResponse {
  path: string;
  hash?: string;
  notModified: boolean;
  entries?: RegistryFsEntry[];
}

export interface RegistryFsInfo {
  path: string;
  kind: 'file' | 'dir';
  size?: number;
  isBinary?: boolean;
  mimeType?: string;
  totalLines?: number;
  tabSize?: number;
  entryCount?: number;
  hash?: string;
}

export interface RegistryFsReadResponse {
  path: string;
  hash?: string;
  notModified: boolean;
  isBinary?: boolean;
  mimeType?: string;
  encoding?: string;
  content?: string | null;
  size?: number;
  total?: number;
  returned?: number;
}

export interface RegistryFileIndexStatus {
  projectId: string;
  name: string;
  path: string;
  status: 'missing' | 'indexed' | 'scanning' | 'error' | string;
  fileCount: number;
  indexedAt?: string;
  indexPath?: string;
  running?: boolean;
  error?: string;
}

export interface RegistryFileIndexStatusResponse {
  hubId?: string;
  projects: RegistryFileIndexStatus[];
}

export interface RegistryFileIndexRebuildResponse {
  ok: boolean;
  accepted: boolean;
  alreadyRunning?: boolean;
  running: boolean;
  projectId: string;
  status: string;
  error?: string;
}

export interface RegistryFileIndexSearchResult {
  path: string;
  name: string;
  score?: number;
}

export interface RegistryFileIndexSearchResponse {
  query: string;
  querySessionId?: string;
  queryId?: number;
  status: string;
  indexed: boolean;
  fileCount: number;
  results: RegistryFileIndexSearchResult[];
  error?: string;
}

export interface RegistryGitCommit {
  sha: string;
  author: string;
  email: string;
  time: string;
  title: string;
}

export interface RegistryGitCommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface RegistryGitFileDiff {
  sha: string;
  path: string;
  isBinary: boolean;
  diff: string;
  truncated: boolean;
}

export interface RegistryGitStatusEntry {
  path: string;
  status: string;
}

export interface RegistryGitStatus {
  dirty: boolean;
  worktreeRev: string;
  staged: RegistryGitStatusEntry[];
  unstaged: RegistryGitStatusEntry[];
  untracked: RegistryGitStatusEntry[];
}

export interface RegistryWorkingTreeFileDiff {
  path: string;
  scope: 'staged' | 'unstaged' | 'untracked';
  isBinary: boolean;
  diff: string;
  truncated: boolean;
}

export type RegistryConnectInitPayload = {
  clientName: RegistryClientName;
  clientVersion: string;
  protocolVersion: string;
  role: 'client';
  ts?: number;
  nonce?: string;
};
