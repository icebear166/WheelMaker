export type UsageProviderId = 'codex' | 'flicker' | 'kimi' | 'zai' | 'deepseek' | 'qwen';
export type UsageScanStatus = 'idle' | 'scanning' | 'ready' | 'error';
export type UsageProviderStatus = 'ok' | 'unavailable' | 'error';

export interface UsageLimit {
  id: string;
  label: string;
  remainingPercent: number;
  windowKind?: 'fixed' | 'calendarMonth';
  windowDurationMins?: number;
  resetsAt?: string;
}

export interface UsageIdentity {
  kind?: string;
  value?: string;
  label?: string;
}

export interface UsageBalanceItem {
  currency: string;
  total: string;
  granted?: string;
  toppedUp?: string;
}

export interface UsageBalance {
  isAvailable: boolean;
  items: UsageBalanceItem[];
}

export interface UsageResetCredit {
  id?: string;
  expiresAt?: string;
}

export interface UsageResetCredits {
  availableCount: number;
  credits?: UsageResetCredit[];
}

export type UsageQwenCreditsState = 'limited' | 'unlimited' | 'unavailable';

export interface UsageQwenCreditsWindow {
  state: UsageQwenCreditsState;
  total?: string;
  used?: string;
  remaining?: string;
  remainingPercent?: number;
  windowId?: string;
  resetsAt?: string;
}

export interface UsageQwenSubscription {
  instanceCode?: string;
  specCode?: string;
  remainingDays?: number;
  startTime?: string;
  endTime?: string;
  autoRenew?: boolean;
  status?: string;
}

export interface UsageQwenData {
  fiveHour: UsageQwenCreditsWindow;
  week: UsageQwenCreditsWindow;
  subscription?: UsageQwenSubscription;
  quota?: {fiveHour?: string; week?: string};
  updatedAt?: string;
}

export interface UsageAccount {
  localId: string;
  identity: UsageIdentity;
  status: UsageProviderStatus;
  plan?: string;
  message?: string;
  limits: UsageLimit[];
  balance?: UsageBalance;
  resetCredits?: UsageResetCredits;
  qwen?: UsageQwenData;
}

export interface UsageProviderSnapshot {
  id: UsageProviderId;
  name: string;
  status: UsageProviderStatus;
  message?: string;
  authenticated?: boolean;
  accounts: UsageAccount[];
}

export interface UsageHubSnapshot {
  hubId: string;
  generation: number;
  status: UsageScanStatus;
  startedAt?: string;
  updatedAt?: string;
  nextScanAt?: string;
  message?: string;
  providers: UsageProviderSnapshot[];
}

export interface UsageViewAccount extends UsageAccount {
  hubIds: string[];
  sources: UsageAccountSource[];
}

export interface UsageAccountSource {
  hubId: string;
  accountLocalId: string;
  updatedAt?: string;
}

export interface UsageProviderView {
  id: UsageProviderId;
  name: string;
  status: UsageProviderStatus;
  message?: string;
  authenticated?: boolean;
  accountCount: number;
  remainingPercent?: number;
  accounts: UsageViewAccount[];
  hubId?: string;
  hubs?: Array<{hubId: string; status: UsageProviderStatus; message?: string}>;
}

export interface UsageViewSnapshot {
  refreshing: boolean;
  updatedAt?: string;
  providers: UsageProviderView[];
}

export type UsageTone = 'normal' | 'warning' | 'danger';

export function tightnessTone(remainingPercent: number): UsageTone {
  if (remainingPercent < 10) return 'danger';
  if (remainingPercent <= 30) return 'warning';
  return 'normal';
}

export function formatResetCountdown(resetsAt?: string, now = Date.now()): string | null {
  if (!resetsAt) return null;
  const reset = Date.parse(resetsAt);
  if (!Number.isFinite(reset)) return null;
  const minutes = Math.max(0, Math.ceil((reset - now) / 60_000));
  if (minutes <= 0) return 'soon';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatUpdatedAgo(updatedAt?: string, now = Date.now()): string {
  if (!updatedAt) return '';
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated)) return '';
  const seconds = Math.max(0, Math.floor((now - updated) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function formatResetUTC(resetsAt?: string): string {
  if (!resetsAt || !Number.isFinite(Date.parse(resetsAt))) return '';
  return resetsAt.replace('T', ' ').replace(/\.000Z$/, 'Z').replace(/Z$/, ' UTC');
}

export function formatResetLocalSecond(resetsAt?: string): string {
  if (!resetsAt || !Number.isFinite(Date.parse(resetsAt))) return '';
  const date = new Date(resetsAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
