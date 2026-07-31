# DeepSeek Platform Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DeepSeek platform usage dialog to Monitor that lazily fetches official monthly/today spend, balance, and a daily token chart (total, cache hit rate, spend), with login handled through an embedded official page on Desktop/Android and manual token paste in browsers.

**Architecture:** The Hub stores a DeepSeek platform session token in `hub-config.json` as a secret, exposes a new read-only `deepseek.usage.get` Registry method routed through the existing Hub-state path, and serves per-month data from a TTL cache backed by the platform's private `get_user_summary` / `usage/amount` / `usage/cost` APIs. The Web UI opens a dialog that calls the method on demand; Desktop (WebView2) and Android (WebView Dialog) provide a native login flow that opens the official page and returns the token, while browsers fall back to manual paste. tokenStats stays unchanged.

**Tech Stack:** Go, hubconfig versioned JSON, Registry WebSocket protocol, React 19, TypeScript, ECharts 6, WebView2 (Go COM bindings), Android Kotlin WebView, Jest, Go tests.

---

### Task 7: Add the DeepSeek usage dialog, lazy chart, and native login helper

**Files:**
- Modify: `app/web/src/platform/native/nativeRuntime.ts`
- Modify: `app/web/src/platform/android/androidNativeMessageBridge.ts`
- Create: `app/web/src/usage/deepSeekLogin.ts`
- Create: `app/web/src/usage/DeepSeekUsageDialog.tsx`
- Create: `app/web/src/usage/DeepSeekUsageChart.tsx`
- Modify: `app/web/src/styles/usage.css`
- Test: `app/__tests__/web-deepseek-usage-dialog.test.tsx`

- [ ] **Step 1: Write the failing dialog state and accessibility tests**

Create `app/__tests__/web-deepseek-usage-dialog.test.tsx`:

```tsx
import React from 'react';
import {act, create} from 'react-test-renderer';

import {DeepSeekUsageDialog, type DeepSeekUsageDialogState} from '../web/src/usage/DeepSeekUsageDialog';

jest.mock('../web/src/usage/DeepSeekUsageChart', () => ({
  __esModule: true,
  default: () => null,
}));

function renderedText(root: ReturnType<typeof create>): string {
  const walk = (node: {children?: unknown}): string[] => {
    const parts: string[] = [];
    if (typeof node === 'string' || typeof node === 'number') parts.push(String(node));
    if (node && typeof node === 'object' && 'children' in node && Array.isArray(node.children)) {
      for (const child of node.children) parts.push(...walk(child as {children?: unknown}));
    }
    return parts;
  };
  return walk(root.toJSON() as unknown as {children?: unknown}).join(' ');
}

test('ready state renders summary and month label', () => {
  const state: DeepSeekUsageDialogState = {
    status: 'ready',
    view: {
      status: 'ok',
      month: {year: 2026, month: 8},
      balance: [{currency: 'CNY', total: '3.24'}],
      days: [{
        date: '2026-08-01',
        request: 3,
        outputTokens: 120,
        hitTokens: 300,
        missTokens: 100,
        totalTokens: 520,
        cacheHitRate: 0.75,
        cost: 0.02,
      }],
      costs: [{currency: 'CNY', monthlyCost: 8.8, todayCost: 0.02, daily: [{date: '2026-08-01', amount: 0.02}]}],
      monthlyCost: 8.8,
      todayCost: 0.02,
      currency: 'CNY',
    },
  };
  const view = create(
    <DeepSeekUsageDialog
      state={state}
      onClose={jest.fn()}
      onRetry={jest.fn()}
      onMonthChange={jest.fn()}
      onSaveToken={jest.fn()}
      onClearToken={jest.fn()}
    />,
  );
  const dialog = view.root.findByProps({'data-deepseek-usage-dialog': true});
  expect(dialog.props.role).toBe('dialog');
  expect(dialog.props['aria-modal']).toBe(true);
  expect(renderedText(view)).toContain('2026-08');
  expect(renderedText(view)).toContain('3.24');
});

test('notConnected state offers login and paste form', () => {
  const onSaveToken = jest.fn().mockResolvedValue(undefined);
  const view = create(
    <DeepSeekUsageDialog
      state={{status: 'notConnected', month: {year: 2026, month: 8}}}
      onClose={jest.fn()}
      onRetry={jest.fn()}
      onMonthChange={jest.fn()}
      onSaveToken={onSaveToken}
      onClearToken={jest.fn()}
    />,
  );
  expect(renderedText(view)).toContain('Login DeepSeek');
});

test('expired state keeps stale data and offers re-login', () => {
  const view = create(
    <DeepSeekUsageDialog
      state={{
        status: 'expired',
        month: {year: 2026, month: 8},
        view: {
          status: 'expired',
          month: {year: 2026, month: 8},
          balance: [{currency: 'CNY', total: '3.24'}],
          days: [],
          costs: [],
          monthlyCost: 8.8,
          todayCost: 0,
          currency: 'CNY',
        },
      }}
      onClose={jest.fn()}
      onRetry={jest.fn()}
      onMonthChange={jest.fn()}
      onSaveToken={jest.fn()}
      onClearToken={jest.fn()}
    />,
  );
  expect(renderedText(view)).toContain('Session expired');
  expect(renderedText(view)).toContain('8.8');
});
```

- [ ] **Step 2: Run the dialog tests and verify RED**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-deepseek-usage-dialog.test.tsx
```

Expected: FAIL because the dialog and chart modules do not exist.

- [ ] **Step 3: Add the native login capability to the bridge type**

In `app/web/src/platform/native/nativeRuntime.ts`, extend `NativeRuntimeBridge`:

```ts
  deepSeekLogin?: () => Promise<string>;
```

In `app/web/src/platform/android/androidNativeMessageBridge.ts`, add `deepSeekLogin` to the RPC facade and implement it as `call('deepseek.login', {})` following the existing `clearPortRelaySiteData` call pattern; then in `nativeRuntime.ts`'s `wrapAndroidRuntime`, map:

```ts
    deepSeekLogin: async () => {
      const raw = await native.deepSeekLogin();
      const parsed = JSON.parse(raw) as {token?: unknown};
      if (typeof parsed.token !== 'string' || parsed.token === '') {
        throw new Error('DeepSeek login returned no token');
      }
      return parsed.token;
    },
```

Create `app/web/src/usage/deepSeekLogin.ts`:

```ts
import {getNativeRuntimeBridge} from '../platform/native/nativeRuntime';

export function nativeDeepSeekLoginAvailable(): boolean {
  return typeof getNativeRuntimeBridge()?.deepSeekLogin === 'function';
}

export function requestNativeDeepSeekLogin(): Promise<string> {
  const bridge = getNativeRuntimeBridge();
  if (typeof bridge?.deepSeekLogin !== 'function') {
    return Promise.reject(new Error('Native DeepSeek login is unavailable'));
  }
  return bridge.deepSeekLogin();
}
```

- [ ] **Step 4: Implement the lazy chart boundary**

Create `app/web/src/usage/DeepSeekUsageChart.tsx`:

```tsx
import React from 'react';
import * as echarts from 'echarts/core';
import {BarChart, LineChart} from 'echarts/charts';
import {GridComponent, LegendComponent, TooltipComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';

import type {DeepSeekUsageView} from './deepSeekUsage';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export default function DeepSeekUsageChart({view}: {view: DeepSeekUsageView}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const chartRef = React.useRef<echarts.ECharts | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container, undefined, {renderer: 'canvas'});
    chartRef.current = chart;
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => chart.resize());
    resizeObserver?.observe(container);
    return () => {
      resizeObserver?.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;
    const styles = getComputedStyle(container);
    const accent = cssToken(styles, '--accent-primary', '#2784c7');
    const textPrimary = cssToken(styles, '--text-primary', '#dedede');
    const textSecondary = cssToken(styles, '--text-secondary', '#a3a3a3');
    const border = cssToken(styles, '--border-subtle', '#363636');
    const dates = view.days.map(day => day.date);
    chart.setOption({
      animation: false,
      legend: {
        textStyle: {color: textSecondary, fontSize: 10},
        top: 0,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: cssToken(styles, '--surface-overlay', '#2e2e2e'),
        borderColor: border,
        textStyle: {color: textPrimary, fontSize: 11},
        formatter: (params: unknown) => formatTooltip(params, view),
      },
      grid: {left: 46, right: 46, top: 28, bottom: 28},
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: {color: textSecondary, fontSize: 10},
        axisLine: {lineStyle: {color: border}},
        axisTick: {show: false},
      },
      yAxis: [
        {
          type: 'value',
          name: 'Tokens',
          axisLabel: {color: textSecondary, fontSize: 10},
          axisLine: {show: false},
          axisTick: {show: false},
          splitLine: {lineStyle: {color: withAlpha(border, 0.68)}},
        },
        {
          type: 'value',
          min: 0,
          max: 100,
          name: 'Hit %',
          axisLabel: {color: textSecondary, fontSize: 10, formatter: '{value}%'},
          axisLine: {show: false},
          axisTick: {show: false},
          splitLine: {show: false},
        },
      ],
      series: [
        {
          name: 'Output',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 14,
          data: view.days.map(day => day.outputTokens),
          itemStyle: {color: accent},
          emphasis: {disabled: true},
        },
        {
          name: 'Cache miss',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 14,
          data: view.days.map(day => day.missTokens),
          itemStyle: {color: '#8ab4c8'},
          emphasis: {disabled: true},
        },
        {
          name: 'Cache hit',
          type: 'bar',
          stack: 'tokens',
          barMaxWidth: 14,
          data: view.days.map(day => day.hitTokens),
          itemStyle: {color: '#a0d6a0'},
          emphasis: {disabled: true},
        },
        {
          name: 'Hit rate',
          type: 'line',
          yAxisIndex: 1,
          data: view.days.map(day => Number((day.cacheHitRate * 100).toFixed(1))),
          showSymbol: false,
          smooth: 0.2,
          lineStyle: {color: '#e8b84b', width: 2},
          itemStyle: {color: '#e8b84b'},
          emphasis: {disabled: true},
        },
      ],
    }, {notMerge: true});
  }, [view]);

  return (
    <div
      ref={containerRef}
      className="deepseek-usage-chart"
      role="img"
      aria-label="Daily token usage, cache hit rate, and spend chart"
    />
  );
}

function cssToken(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback;
}

function withAlpha(color: string, alpha: number): string {
  const hex = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (hex) {
    return `rgb(${parseInt(hex[1], 16)} ${parseInt(hex[2], 16)} ${parseInt(hex[3], 16)} / ${alpha})`;
  }
  return color;
}

function formatTooltip(params: unknown, view: DeepSeekUsageView): string {
  const items = Array.isArray(params) ? params : [];
  const first = items[0] as {name?: unknown} | undefined;
  const date = String(first?.name ?? '');
  const day = view.days.find(entry => entry.date === date);
  if (!day) return '';
  const hitPercent = Math.round(day.cacheHitRate * 1000) / 10;
  const rows = [
    `<strong>${date}</strong>`,
    `Total: ${day.totalTokens.toLocaleString()} tokens`,
    `Hit rate: ${hitPercent}%`,
    `Spend: ${view.currency} ${day.cost.toFixed(4)}`,
    `Output: ${day.outputTokens.toLocaleString()}`,
    `Cache hit: ${day.hitTokens.toLocaleString()}`,
    `Cache miss: ${day.missTokens.toLocaleString()}`,
  ];
  return rows.join('<br/>');
}
```

- [ ] **Step 5: Implement the dialog**

Create `app/web/src/usage/DeepSeekUsageDialog.tsx`:

```tsx
import React from 'react';

import {Icon} from '../common/Icon';
import {nativeDeepSeekLoginAvailable, requestNativeDeepSeekLogin} from './deepSeekLogin';
import type {DeepSeekUsageView} from './deepSeekUsage';

const LazyDeepSeekUsageChart = React.lazy(() => import(
  /* webpackChunkName: "deepseek-usage-chart" */
  './DeepSeekUsageChart'
));

export type DeepSeekUsageDialogState =
  | {status: 'loading'; month: {year: number; month: number}}
  | {status: 'error'; message: string; month: {year: number; month: number}}
  | {status: 'notConnected'; month: {year: number; month: number}}
  | {status: 'expired'; month: {year: number; month: number}; view?: DeepSeekUsageView}
  | {status: 'ready'; view: DeepSeekUsageView};

interface DeepSeekUsageDialogProps {
  state: DeepSeekUsageDialogState;
  triggerElement?: HTMLElement | null;
  onClose: () => void;
  onRetry: () => void;
  onMonthChange: (year: number, month: number) => void;
  onSaveToken: (token: string) => Promise<void>;
  onClearToken: () => Promise<void>;
}

export function DeepSeekUsageDialog({
  state,
  triggerElement,
  onClose,
  onRetry,
  onMonthChange,
  onSaveToken,
  onClearToken,
}: DeepSeekUsageDialogProps) {
  const closeButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const closeRef = React.useRef(onClose);
  const triggerRef = React.useRef(triggerElement);
  closeRef.current = onClose;

  React.useEffect(() => {
    closeButtonRef.current?.focus();
    const eventTarget = typeof document === 'undefined' ? null : document;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    };
    eventTarget?.addEventListener('keydown', handleKeyDown);
    return () => {
      eventTarget?.removeEventListener('keydown', handleKeyDown);
      triggerRef.current?.focus();
    };
  }, []);

  const month = state.status === 'ready' ? state.view.month : state.month;
  const view = state.status === 'ready' || state.status === 'expired' ? state.view : undefined;

  return (
    <div
      className="usage-history-overlay"
      data-deepseek-usage-overlay={true}
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="deepseek-usage-dialog"
        role="dialog"
        aria-modal={true}
        aria-labelledby="deepseek-usage-dialog-title"
        data-deepseek-usage-dialog={true}
      >
        <header className="usage-history-header">
          <div className="usage-history-title">
            <span className="usage-history-title-icon">
              <Icon name="activity" size={16} />
            </span>
            <div className="usage-history-heading">
              <h2 id="deepseek-usage-dialog-title">
                <span>DeepSeek</span>
                <span className="usage-history-window">Platform usage</span>
              </h2>
              <p>Monthly and daily token usage · data lags about 5 minutes</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="usage-history-close"
            aria-label="Close DeepSeek usage"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="usage-history-body deepseek-usage-body">
          <div className="deepseek-usage-toolbar">
            <MonthSwitcher month={month} onMonthChange={onMonthChange} />
            <button type="button" className="chat-function-action" aria-label="Refresh DeepSeek usage" onClick={onRetry}>
              <Icon name="refreshCw" />
            </button>
          </div>
          {state.status === 'loading' ? (
            <div className="usage-history-loading" aria-live="polite">
              <strong>Loading DeepSeek usage…</strong>
            </div>
          ) : null}
          {state.status === 'error' ? (
            <div className="usage-history-error" role="alert">
              <strong>Usage unavailable</strong>
              <p>{state.message}</p>
              <button type="button" onClick={onRetry}>Retry</button>
            </div>
          ) : null}
          {state.status === 'notConnected' ? <DeepSeekLoginPanel onSaveToken={onSaveToken} /> : null}
          {state.status === 'expired' ? (
            <>
              <div className="deepseek-usage-expired" role="alert">
                <strong>Session expired</strong>
                <span>Re-login to refresh. Last successful data is kept below.</span>
              </div>
              {view ? <DeepSeekUsageReady view={view} /> : <DeepSeekLoginPanel onSaveToken={onSaveToken} />}
            </>
          ) : null}
          {state.status === 'ready' && view ? <DeepSeekUsageReady view={view} /> : null}
        </div>
      </section>
    </div>
  );
}

function MonthSwitcher({
  month,
  onMonthChange,
}: {
  month: {year: number; month: number};
  onMonthChange: (year: number, month: number) => void;
}) {
  const previous = month.month === 1 ? {year: month.year - 1, month: 12} : {year: month.year, month: month.month - 1};
  return (
    <div className="deepseek-usage-months">
      <button
        type="button"
        className="chat-function-action"
        aria-label="Previous month"
        onClick={() => onMonthChange(previous.year, previous.month)}
      >
        <Icon name="arrowLeft" />
      </button>
      <span className="deepseek-usage-month-label">
        {String(month.year)}-{String(month.month).padStart(2, '0')}
      </span>
      <button
        type="button"
        className="chat-function-action"
        aria-label="Current month"
        onClick={() => onMonthChange(new Date().getFullYear(), new Date().getMonth() + 1)}
      >
        <Icon name="chevronRight" />
      </button>
    </div>
  );
}

function DeepSeekLoginPanel({onSaveToken}: {onSaveToken: (token: string) => Promise<void>}) {
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const nativeAvailable = nativeDeepSeekLoginAvailable();

  const save = async (value: string) => {
    setBusy(true);
    setError('');
    try {
      await onSaveToken(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to save token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="deepseek-usage-login" data-deepseek-usage-login={true}>
      <strong>Login DeepSeek</strong>
      <p>
        Sign in to platform.deepseek.com to fetch official spend and token usage.
      </p>
      {nativeAvailable ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void requestNativeDeepSeekLogin().then(save);
          }}
        >
          Login in window
        </button>
      ) : null}
      <label>
        <span>Or paste the platform session token</span>
        <input
          type="password"
          value={token}
          disabled={busy}
          placeholder="Bearer token from platform.deepseek.com"
          onChange={event => setToken(event.target.value)}
        />
      </label>
      <button type="button" disabled={busy || token.trim() === ''} onClick={() => void save(token.trim())}>
        Save token
      </button>
      {error ? <p className="deepseek-usage-login-error" role="alert">{error}</p> : null}
    </div>
  );
}

function DeepSeekUsageReady({view}: {view: DeepSeekUsageView}) {
  return (
    <>
      <div className="deepseek-usage-summary">
        <span><strong>{view.currency} {view.monthlyCost.toFixed(2)}</strong><em>This month</em></span>
        <span><strong>{view.currency} {view.todayCost.toFixed(2)}</strong><em>Today</em></span>
        <span>
          <strong>
            {(view.balance ?? []).map(item => `${item.currency} ${item.total}`).join(' · ') || '—'}
          </strong>
          <em>Balance</em>
        </span>
      </div>
      <React.Suspense fallback={(
        <div className="usage-history-chart-loading" aria-live="polite">Loading chart…</div>
      )}>
        <LazyDeepSeekUsageChart view={view} />
      </React.Suspense>
    </>
  );
}
```

`arrowLeft` and `chevronRight` both exist in `app/web/src/common/Icon.tsx`; keep the tests unchanged.

- [ ] **Step 6: Add dialog styles**

Append to `app/web/src/styles/usage.css`:

```css
.deepseek-usage-dialog {
  width: min(720px, calc(100vw - 32px));
}
.deepseek-usage-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.deepseek-usage-months {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.deepseek-usage-month-label {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}
.deepseek-usage-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.deepseek-usage-summary span {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--surface-raised);
}
.deepseek-usage-summary strong {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.deepseek-usage-summary em {
  font-style: normal;
  font-size: 10px;
  color: var(--text-tertiary);
}
.deepseek-usage-login {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
}
.deepseek-usage-login input {
  width: 100%;
}
.deepseek-usage-login-error {
  color: var(--state-danger);
  font-size: 11px;
}
.deepseek-usage-expired {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  margin-bottom: 10px;
  border: 1px solid var(--state-warning);
  border-radius: 8px;
  color: var(--state-warning);
  font-size: 11px;
}
.deepseek-usage-chart {
  height: 280px;
  width: 100%;
}
```

- [ ] **Step 7: Run the dialog tests and TypeScript**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-deepseek-usage-dialog.test.tsx
npm --prefix app run tsc:web
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add app/web/src/platform/native/nativeRuntime.ts app/web/src/usage/deepSeekLogin.ts app/web/src/usage/DeepSeekUsageDialog.tsx app/web/src/usage/DeepSeekUsageChart.tsx app/web/src/styles/usage.css app/__tests__/web-deepseek-usage-dialog.test.tsx
git commit -m "feat(app): add deepseek platform usage dialog"
```

---

### Task 9: Add the Desktop embedded login window

**Files:**
- Modify: `server/cmd/wheelmaker-desktop/webview_policy.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_bridge.go`
- Modify: `server/cmd/wheelmaker-desktop/desktop_runtime.go`
- Create: `server/cmd/wheelmaker-desktop/deepseek_login.go`
- Create: `server/cmd/wheelmaker-desktop/deepseek_login_windows.go`
- Modify: `server/cmd/wheelmaker-desktop/webview_windows.go`
- Test: `server/cmd/wheelmaker-desktop/webview_policy_test.go`
- Test: `server/cmd/wheelmaker-desktop/deepseek_login_test.go`

- [ ] **Step 1: Write the failing policy and session tests**

Add to `server/cmd/wheelmaker-desktop/webview_policy_test.go`:

```go
func TestTrustedPageAllowsDeepSeekLoginBridge(t *testing.T) {
	policy, err := newDesktopWebViewPolicy("https://release.wheelmaker.top/")
	if err != nil {
		t.Fatal(err)
	}
	if !policy.AllowsBridge(desktopTrustedRemotePage, "https://release.wheelmaker.top/", true, desktopBridgeDeepSeekLogin) {
		t.Fatal("deepseek login bridge must be allowed on trusted pages")
	}
	if policy.AllowsBridge(desktopBootstrapPage, desktopBootstrapDocumentURL(), true, desktopBridgeDeepSeekLogin) {
		t.Fatal("deepseek login bridge must not be allowed on the bootstrap page")
	}
}
```

Create `server/cmd/wheelmaker-desktop/deepseek_login_test.go`:

```go
package main

import "testing"

func TestExtractDeepSeekToken(t *testing.T) {
	cases := map[string]string{
		`"abc123.xyz"`:                       "abc123.xyz",
		`""`:                                 "",
		`"Bearer abc123.xyz"`:                "abc123.xyz",
		"abc123.xyz":                         "abc123.xyz",
		`"short"`:                            "",
		`"token with spaces and long xxxx"`:  "",
	}
	for input, want := range cases {
		if got := extractDeepSeekToken(input); got != want {
			t.Fatalf("extractDeepSeekToken(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestDeepSeekLoginSessionPollsUntilToken(t *testing.T) {
	reads := 0
	read := func() (string, bool) {
		reads++
		if reads < 2 {
			return "", true
		}
		return "session-token", true
	}
	session := newDeepSeekLoginSession(read)
	for i := 0; i < 5; i++ {
		if token, done := session.Poll(); done {
			if token != "session-token" {
				t.Fatalf("token=%q", token)
			}
			return
		}
	}
	t.Fatal("session did not resolve")
}
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
go -C server test ./cmd/wheelmaker-desktop -run 'Test(TrustedPageAllowsDeepSeekLoginBridge|ExtractDeepSeekToken|DeepSeekLoginSessionPollsUntilToken)' -count=1
```

Expected: FAIL because the action, constants, and functions do not exist.

- [ ] **Step 3: Add the bridge action and binding**

In `webview_policy.go`, add to `desktopBridgeAction`:

```go
	desktopBridgeDeepSeekLogin
```

Add `desktopBridgeDeepSeekLogin` to the allowed list in `AllowsBridge` for trusted pages (in the `desktopTrustedRemotePage` switch, next to `desktopBridgeRequestUpdate`).

In `desktop_bridge.go`, add:

```go
	desktopDeepSeekLoginBinding = "__wheelMakerDesktopDeepSeekLogin"
```

In `desktop_runtime.go`, inside the `location.protocol === 'https:'` branch of `window.WheelMakerDesktop`, add:

```ts
		deepSeekLogin: invoke('` + desktopDeepSeekLoginBinding + `'),
```

In `webview_windows.go`'s `bindings` list, add:

```go
		{desktopDeepSeekLoginBinding, func() (string, error) {
			if err := authorize(desktopBridgeDeepSeekLogin); err != nil {
				return "", err
			}
			return launchDeepSeekLoginWindow()
		}},
```

- [ ] **Step 4: Implement the pure session helpers**

Create `server/cmd/wheelmaker-desktop/deepseek_login.go`:

```go
package main

import (
	"strconv"
	"strings"
	"time"
)

const (
	deepSeekLoginURL          = "https://platform.deepseek.com"
	deepSeekLoginTimeout      = 10 * time.Minute
	deepSeekLoginPollInterval = time.Second
	deepSeekLoginMaxTokenLen  = 4096
)

// deepSeekLoginScript reads the first token-like value from localStorage.
// ExecuteScript returns the evaluated expression JSON-encoded, so an empty
// result arrives as `""`.
const deepSeekLoginScript = `(() => {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) || '';
    if (!/token/i.test(key)) continue;
    const raw = String(localStorage.getItem(key) || '');
    const match = raw.match(/[A-Za-z0-9._~+/=-]{20,}/);
    if (match) return match[0];
  }
  return '';
})()`

// extractDeepSeekToken normalizes the JSON-encoded ExecuteScript result.
func extractDeepSeekToken(result string) string {
	value := strings.TrimSpace(result)
	if unquoted, err := strconv.Unquote(value); err == nil {
		value = unquoted
	}
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "Bearer ")
	if len(value) < 20 || len(value) > deepSeekLoginMaxTokenLen {
		return ""
	}
	if strings.ContainsAny(value, " \t\r\n") {
		return ""
	}
	return value
}

type deepSeekLoginSession struct {
	readToken func() (string, bool)
	started   time.Time
}

func newDeepSeekLoginSession(readToken func() (string, bool)) *deepSeekLoginSession {
	return &deepSeekLoginSession{readToken: readToken, started: time.Now()}
}

// Poll returns (token, true) when the session token is found or the timeout
// elapses; otherwise ("", false).
func (s *deepSeekLoginSession) Poll() (string, bool) {
	if time.Since(s.started) > deepSeekLoginTimeout {
		return "", true
	}
	if s.readToken == nil {
		return "", true
	}
	return s.readToken()
}
```

- [ ] **Step 5: Implement the Windows login window**

Create `server/cmd/wheelmaker-desktop/deepseek_login_windows.go` with build tag `//go:build windows`:

```go
//go:build windows

package main

import (
	"errors"
	"time"

	webview2 "github.com/jchv/go-webview2"
)

// launchDeepSeekLoginWindow opens a modal WebView2 window on the official
// DeepSeek platform page, polls localStorage for the session token, and
// returns it. Closing the window or the 10-minute timeout returns an error.
func launchDeepSeekLoginWindow() (string, error) {
	window := webview2.NewWithOptions(webview2.WebViewOptions{
		WindowOptions: webview2.WindowOptions{
			Title:  "DeepSeek Login",
			Width:  480,
			Height: 720,
			IconId: desktopResourceIconID,
			Center: true,
		},
	})
	if window == nil {
		return "", errWebView2Unavailable
	}
	defer window.Destroy()
	loginSecurity, err := newDesktopWebViewSecurityState(deepSeekLoginURL, desktopTrustedRemotePage)
	if err != nil {
		return "", err
	}
	loginRuntime := &desktopRuntime{security: loginSecurity}
	if _, err := installDesktopWebViewPolicyAdapter(window, loginRuntime); err != nil {
		return "", err
	}

	tokenCh := make(chan string, 1)
	errCh := make(chan error, 1)
	session := newDeepSeekLoginSession(func() (string, bool) {
		raw, err := window.Eval(deepSeekLoginScript)
		if err != nil {
			return "", true
		}
		return extractDeepSeekToken(stringifyEvalResult(raw)), true
	})
	go func() {
		for {
			if token, done := session.Poll(); done {
				if token != "" {
					tokenCh <- token
				} else {
					errCh <- errors.New("deepseek login timed out or was cancelled")
				}
				return
			}
			time.Sleep(deepSeekLoginPollInterval)
		}
	}()

	window.Navigate(deepSeekLoginURL)
	window.Run()
	select {
	case token := <-tokenCh:
		return token, nil
	case err := <-errCh:
		return "", err
	default:
		return "", errors.New("deepseek login window closed")
	}
}
```

Add a small `stringifyEvalResult` helper in the same file that converts the library's `Eval` return value (`string` or `[]byte`) to `string`; the exact conversion depends on the `go-webview2` version already used in this package (check how `Eval` results are handled elsewhere, if at all). If the binding library blocks `Eval` before the window loop starts, move `window.Navigate` before the poll goroutine and start polling only after `window.Run()` returns false; keep the same pure session helpers.

The `installDesktopWebViewPolicyAdapter` call is what enforces the acceptance criterion that the login window only allows `platform.deepseek.com`; the adapter reuses the existing policy machinery and blocks other hosts and certificate errors.

- [ ] **Step 6: Run the tests and build**

Run:

```powershell
gofmt -w server/cmd/wheelmaker-desktop/webview_policy.go server/cmd/wheelmaker-desktop/desktop_bridge.go server/cmd/wheelmaker-desktop/desktop_runtime.go server/cmd/wheelmaker-desktop/webview_windows.go server/cmd/wheelmaker-desktop/deepseek_login.go server/cmd/wheelmaker-desktop/deepseek_login_windows.go server/cmd/wheelmaker-desktop/webview_policy_test.go server/cmd/wheelmaker-desktop/deepseek_login_test.go
go -C server test ./cmd/wheelmaker-desktop -count=1
go -C server build ./cmd/wheelmaker-desktop
```

Expected: PASS and the desktop binary builds.

- [ ] **Step 7: Commit**

```powershell
git add server/cmd/wheelmaker-desktop
git commit -m "feat(desktop): embedded deepseek platform login"
```

---

### Task 10: Add the Android embedded login dialog

**Files:**
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt`
- Modify: `mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt`
- Create: `mobile/android/app/src/main/java/com/wheelmaker/android/DeepSeekLoginDialog.kt`
- Test: `mobile/android/app/src/test/java/com/wheelmaker/android/DeepSeekLoginProtocolTest.kt`

- [ ] **Step 1: Write the failing protocol test**

Create `mobile/android/app/src/test/java/com/wheelmaker/android/DeepSeekLoginProtocolTest.kt`:

```kotlin
package com.wheelmaker.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepSeekLoginProtocolTest {
    @Test
    fun `extracts token from script result`() {
        assertEquals("abc123.xyz", extractDeepSeekToken("\"abc123.xyz\""))
        assertEquals("abc123.xyz", extractDeepSeekToken("Bearer abc123.xyz"))
        assertNull(extractDeepSeekToken("\"\""))
        assertNull(extractDeepSeekToken("short"))
    }
}
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
Set-Location mobile/android; gradle testDebugUnitTest --tests "com.wheelmaker.android.DeepSeekLoginProtocolTest"
```

Expected: FAIL because `extractDeepSeekToken` is undefined.

This repo does not commit a Gradle wrapper; use the system `gradle` command from `mobile/android` (Gradle 9.5.1 is already used by this project's local build state).

- [ ] **Step 3: Implement the token extraction and login dialog**

Create `mobile/android/app/src/main/java/com/wheelmaker/android/DeepSeekLoginDialog.kt`:

```kotlin
package com.wheelmaker.android

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.webkit.WebView
import android.webkit.WebViewClient
import java.util.concurrent.atomic.AtomicBoolean

internal const val DEEP_SEEK_LOGIN_URL = "https://platform.deepseek.com"
internal const val DEEP_SEEK_TOKEN_SCRIPT = """
  (() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || '';
      if (!/token/i.test(key)) continue;
      const raw = String(localStorage.getItem(key) || '');
      const match = raw.match(/[A-Za-z0-9._~+/=-]{20,}/);
      if (match) return match[0];
    }
    return '';
  })()
"""

internal fun extractDeepSeekToken(result: String): String? {
    var value = result.trim().trim('"')
    if (value.startsWith("Bearer ")) value = value.removePrefix("Bearer ")
    if (value.length < 20 || value.length > 4096) return null
    if (value.any { it.isWhitespace() }) return null
    return value
}

class DeepSeekLoginDialog(
    private val activity: Activity,
    private val onResult: (token: String?) -> Unit,
) {
    private val finished = AtomicBoolean(false)

    @SuppressLint("SetJavaScriptEnabled")
    fun show() {
        val webView = WebView(activity)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return url?.startsWith(DEEP_SEEK_LOGIN_URL) != true
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                view?.postDelayed({ pollToken(view) }, 1000)
            }
        }
        val dialog = AlertDialog.Builder(activity)
            .setTitle("DeepSeek Login")
            .setView(webView)
            .setNegativeButton("Cancel") { _, _ -> finish(null) }
            .setOnCancelListener { finish(null) }
            .create()
        webView.loadUrl(DEEP_SEEK_LOGIN_URL)
        dialog.show()
    }

    private fun pollToken(view: WebView) {
        if (finished.get()) return
        view.evaluateJavascript(DEEP_SEEK_TOKEN_SCRIPT) { result ->
            val token = extractDeepSeekToken(result ?: "")
            if (token != null) {
                finish(token)
            } else {
                view.postDelayed({ pollToken(view) }, 1000)
            }
        }
    }

    private fun finish(token: String?) {
        if (!finished.compareAndSet(false, true)) return
        onResult(token)
    }
}
```

- [ ] **Step 4: Wire the bridge RPC**

In `WheelMakerBridge.kt`, add a case in the RPC dispatch next to `diagnostics.setLogLevel`:

```kotlin
        "deepseek.login" -> deepSeekLogin { token ->
            respond(JSONObject().put("token", token ?: JSONObject.NULL))
        }
```

Add the handler method that shows the dialog on the main thread (use the existing `mainHandler`/`runOnUiThread` pattern already used by this bridge):

```kotlin
    private fun deepSeekLogin(onToken: (String?) -> Unit) {
        val host = host ?: return onToken(null)
        host.runOnUiThread {
            DeepSeekLoginDialog(host) { token -> onToken(token) }.show()
        }
    }
```

Add `deepSeekLogin` to the native bridge interface that `WheelMakerBridge.kt` already defines for `MainActivity` (the interface field named `host`), with signature `fun runOnUiThread(action: Runnable)` and `fun <T> runOnUiThread(action: () -> T): T` variants matching the file's existing helpers.

- [ ] **Step 5: Run the Android unit tests**

Run:

```powershell
Set-Location mobile/android; gradle testDebugUnitTest
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt mobile/android/app/src/main/java/com/wheelmaker/android/MainActivity.kt mobile/android/app/src/main/java/com/wheelmaker/android/DeepSeekLoginDialog.kt mobile/android/app/src/test/java/com/wheelmaker/android/DeepSeekLoginProtocolTest.kt
git commit -m "feat(android): embedded deepseek platform login"
```

---

### Task 11: Full regression, build, and delivery

**Files:**
- Modify if implementation differs: `docs/scope/2026-08-01-deepseek-platform-usage/spec-deepseek-platform-usage.md`
- Modify if stable behavior differs: `docs/wiki/features/limits-monitoring.md`
- Update checklist: `docs/scope/2026-08-01-deepseek-platform-usage/plan-deepseek-platform-usage.md`

- [ ] **Step 1: Format Go and run server package tests**

Run:

```powershell
gofmt -w server/internal/hubconfig/store.go server/internal/hubconfig/store_test.go server/internal/hub/usage/deepseek_platform.go server/internal/hub/usage/deepseek_platform_test.go server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/hub/reporter.go server/internal/hub/hub_test.go server/internal/registry/server_test.go server/cmd/wheelmaker-desktop
go -C server test ./...
```

Expected: PASS.

- [ ] **Step 2: Run all App usage tests and TypeScript**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-hub-state-service.test.ts __tests__/web-deepseek-usage.test.ts __tests__/web-deepseek-usage-dialog.test.tsx __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx
npm --prefix app run tsc:web
```

Expected: PASS.

- [ ] **Step 3: Run the full server and App regression suites**

Run:

```powershell
go -C server test ./...
npm --prefix app test -- --runInBand
Set-Location mobile/android; gradle testDebugUnitTest
```

Expected: PASS.

- [ ] **Step 4: Build production Web into an isolated target**

Run:

```powershell
$env:WHEELMAKER_WEB_TARGET = Join-Path $env:TEMP 'wheelmaker-deepseek-usage-web'
npm --prefix app run build:web
Get-ChildItem -LiteralPath $env:WHEELMAKER_WEB_TARGET -File | Select-Object Name, Length
```

Expected: PASS; output contains a separately named `deepseek-usage-chart.<hash>.js` async chunk and the main bundle does not inline the ECharts module.

- [ ] **Step 5: Check documentation and working tree**

Run:

```powershell
rg -n -i 'TBD|TODO|implement later' docs/scope/2026-08-01-deepseek-platform-usage docs/wiki/features/limits-monitoring.md
git diff --check
git status --short
```

Expected: no placeholders, no whitespace errors, and only intended feature files changed.

- [ ] **Step 6: Rebase and rerun smoke tests if HEAD changes**

Run:

```powershell
git fetch origin
git rebase origin/main
go -C server test ./internal/hub/usage ./internal/hub ./internal/protocol ./internal/registry ./internal/hubconfig
npm --prefix app test -- --runInBand __tests__/web-deepseek-usage.test.ts __tests__/web-deepseek-usage-dialog.test.tsx __tests__/web-usage-workspace-integration.test.tsx
```

Expected: rebase and tests pass.

- [ ] **Step 7: Mark the plan complete and execute the repository completion gate**

Update every completed plan checkbox to `[x]`, then execute this exact tail:

```powershell
git add -A
git commit -m "docs: record deepseek platform usage delivery"
git push origin feat/deepseek-platform-usage
```

Expected: commit succeeds and the remote feature branch is updated.

### Verification record

- Full server regression: PASS.
- Full App regression: PASS.
- Web TypeScript: PASS.
- Production Web build: PASS with an isolated `deepseek-usage-chart.<hash>.js` async chunk.
- Desktop build and Android unit tests: PASS.

### Task 8: Open the dialog from DeepSeek account rows

**Files:**
- Modify: `app/web/src/usage/UsageFeatureSurface.tsx`
- Modify: `app/web/src/usage/MonitorSurface.tsx` (only if the callback dispatch changes)
- Modify: `app/web/src/usage/MobileUsageDialog.tsx` (only if the callback dispatch changes)
- Modify: `app/web/src/app/WorkspaceApp.tsx`
- Test: `app/__tests__/web-usage-feature-surface.test.tsx`
- Test: `app/__tests__/web-usage-workspace-integration.test.tsx`

- [ ] **Step 1: Write the failing row activation tests**

Add to `app/__tests__/web-usage-feature-surface.test.tsx`:

```ts
test('deepseek balance-only rows open the usage callback', () => {
  const onOpenHistory = jest.fn();
  const view = renderUsageCompactContent(deepSeekSnapshotWithBalanceOnly(), onOpenHistory);
  const row = view!.root.findByProps({'data-usage-account-trigger': 'deepseek:wheelmaker-config'});
  expect(row.props.role).toBe('button');
  act(() => row.props.onClick());
  expect(onOpenHistory).toHaveBeenCalledWith(
    expect.objectContaining({id: 'deepseek'}),
    expect.objectContaining({localId: 'wheelmaker-config'}),
    expect.anything(),
  );
});
```

Reuse the snapshot builders already present in that test file; add a helper `deepSeekSnapshotWithBalanceOnly()` that returns a provider with `id: 'deepseek'`, one ok account with `balance` and no `limits`.

In `app/__tests__/web-usage-workspace-integration.test.tsx`, add a case that opens the DeepSeek row, resolves `getDeepSeekUsage` with a `notConnected` response, and asserts the login panel appears.

In the same integration test, add a second case that types a token into the paste form, submits it, and asserts `updateHubConfig` is called with `{section: 'deepSeekPlatform', field: 'token', action: 'set', value: 'pasted-token'}` followed by a reload of `getDeepSeekUsage`.

- [ ] **Step 2: Run the activation tests and verify RED**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx
```

Expected: FAIL because DeepSeek rows are not clickable and the dialog is not wired.

- [ ] **Step 3: Make DeepSeek balance rows clickable**

In `app/web/src/usage/UsageFeatureSurface.tsx`, change both activation conditions from:

```tsx
if (account.limits.length > 0 && onOpenHistory) {
```

to:

```tsx
if ((account.limits.length > 0 || provider.id === 'deepseek') && onOpenHistory) {
```

There are two places: `AccountRail` (compact) and `ProviderDetails` (detail). Keep `data-usage-account-trigger` keys unchanged.

- [ ] **Step 4: Add the dialog state to WorkspaceApp**

In `app/web/src/app/WorkspaceApp.tsx`:

```tsx
type DeepSeekUsageDialogTarget = {
  provider: UsageProviderView;
  account: UsageViewAccount;
  triggerElement: HTMLElement | null;
};

type DeepSeekUsageDialogView = {
  target: DeepSeekUsageDialogTarget;
  month: {year: number; month: number};
  state: DeepSeekUsageDialogState;
};
```

Add imports for `DeepSeekUsageDialog` and `DeepSeekUsageDialogState`. Near the existing `usageHistoryDialogView` state add:

```tsx
const deepSeekUsageRequestSeqRef = useRef(0);
const [deepSeekUsageDialogView, setDeepSeekUsageDialogView] = useState<DeepSeekUsageDialogView | null>(null);
```

Add the loader, opener, closer, token handlers, and month change next to the existing usage history functions:

```tsx
const loadDeepSeekUsage = useCallback(async (
  target: DeepSeekUsageDialogTarget,
  month: {year: number; month: number},
  force = false,
) => {
  const requestSeq = ++deepSeekUsageRequestSeqRef.current;
  setDeepSeekUsageDialogView({target, month, state: {status: 'loading', month}});
  const source = target.account.sources[0];
  if (!source) {
    setDeepSeekUsageDialogView({
      target,
      month,
      state: {status: 'error', message: 'No online Hub for this account', month},
    });
    return;
  }
  try {
    const result = await service.getDeepSeekUsage(source.hubId, month.year, month.month, force);
    if (deepSeekUsageRequestSeqRef.current !== requestSeq) return;
    const view = normalizeDeepSeekUsage(result);
    if ((view.balance ?? []).length === 0 && target.account.balance?.items?.length) {
      view.balance = target.account.balance.items;
    }
    const state: DeepSeekUsageDialogState = view.status === 'ok'
      ? {status: 'ready', view}
      : view.status === 'expired'
        ? {status: 'expired', month, view}
        : {status: 'notConnected', month};
    setDeepSeekUsageDialogView({target, month, state});
  } catch (err) {
    if (deepSeekUsageRequestSeqRef.current !== requestSeq) return;
    setDeepSeekUsageDialogView({
      target,
      month,
      state: {status: 'error', message: err instanceof Error ? err.message : 'Failed to load DeepSeek usage', month},
    });
  }
}, [service]);

const openDeepSeekUsage = useCallback((
  provider: UsageProviderView,
  account: UsageViewAccount,
  triggerElement: HTMLElement,
) => {
  const month = {year: new Date().getFullYear(), month: new Date().getMonth() + 1};
  void loadDeepSeekUsage({provider, account, triggerElement}, month);
}, [loadDeepSeekUsage]);

const closeDeepSeekUsage = useCallback(() => {
  deepSeekUsageRequestSeqRef.current += 1;
  setDeepSeekUsageDialogView(null);
}, []);

const saveDeepSeekToken = useCallback(async (token: string) => {
  const view = deepSeekUsageDialogView;
  const source = view?.target.account.sources[0];
  if (!view || !source) throw new Error('No active DeepSeek account');
  await service.updateHubConfig(source.hubId, {
    section: 'deepSeekPlatform',
    field: 'token',
    action: 'set',
    value: token,
  });
  await loadDeepSeekUsage(view.target, view.month);
}, [deepSeekUsageDialogView, loadDeepSeekUsage, service]);

const clearDeepSeekToken = useCallback(async () => {
  const view = deepSeekUsageDialogView;
  const source = view?.target.account.sources[0];
  if (!view || !source) return;
  await service.updateHubConfig(source.hubId, {
    section: 'deepSeekPlatform',
    field: 'token',
    action: 'clear',
  });
  await loadDeepSeekUsage(view.target, view.month);
}, [deepSeekUsageDialogView, loadDeepSeekUsage, service]);

const changeDeepSeekMonth = useCallback((year: number, month: number) => {
  const view = deepSeekUsageDialogView;
  if (!view) return;
  void loadDeepSeekUsage(view.target, {year, month});
}, [deepSeekUsageDialogView, loadDeepSeekUsage]);
```

Update both `onOpenHistory` call sites so DeepSeek rows open the new dialog:

```tsx
onOpenHistory={provider => provider.id === 'deepseek'
  ? openDeepSeekUsage
  : openUsageHistory}
```

`UsageOpenHistory` passes `(provider, account, trigger)`; if the prop signature does not include `provider`, change the call sites to use a small wrapper:

```tsx
onOpenHistory={(provider, account, trigger) => {
  if (provider.id === 'deepseek') {
    openDeepSeekUsage(provider, account, trigger);
  } else {
    openUsageHistory(provider, account, trigger);
  }
}}
```

Render the overlay next to `usageHistoryOverlay`:

```tsx
const deepSeekUsageOverlay = deepSeekUsageDialogView ? (
  <DeepSeekUsageDialog
    state={deepSeekUsageDialogView.state}
    triggerElement={deepSeekUsageDialogView.target.triggerElement}
    onClose={closeDeepSeekUsage}
    onRetry={() => void loadDeepSeekUsage(deepSeekUsageDialogView.target, deepSeekUsageDialogView.month, true)}
    onMonthChange={changeDeepSeekMonth}
    onSaveToken={saveDeepSeekToken}
    onClearToken={clearDeepSeekToken}
  />
) : null;
```

- [ ] **Step 5: Run the activation and integration tests**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-usage-feature-surface.test.tsx __tests__/web-usage-workspace-integration.test.tsx __tests__/web-deepseek-usage-dialog.test.tsx
npm --prefix app run tsc:web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add app/web/src/usage/UsageFeatureSurface.tsx app/web/src/usage/MonitorSurface.tsx app/web/src/usage/MobileUsageDialog.tsx app/web/src/app/WorkspaceApp.tsx app/__tests__/web-usage-feature-surface.test.tsx app/__tests__/web-usage-workspace-integration.test.tsx
git commit -m "feat(app): open deepseek usage from monitor rows"
```

---

### Task 3: Register the read-only Registry method

**Files:**
- Modify: `server/internal/protocol/registry_methods.go`
- Modify: `server/internal/protocol/registry_methods_test.go`
- Modify: `server/internal/registry/server_test.go`

- [ ] **Step 1: Write the failing descriptor test**

Add to `server/internal/protocol/registry_methods_test.go`:

```go
func TestDeepSeekUsageGetDescriptor(t *testing.T) {
	got, ok := RegistryMethod(RegistryMethodDeepSeekUsageGet)
	if !ok || got.Route != RegistryRouteHubState || !got.RequiresHubID {
		t.Fatalf("descriptor=%+v ok=%v", got, ok)
	}
}
```

- [ ] **Step 2: Run the descriptor test and verify RED**

Run:

```powershell
go -C server test ./internal/protocol -run TestDeepSeekUsageGetDescriptor -count=1
```

Expected: FAIL because `RegistryMethodDeepSeekUsageGet` is undefined.

- [ ] **Step 3: Register the additive method**

In `server/internal/protocol/registry_methods.go`, add to the method constants:

```go
	RegistryMethodUsageHistoryGet           = "usage.history.get"
	RegistryMethodDeepSeekUsageGet          = "deepseek.usage.get"
```

Add to the descriptors map next to the usage history entry:

```go
	RegistryMethodUsageHistoryGet:                  registryHubStateMethod(RegistryMethodUsageHistoryGet),
	RegistryMethodDeepSeekUsageGet:                 registryHubStateMethod(RegistryMethodDeepSeekUsageGet),
```

Do not edit the protocol version constant or compatibility docs.

- [ ] **Step 4: Run the descriptor test and verify GREEN**

Run:

```powershell
go -C server test ./internal/protocol -run 'Test(DeepSeekUsageGetDescriptor|UsageHistoryGetDescriptor)' -count=1
```

Expected: PASS.

- [ ] **Step 5: Add the Registry forwarding test**

Add to `server/internal/registry/server_test.go`, following the existing `usage.history.get` forwarding test in that file:

```go
func TestServerForwardsDeepSeekUsageGet(t *testing.T) {
	hubResponses := map[string]any{
		rp.RegistryMethodDeepSeekUsageGet: map[string]any{
			"hubId":  "hub-deepseek-usage",
			"status": "ok",
			"month":  map[string]any{"year": 2026, "month": 8},
			"days":   []any{},
			"costs":  []any{},
		},
	}
	// Reuse the existing hub-mock fixture in this file with the deepseek method
	// added; then a client sends {hubId: "hub-deepseek-usage", payload: {year: 2026, month: 8}}.
	// Assert the request reaches the hub mock and the response reaches the client.
	runHubStateForwardingTest(t, hubResponses)
}
```

If the file has no shared `runHubStateForwardingTest` helper, copy the exact structure of the existing `usage.history.get` forwarding test instead and replace the method/payload/assertions.

- [ ] **Step 6: Run the forwarding test and verify GREEN**

Run:

```powershell
go -C server test ./internal/registry -run TestServerForwardsDeepSeekUsageGet -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/internal/protocol/registry_methods.go server/internal/protocol/registry_methods_test.go server/internal/registry/server_test.go
git commit -m "feat(protocol): expose deepseek usage read method"
```

---

### Task 4: Wire the Hub handler and config updates

**Files:**
- Modify: `server/internal/hub/reporter.go`
- Test: `server/internal/hub/hub_test.go`

- [ ] **Step 1: Write the failing handler tests**

Add to `server/internal/hub/hub_test.go`, following the existing `TestReporterRespondsToUsageHistoryGet` pattern (fake registry + `NewReporter` + `Run`):

```go
type deepSeekUsageStub struct {
	result usage.DeepSeekPlatformUsage
	err    error
}

func (s *deepSeekUsageStub) Get(ctx context.Context, year, month int, force bool) (usage.DeepSeekPlatformUsage, error) {
	return s.result, s.err
}

func TestReporterRespondsToDeepSeekUsageGet(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)
	ts := newFakeReporterRegistry(t, "hub-deepseek-usage", testEnvelope{
		RequestID: 201,
		Type:      "request",
		Method:    rp.RegistryMethodDeepSeekUsageGet,
		HubID:     "hub-deepseek-usage",
		Payload:   map[string]any{"year": 2026, "month": 8},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		Server:            strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-deepseek-usage",
		ReconnectInterval: 50 * time.Millisecond,
		StateDir:          t.TempDir(),
	}, nil)
	reporter.deepSeekUsage = &deepSeekUsageStub{result: usage.DeepSeekPlatformUsage{
		Status: usage.DeepSeekPlatformOK,
		Month:  usage.DeepSeekPlatformMonth{Year: 2026, Month: 8},
		Balance: []usage.BalanceItem{{Currency: "CNY", Total: "3.24"}},
		Days: []usage.DeepSeekPlatformDay{{
			Date: "2026-08-01", Request: 3, OutputTokens: 120, HitTokens: 300, MissTokens: 100, TotalTokens: 520,
		}},
		Costs: []usage.DeepSeekPlatformCost{{
			Currency: "CNY", MonthlyCost: 8.8, TodayCost: 0.02,
			Daily: []usage.DeepSeekPlatformCostDay{{Date: "2026-08-01", Amount: 0.02}},
		}},
	}}

	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		t.Fatalf("fake registry error: %v", err)
	case resp := <-respSeen:
		if resp.Type != "response" || resp.Method != rp.RegistryMethodDeepSeekUsageGet {
			t.Fatalf("unexpected response: %#v", resp)
		}
		if resp.Payload["status"] != "ok" || resp.Payload["hubId"] != "hub-deepseek-usage" {
			t.Fatalf("response payload=%#v", resp.Payload)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive deepseek.usage.get response")
	}
}

func TestReporterRejectsInvalidDeepSeekUsageGet(t *testing.T) {
	respSeen := make(chan testEnvelope, 1)
	errSeen := make(chan error, 1)
	ts := newFakeReporterRegistry(t, "hub-deepseek-usage-invalid", testEnvelope{
		RequestID: 202,
		Type:      "request",
		Method:    rp.RegistryMethodDeepSeekUsageGet,
		HubID:     "hub-deepseek-usage-invalid",
		Payload:   map[string]any{"year": 1999, "month": 13},
	}, respSeen, errSeen)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	reporter := NewReporter(ReporterConfig{
		Server:            strings.TrimPrefix(ts.URL, "http://"),
		HubID:             "hub-deepseek-usage-invalid",
		ReconnectInterval: 50 * time.Millisecond,
		StateDir:          t.TempDir(),
	}, nil)
	done := make(chan error, 1)
	go func() { done <- reporter.Run(ctx) }()
	defer stopReporterForTest(t, cancel, done)

	select {
	case err := <-errSeen:
		if err == nil {
			t.Fatal("expected an invalid argument error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("did not receive error")
	}
}
```

Check `hub_test.go` imports for `context`; add it if missing.

- [ ] **Step 2: Run the handler tests and verify RED**

Run:

```powershell
go -C server test ./internal/hub -run 'TestReporter(RespondsTo|RejectsInvalid)DeepSeekUsageGet' -count=1
```

Expected: FAIL because `deepSeekUsage` and `replyDeepSeekUsageGet` do not exist.

- [ ] **Step 3: Add the store and handler to the Reporter**

In `server/internal/hub/reporter.go`:

```go
type deepSeekUsageSource interface {
	Get(ctx context.Context, year, month int, force bool) (usage.DeepSeekPlatformUsage, error)
}

type deepSeekUsageGetPayload struct {
	Year  int `json:"year"`
	Month int `json:"month"`
	Force bool `json:"force,omitempty"`
}
```

Add to the `Reporter` struct:

```go
	deepSeekUsage           deepSeekUsageSource
```

In `NewReporter`, after `r.hubConfig` is finalized and before `return r`:

```go
	platformToken, _ := r.hubConfig.DeepSeekPlatformToken()
	r.deepSeekUsage = usage.NewDeepSeekPlatformStore(platformToken, &http.Client{Timeout: 20 * time.Second})
```

In `handleRegistryRequest`, add:

```go
	case rp.RegistryMethodDeepSeekUsageGet:
		r.replyDeepSeekUsageGet(conn, in)
```

Add the handler next to `replyUsageHistoryGet`:

```go
func (r *Reporter) replyDeepSeekUsageGet(conn *websocket.Conn, req envelope) {
	var payload deepSeekUsageGetPayload
	if err := decodePayload(req.Payload, &payload); err != nil {
		_ = r.writeError(conn, req.RequestID, codeInvalidArgument, "invalid deepseek.usage.get payload")
		return
	}
	year, month := payload.Year, payload.Month
	if year == 0 {
		year = time.Now().UTC().Year()
	}
	if month == 0 {
		month = int(time.Now().UTC().Month())
	}
	if year < 2020 || year > 2100 || month < 1 || month > 12 {
		_ = r.writeError(conn, req.RequestID, codeInvalidArgument, "invalid year or month")
		return
	}
	if r.deepSeekUsage == nil {
		_ = r.writeError(conn, req.RequestID, codeInternal, "deepseek usage is unavailable")
		return
	}
	result, err := r.deepSeekUsage.Get(context.Background(), year, month, payload.Force)
	if err != nil {
		_ = r.writeError(conn, req.RequestID, codeInternal, "failed to fetch deepseek usage")
		return
	}
	_ = r.writeJSON(conn, "->", envelope{
		RequestID: req.RequestID,
		Type:      rp.RegistryEnvelopeTypeResponse,
		Method:    req.Method,
		HubID:     r.cfg.HubID,
		Payload: rp.MustRaw(map[string]any{
			"hubId":    r.cfg.HubID,
			"status":   result.Status,
			"month":    result.Month,
			"balance":  result.Balance,
			"days":     result.Days,
			"costs":    result.Costs,
			"cachedAt": result.CachedAt,
		}),
	})
}
```

- [ ] **Step 4: Handle the `deepSeekPlatform` config section**

In `applyHubConfigUpdate`, add a case before `default:`:

```go
	case "deepSeekPlatform":
		if payload.Field != "token" {
			return fmt.Errorf("unsupported deepSeekPlatform field %q", payload.Field)
		}
		if err := store.UpdateDeepSeekPlatformToken(payload.Action, payload.Value, time.Now()); err != nil {
			return err
		}
		if r.deepSeekUsage != nil {
			token := ""
			if payload.Action == "set" {
				token = payload.Value
			}
			r.deepSeekUsage.SetToken(token)
		}
		return nil
```

- [ ] **Step 5: Run the handler tests and verify GREEN**

Run:

```powershell
go -C server test ./internal/hub -run 'TestReporter(RespondsTo|RejectsInvalid)DeepSeekUsageGet' -count=1
```

Expected: PASS.

- [ ] **Step 6: Run gofmt and package tests**

Run:

```powershell
gofmt -w server/internal/hub/reporter.go server/internal/hub/hub_test.go
go -C server test ./internal/hub ./internal/hubconfig ./internal/protocol ./internal/registry -count=1
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/internal/hub/reporter.go server/internal/hub/hub_test.go
git commit -m "feat(hub): serve deepseek platform usage"
```

---

### Task 5: Add the Web transport DTOs and repository method

**Files:**
- Modify: `app/web/src/registry/registryMethods.ts`
- Modify: `app/web/src/registry/registryTypes.ts`
- Modify: `app/web/src/registry/RegistryRepository.ts`
- Modify: `app/web/src/registry/RegistryWorkspaceService.ts`
- Test: `app/__tests__/web-hub-state-service.test.ts`

- [ ] **Step 1: Write the failing transport assertions**

Add to `app/__tests__/web-hub-state-service.test.ts` (follow the existing `getUsageHistory` request assertion in that file):

```ts
test('requests deepseek usage with month params', async () => {
  const client = {
    request: jest.fn().mockResolvedValue({
      type: 'response',
      payload: {
        hubId: 'hub-a',
        status: 'ok',
        month: {year: 2026, month: 8},
        balance: [{currency: 'CNY', total: '3.24'}],
        days: [{date: '2026-08-01', request: 3, outputTokens: 120, hitTokens: 300, missTokens: 100, totalTokens: 520}],
        costs: [{currency: 'CNY', monthlyCost: 8.8, todayCost: 0.02, daily: [{date: '2026-08-01', amount: 0.02}]}],
      },
    }),
  } as unknown as RegistryClient;
  const repository = new RegistryRepository(client);
  const result = await repository.getDeepSeekUsage('hub-a', 2026, 8, true);
  expect(client.request).toHaveBeenCalledWith({
    method: 'deepseek.usage.get',
    hubId: 'hub-a',
    payload: {year: 2026, month: 8, force: true},
    timeoutMs: 30000,
  });
  expect(result.status).toBe('ok');
  expect(result.days?.[0]?.totalTokens).toBe(520);
});
```

`RegistryClient` is already imported at the top of the file. The repository returns the normalized payload directly, so the assertion uses `repository.getDeepSeekUsage` rather than a service-level call.

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-hub-state-service.test.ts
```

Expected: FAIL because the method, DTOs, and service function do not exist.

- [ ] **Step 3: Add the method constant**

In `app/web/src/registry/registryMethods.ts`, next to `UsageHistoryGet`:

```ts
  DeepSeekUsageGet: 'deepseek.usage.get',
```

- [ ] **Step 4: Add the TypeScript DTOs**

In `app/web/src/registry/registryTypes.ts`:

```ts
export interface RegistryDeepSeekUsageDay {
  date: string;
  request: number;
  outputTokens: number;
  hitTokens: number;
  missTokens: number;
  totalTokens: number;
}

export interface RegistryDeepSeekUsageCostDay {
  date: string;
  amount: number;
}

export interface RegistryDeepSeekUsageCost {
  currency: string;
  monthlyCost: number;
  todayCost: number;
  daily: RegistryDeepSeekUsageCostDay[];
}

export interface RegistryDeepSeekUsageResponse {
  hubId: string;
  status: 'ok' | 'notConnected' | 'expired';
  month: {year: number; month: number};
  balance?: Array<{currency: string; total: string; granted?: string; toppedUp?: string}>;
  days?: RegistryDeepSeekUsageDay[];
  costs?: RegistryDeepSeekUsageCost[];
  cachedAt?: string;
}
```

Extend the hub config types:

```ts
export interface RegistryHubConfigDeepSeekPlatformSnapshot {
  configured: boolean;
  updatedAt?: string;
}

export interface RegistryHubConfig {
  flickerBridge: RegistryHubConfigFlickerBridgeSnapshot;
  apiKeys: Record<string, RegistryHubConfigAPIKeySnapshot>;
  deepSeekPlatform: RegistryHubConfigDeepSeekPlatformSnapshot;
}

export type RegistryHubConfigUpdatePayload =
  | {section: 'apiKeys'; field: string; action: 'set' | 'clear'; value?: string}
  | {section: 'flickerBridge'; field: 'enabled'; action: 'set' | 'clear'}
  | {section: 'deepSeekPlatform'; field: 'token'; action: 'set' | 'clear'; value?: string};
```

- [ ] **Step 5: Add repository normalization and request**

In `app/web/src/registry/RegistryRepository.ts`, add near `normalizeUsageHistoryLimit`:

```ts
function normalizeDeepSeekUsageResponse(raw: unknown): RegistryDeepSeekUsageResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const hubId = input.hubId;
  const status = input.status;
  const month = input.month as {year?: unknown; month?: unknown} | undefined;
  if (typeof hubId !== 'string' || hubId === '') return null;
  if (status !== 'ok' && status !== 'notConnected' && status !== 'expired') return null;
  if (!month || typeof month.year !== 'number' || typeof month.month !== 'number') return null;
  if (status === 'ok') {
    const days = Array.isArray(input.days) ? input.days.map(normalizeDeepSeekUsageDay).filter(day => day !== null) : [];
    const costs = Array.isArray(input.costs) ? input.costs.map(normalizeDeepSeekUsageCost).filter(cost => cost !== null) : [];
    return {
      hubId,
      status,
      month: {year: month.year, month: month.month},
      balance: Array.isArray(input.balance) ? input.balance as RegistryDeepSeekUsageResponse['balance'] : undefined,
      days,
      costs,
      cachedAt: typeof input.cachedAt === 'string' ? input.cachedAt : undefined,
    };
  }
  return {hubId, status, month: {year: month.year, month: month.month}};
}

function normalizeDeepSeekUsageDay(raw: unknown): RegistryDeepSeekUsageDay | null {
  if (!raw || typeof raw !== 'object') return null;
  const day = raw as Record<string, unknown>;
  const date = day.date;
  const numbers = ['request', 'outputTokens', 'hitTokens', 'missTokens', 'totalTokens']
    .map(key => day[key])
    .filter(value => typeof value === 'number' && Number.isFinite(value));
  if (typeof date !== 'string' || date === '' || numbers.length !== 5) return null;
  return {
    date,
    request: day.request as number,
    outputTokens: day.outputTokens as number,
    hitTokens: day.hitTokens as number,
    missTokens: day.missTokens as number,
    totalTokens: day.totalTokens as number,
  };
}

function normalizeDeepSeekUsageCost(raw: unknown): RegistryDeepSeekUsageCost | null {
  if (!raw || typeof raw !== 'object') return null;
  const cost = raw as Record<string, unknown>;
  if (typeof cost.currency !== 'string' || cost.currency === '') return null;
  const daily = Array.isArray(cost.daily) ? cost.daily.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return null;
    const day = entry as Record<string, unknown>;
    return typeof day.date === 'string' && typeof day.amount === 'number'
      ? {date: day.date, amount: day.amount}
      : null;
  }).filter((entry: unknown): entry is RegistryDeepSeekUsageCostDay => entry !== null) : [];
  return {
    currency: cost.currency,
    monthlyCost: Number(cost.monthlyCost) || 0,
    todayCost: Number(cost.todayCost) || 0,
    daily,
  };
}
```

Add the repository method next to `getUsageHistory`:

```ts
async getDeepSeekUsage(hubId: string, year: number, month: number, force = false): Promise<RegistryDeepSeekUsageResponse> {
  const input = await this.client.request({
    method: RegistryMethods.DeepSeekUsageGet,
    hubId,
    payload: {year, month, force},
    timeoutMs: 30000,
  });
  const response = normalizeDeepSeekUsageResponse(input);
  if (!response || response.hubId !== hubId) throw new Error('invalid deepseek usage response');
  return response;
}
```

- [ ] **Step 6: Add the workspace service method**

In `app/web/src/registry/RegistryWorkspaceService.ts`, next to `getUsageHistory`:

```ts
async getDeepSeekUsage(hubId: string, year: number, month: number, force = false): Promise<RegistryDeepSeekUsageResponse> {
  return this.repository.getDeepSeekUsage(hubId, year, month, force);
}
```

Add `RegistryDeepSeekUsageResponse` to the file's type imports.

- [ ] **Step 7: Run the Web tests and TypeScript**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-hub-state-service.test.ts
npm --prefix app run tsc:web
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add app/web/src/registry app/__tests__/web-hub-state-service.test.ts
git commit -m "feat(app): transport deepseek platform usage"
```

---

### Task 6: Add pure usage view helpers

**Files:**
- Create: `app/web/src/usage/deepSeekUsage.ts`
- Test: `app/__tests__/web-deepseek-usage.test.ts`

- [ ] **Step 1: Write the failing pure-function tests**

Create `app/__tests__/web-deepseek-usage.test.ts`:

```ts
import {
  deepSeekDayCost,
  deepSeekHitRate,
  deepSeekMonthKey,
  deepSeekMonthLabel,
  deepSeekTodayCost,
  normalizeDeepSeekUsage,
  previousDeepSeekMonth,
  type RegistryDeepSeekUsageCost,
} from '../web/src/usage/deepSeekUsage';

test('computes cache hit rate from hit and miss tokens', () => {
  expect(deepSeekHitRate({hitTokens: 300, missTokens: 100})).toBeCloseTo(0.75);
  expect(deepSeekHitRate({hitTokens: 0, missTokens: 0})).toBe(0);
});

test('finds the cost for a day in the primary currency', () => {
  const costs: RegistryDeepSeekUsageCost[] = [{
    currency: 'CNY',
    monthlyCost: 8.8,
    todayCost: 0.02,
    daily: [{date: '2026-08-01', amount: 0.02}],
  }];
  expect(deepSeekDayCost('2026-08-01', costs)).toBeCloseTo(0.02);
  expect(deepSeekDayCost('2026-08-02', costs)).toBe(0);
});

test('picks today cost from the current month', () => {
  const now = new Date('2026-08-01T12:00:00Z');
  expect(deepSeekTodayCost(now, [{date: '2026-08-01', amount: 0.02}])).toBeCloseTo(0.02);
});

test('normalizes a response into a view with merged costs', () => {
  const view = normalizeDeepSeekUsage({
    hubId: 'hub-a',
    status: 'ok',
    month: {year: 2026, month: 8},
    balance: [{currency: 'CNY', total: '3.24'}],
    days: [{date: '2026-08-01', request: 3, outputTokens: 120, hitTokens: 300, missTokens: 100, totalTokens: 520}],
    costs: [{currency: 'CNY', monthlyCost: 8.8, todayCost: 0.02, daily: [{date: '2026-08-01', amount: 0.02}]}],
  }, new Date('2026-08-01T12:00:00Z'));
  expect(view.days[0].cacheHitRate).toBeCloseTo(0.75);
  expect(view.days[0].cost).toBeCloseTo(0.02);
  expect(view.monthlyCost).toBeCloseTo(8.8);
  expect(view.todayCost).toBeCloseTo(0.02);
  expect(view.currency).toBe('CNY');
});

test('month helpers round-trip', () => {
  expect(deepSeekMonthKey(2026, 8)).toBe('2026-08');
  expect(deepSeekMonthLabel(2026, 8)).toBe('2026-08');
  expect(previousDeepSeekMonth(2026, 1)).toEqual({year: 2025, month: 12});
});
```

Note: import the registry response type through `RegistryDeepSeekUsageResponse` in the normalization signature.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-deepseek-usage.test.ts
```

Expected: FAIL because `deepSeekUsage.ts` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `app/web/src/usage/deepSeekUsage.ts`:

```ts
import type {RegistryDeepSeekUsageCost, RegistryDeepSeekUsageDay, RegistryDeepSeekUsageResponse} from '../registry/registryTypes';

export interface DeepSeekUsageDay extends RegistryDeepSeekUsageDay {
  cacheHitRate: number;
  cost: number;
}

export interface DeepSeekUsageView {
  status: RegistryDeepSeekUsageResponse['status'];
  month: {year: number; month: number};
  balance: RegistryDeepSeekUsageResponse['balance'];
  days: DeepSeekUsageDay[];
  costs: RegistryDeepSeekUsageCost[];
  monthlyCost: number;
  todayCost: number;
  currency: string;
  cachedAt?: string;
}

export function deepSeekHitRate(day: Pick<RegistryDeepSeekUsageDay, 'hitTokens' | 'missTokens'>): number {
  const total = day.hitTokens + day.missTokens;
  return total > 0 ? day.hitTokens / total : 0;
}

export function deepSeekDayCost(date: string, costs: RegistryDeepSeekUsageCost[]): number {
  for (const cost of costs) {
    const day = cost.daily.find(entry => entry.date === date);
    if (day) return day.amount;
  }
  return 0;
}

export function deepSeekTodayCost(now: Date, daily: Array<{date: string; amount: number}>): number {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return daily.find(entry => entry.date === today)?.amount ?? 0;
}

export function normalizeDeepSeekUsage(raw: RegistryDeepSeekUsageResponse, now = new Date()): DeepSeekUsageView {
  const days = (raw.days ?? []).map(day => ({
    ...day,
    cacheHitRate: deepSeekHitRate(day),
    cost: deepSeekDayCost(day.date, raw.costs ?? []),
  }));
  const costs = raw.costs ?? [];
  const primary = costs[0];
  const todayCost = primary ? deepSeekTodayCost(now, primary.daily) : 0;
  return {
    status: raw.status,
    month: raw.month,
    balance: raw.balance,
    days,
    costs,
    monthlyCost: primary?.monthlyCost ?? 0,
    todayCost,
    currency: primary?.currency ?? '',
    cachedAt: raw.cachedAt,
  };
}

export function deepSeekMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function deepSeekMonthLabel(year: number, month: number): string {
  return deepSeekMonthKey(year, month);
}

export function previousDeepSeekMonth(year: number, month: number): {year: number; month: number} {
  return month === 1 ? {year: year - 1, month: 12} : {year, month: month - 1};
}
```

- [ ] **Step 4: Run the tests and TypeScript**

Run:

```powershell
npm --prefix app test -- --runInBand __tests__/web-deepseek-usage.test.ts
npm --prefix app run tsc:web
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add app/web/src/usage/deepSeekUsage.ts app/__tests__/web-deepseek-usage.test.ts
git commit -m "feat(app): normalize deepseek platform usage views"
```

---

## File structure

### Hub and protocol

- Modify `server/internal/hubconfig/store.go`: add `deepSeekPlatform` secret section with `DeepSeekPlatformToken()` / `UpdateDeepSeekPlatformToken()` and snapshot markers.
- Create `server/internal/hub/usage/deepseek_platform.go`: platform HTTP client, tolerant parsers for summary/amount/cost, per-month TTL cache, and `DeepSeekPlatformStore`.
- Create `server/internal/hub/usage/deepseek_platform_test.go`: parser, cache, expired, and not-connected coverage using `httptest`.
- Modify `server/internal/protocol/registry_methods.go`: add `deepseek.usage.get` as a Hub-state routed method (no protocol version bump).
- Modify `server/internal/hub/reporter.go`: construct the store, route `deepseek.usage.get`, and handle the `deepSeekPlatform` config section.
- Extend `server/internal/hub/hub_test.go` and `server/internal/protocol/registry_methods_test.go`; add a forwarding case in `server/internal/registry/server_test.go`.

### Web data and UI

- Modify `app/web/src/registry/registryMethods.ts`, `registryTypes.ts`, `RegistryRepository.ts`, `RegistryWorkspaceService.ts`: method constant, DTOs, normalization, and request.
- Create `app/web/src/usage/deepSeekUsage.ts`: pure view normalization, hit rate, month helpers.
- Create `app/web/src/usage/DeepSeekUsageDialog.tsx` and `DeepSeekUsageChart.tsx`: accessible modal with login state and lazy ECharts chart.
- Modify `app/web/src/usage/UsageFeatureSurface.tsx`, `MonitorSurface.tsx`, `MobileUsageDialog.tsx`, and `app/web/src/app/WorkspaceApp.tsx`: DeepSeek balance rows become clickable and open the new dialog.
- Modify `app/web/src/styles/usage.css`: dialog, summary cards, and chart styles.
- Extend `app/__tests__/web-usage-feature-surface.test.tsx`, `app/__tests__/web-usage-workspace-integration.test.tsx`, `app/__tests__/web-hub-state-service.test.ts`; create `app/__tests__/web-deepseek-usage.test.ts` and `app/__tests__/web-deepseek-usage-dialog.test.tsx`.

### Native login

- Modify `server/cmd/wheelmaker-desktop/webview_policy.go`, `desktop_bridge.go`, `desktop_runtime.go`, `webview_windows.go`; create `server/cmd/wheelmaker-desktop/deepseek_login.go` and `deepseek_login_windows.go`; extend `webview_policy_test.go` and add `deepseek_login_test.go`.
- Modify `mobile/android/app/src/main/java/com/wheelmaker/android/WheelMakerBridge.kt` and `MainActivity.kt`; create `DeepSeekLoginDialog.kt`; add `DeepSeekLoginProtocolTest.kt` under `mobile/android/app/src/test/...`.

---

### Task 1: Store the DeepSeek platform session token

**Files:**
- Modify: `server/internal/hubconfig/store.go`
- Test: `server/internal/hubconfig/store_test.go`

- [ ] **Step 1: Write the failing store test**

Add to `server/internal/hubconfig/store_test.go`:

```go
func TestStoreDeepSeekPlatformTokenRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hub-config.json")
	store := New(path)
	now := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	if err := store.UpdateDeepSeekPlatformToken("set", "ds-platform-session", now); err != nil {
		t.Fatalf("set token: %v", err)
	}
	token, err := store.DeepSeekPlatformToken()
	if err != nil || token != "ds-platform-session" {
		t.Fatalf("token=%q err=%v", token, err)
	}
	snapshot, err := store.Snapshot()
	if err != nil || !snapshot.DeepSeekPlatform.Configured || snapshot.DeepSeekPlatform.UpdatedAt == "" {
		t.Fatalf("snapshot=%+v err=%v", snapshot, err)
	}
	if err := store.UpdateDeepSeekPlatformToken("clear", "", now); err != nil {
		t.Fatalf("clear token: %v", err)
	}
	if token, _ := store.DeepSeekPlatformToken(); token != "" {
		t.Fatalf("token after clear=%q", token)
	}
	if err := store.UpdateDeepSeekPlatformToken("bogus", "x", now); err == nil {
		t.Fatal("invalid action must fail")
	}
}
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
go -C server test ./internal/hubconfig -run TestStoreDeepSeekPlatformTokenRoundTrip -count=1
```

Expected: FAIL because `DeepSeekPlatformToken` / `UpdateDeepSeekPlatformToken` do not exist.

- [ ] **Step 3: Implement the secret section**

In `server/internal/hubconfig/store.go`, add:

```go
type DeepSeekPlatformSnapshot struct {
	Configured bool   `json:"configured"`
	UpdatedAt  string `json:"updatedAt,omitempty"`
}
```

Add `DeepSeekPlatform DeepSeekPlatformSnapshot `json:"deepSeekPlatform"`` to `Snapshot`, then add:

```go
func deepSeekPlatformSection(root map[string]json.RawMessage) (map[string]secretValue, error) {
	section := map[string]secretValue{}
	if raw := root["deepSeekPlatform"]; len(raw) != 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &section); err != nil || section == nil {
			return nil, fmt.Errorf("parse hub config deepSeekPlatform section")
		}
	}
	return section, nil
}

// DeepSeekPlatformToken returns the stored platform session token, or "" when unset.
func (s *Store) DeepSeekPlatformToken() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return "", err
	}
	section, err := deepSeekPlatformSection(root)
	if err != nil {
		return "", err
	}
	return section["token"].Value, nil
}

// UpdateDeepSeekPlatformToken sets or clears the platform session token.
func (s *Store) UpdateDeepSeekPlatformToken(action, value string, now time.Time) error {
	if action != "set" && action != "clear" {
		return fmt.Errorf("unsupported deepSeekPlatform action %q", action)
	}
	if action == "set" {
		value = strings.TrimSpace(value)
		if value == "" || len(value) > maxSecretBytes {
			return fmt.Errorf("deepSeekPlatform token is required and must not exceed 16 KiB")
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	root, _, err := s.loadLocked()
	if err != nil {
		return err
	}
	section, err := deepSeekPlatformSection(root)
	if err != nil {
		return err
	}
	if action == "clear" {
		delete(section, "token")
	} else {
		section["token"] = secretValue{Value: value, UpdatedAt: now.UTC()}
	}
	rawSection, err := json.Marshal(section)
	if err != nil {
		return fmt.Errorf("encode deepSeekPlatform section: %w", err)
	}
	root["deepSeekPlatform"] = rawSection
	return s.writeRootLocked(root)
}
```

In `Snapshot()`, populate the new field:

```go
	platformSection, err := deepSeekPlatformSection(root)
	if err != nil {
		return Snapshot{}, err
	}
	platformEntry := platformSection["token"]
	snapshot.DeepSeekPlatform = DeepSeekPlatformSnapshot{Configured: platformEntry.Value != ""}
	if !platformEntry.UpdatedAt.IsZero() {
		snapshot.DeepSeekPlatform.UpdatedAt = platformEntry.UpdatedAt.UTC().Format(time.RFC3339)
	}
```

Check that `strings` is imported in `store.go`; add it if missing.

- [ ] **Step 4: Run the store test and verify GREEN**

Run:

```powershell
go -C server test ./internal/hubconfig -count=1
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/internal/hubconfig/store.go server/internal/hubconfig/store_test.go
git commit -m "feat(hubconfig): store deepseek platform session token"
```

---

### Task 2: Implement the DeepSeek platform client and per-month cache

**Files:**
- Create: `server/internal/hub/usage/deepseek_platform.go`
- Test: `server/internal/hub/usage/deepseek_platform_test.go`

- [ ] **Step 1: Write the failing client, parser, and cache tests**

Create `server/internal/hub/usage/deepseek_platform_test.go`:

```go
package usage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const deepSeekPlatformFixture = `{
  "code": 0,
  "bizData": {
    "monthly_costs": [{"currency": "CNY", "total": 8.8}],
    "normal_wallets": [{"currency": "CNY", "total_balance": "3.24", "granted_balance": "0.00", "topped_up_balance": "3.24"}],
    "bonus_wallets": []
  }
}`

const deepSeekAmountFixture = `{
  "code": 0,
  "data": {
    "days": [
      {
        "date": "2026-08-01",
        "models": [
          {
            "model": "deepseek-v4-flash",
            "usage": [
              {"type": "REQUEST", "amount": 3},
              {"type": "RESPONSE_TOKEN", "amount": 120},
              {"type": "PROMPT_CACHE_HIT_TOKEN", "amount": 300},
              {"type": "PROMPT_CACHE_MISS_TOKEN", "amount": 100}
            ]
          }
        ]
      }
    ]
  }
}`

const deepSeekCostFixture = `{
  "code": 0,
  "bizData": {
    "currencies": [
      {
        "currency": "CNY",
        "total": [{"model": "deepseek-v4-flash", "usage": [{"type": "RESPONSE_TOKEN", "amount": 0.02}]}],
        "days": [{"date": "2026-08-01", "amount": 0.02}]
      }
    ]
  }
}`

func TestParseDeepSeekPlatformFixtures(t *testing.T) {
	now := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	balance, err := parseDeepSeekSummary(asMap(t, deepSeekPlatformFixture), now)
	if err != nil || len(balance) != 1 || balance[0].Currency != "CNY" || balance[0].Total != "3.24" {
		t.Fatalf("balance=%+v err=%v", balance, err)
	}
	days, err := parseDeepSeekAmount(asMap(t, deepSeekAmountFixture))
	if err != nil || len(days) != 1 {
		t.Fatalf("days=%+v err=%v", days, err)
	}
	day := days[0]
	if day.Date != "2026-08-01" || day.Request != 3 || day.OutputTokens != 120 ||
		day.HitTokens != 300 || day.MissTokens != 100 || day.TotalTokens != 520 {
		t.Fatalf("day=%+v", day)
	}
	costs, err := parseDeepSeekCost(asMap(t, deepSeekCostFixture), now, DeepSeekPlatformMonth{Year: 2026, Month: 8})
	if err != nil || len(costs) != 1 || costs[0].Currency != "CNY" || costs[0].TodayCost != 0.02 || len(costs[0].Daily) != 1 {
		t.Fatalf("costs=%+v err=%v", costs, err)
	}
}

func TestDeepSeekPlatformStoreCacheAndExpired(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if strings.Contains(r.URL.Path, "get_user_summary") {
			_, _ = w.Write([]byte(deepSeekPlatformFixture))
			return
		}
		if strings.Contains(r.URL.Path, "usage/amount") {
			_, _ = w.Write([]byte(deepSeekAmountFixture))
			return
		}
		if strings.Contains(r.URL.Path, "usage/cost") {
			_, _ = w.Write([]byte(deepSeekCostFixture))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	store := NewDeepSeekPlatformStore("session-token", server.Client())
	first, err := store.Get(context.Background(), 2026, 8, false)
	if err != nil || first.Status != DeepSeekPlatformOK || len(first.Days) != 1 || len(first.Costs) != 1 {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	if calls.Load() != 3 {
		t.Fatalf("expected 3 upstream calls, got %d", calls.Load())
	}
	cached, err := store.Get(context.Background(), 2026, 8, false)
	if err != nil || len(cached.Days) != 1 {
		t.Fatalf("cached=%+v err=%v", cached, err)
	}
	if calls.Load() != 3 {
		t.Fatalf("cache miss: expected still 3 calls, got %d", calls.Load())
	}
	if _, err := store.Get(context.Background(), 2026, 8, true); err != nil {
		t.Fatalf("forced refresh: %v", err)
	}
	if calls.Load() != 6 {
		t.Fatalf("forced refresh should refetch, got %d calls", calls.Load())
	}
}

func TestDeepSeekPlatformStoreExpiredKeepsCache(t *testing.T) {
	var calls atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) <= 3 {
			switch {
			case strings.Contains(r.URL.Path, "get_user_summary"):
				_, _ = w.Write([]byte(deepSeekPlatformFixture))
			case strings.Contains(r.URL.Path, "usage/amount"):
				_, _ = w.Write([]byte(deepSeekAmountFixture))
			default:
				_, _ = w.Write([]byte(deepSeekCostFixture))
			}
			return
		}
		_, _ = w.Write([]byte(`{"code":40003,"msg":"Authorization Failed (invalid token)"}`))
	}))
	defer server.Close()

	store := NewDeepSeekPlatformStore("session-token", server.Client())
	first, err := store.Get(context.Background(), 2026, 8, false)
	if err != nil || first.Status != DeepSeekPlatformOK {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	got, err := store.Get(context.Background(), 2026, 8, true)
	if err != nil {
		t.Fatalf("expired fetch: %v", err)
	}
	if got.Status != DeepSeekPlatformExpired || len(got.Days) != 1 {
		t.Fatalf("expired response must keep cached data: %+v", got)
	}
}

func TestDeepSeekPlatformStoreNotConnected(t *testing.T) {
	store := NewDeepSeekPlatformStore("", nil)
	got, err := store.Get(context.Background(), 2026, 8, false)
	if err != nil || got.Status != DeepSeekPlatformNotConnected {
		t.Fatalf("got=%+v err=%v", got, err)
	}
}

func asMap(t *testing.T, raw string) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		t.Fatalf("fixture: %v", err)
	}
	return out
}
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
go -C server test ./internal/hub/usage -run 'Test(ParseDeepSeekPlatform|DeepSeekPlatformStore)' -count=1
```

Expected: FAIL because `deepseek_platform.go` does not exist.

- [ ] **Step 3: Implement the client, parsers, and cache**

Create `server/internal/hub/usage/deepseek_platform.go`:

```go
package usage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	deepSeekPlatformBaseURL           = "https://platform.deepseek.com"
	deepSeekExpiredCode               = 40003
	deepSeekPlatformCurrentMonthTTL   = 5 * time.Minute
	deepSeekPlatformPastMonthTTL      = 24 * time.Hour
	deepSeekPlatformMaxResponseBytes  = 4 << 20
)

var errDeepSeekExpired = errors.New("deepseek platform session expired")

type DeepSeekPlatformStatus string

const (
	DeepSeekPlatformOK           DeepSeekPlatformStatus = "ok"
	DeepSeekPlatformNotConnected DeepSeekPlatformStatus = "notConnected"
	DeepSeekPlatformExpired      DeepSeekPlatformStatus = "expired"
)

type DeepSeekPlatformMonth struct {
	Year  int `json:"year"`
	Month int `json:"month"`
}

type DeepSeekPlatformDay struct {
	Date         string `json:"date"`
	Request      int64  `json:"request"`
	OutputTokens int64  `json:"outputTokens"`
	HitTokens    int64  `json:"hitTokens"`
	MissTokens   int64  `json:"missTokens"`
	TotalTokens  int64  `json:"totalTokens"`
}

type DeepSeekPlatformCostDay struct {
	Date   string  `json:"date"`
	Amount float64 `json:"amount"`
}

type DeepSeekPlatformCost struct {
	Currency    string                    `json:"currency"`
	MonthlyCost float64                   `json:"monthlyCost"`
	TodayCost   float64                   `json:"todayCost"`
	Daily       []DeepSeekPlatformCostDay `json:"daily"`
}

type DeepSeekPlatformUsage struct {
	Status   DeepSeekPlatformStatus     `json:"status"`
	Month    DeepSeekPlatformMonth      `json:"month"`
	Balance  []BalanceItem              `json:"balance,omitempty"`
	Days     []DeepSeekPlatformDay      `json:"days,omitempty"`
	Costs    []DeepSeekPlatformCost     `json:"costs,omitempty"`
	CachedAt *time.Time                 `json:"cachedAt,omitempty"`
}

type DeepSeekPlatformClient struct {
	Token  string
	Client *http.Client
	Now    func() time.Time
}

func (c *DeepSeekPlatformClient) Fetch(ctx context.Context, year, month int) (DeepSeekPlatformUsage, error) {
	token := strings.TrimSpace(c.Token)
	monthValue := DeepSeekPlatformMonth{Year: year, Month: month}
	if token == "" {
		return DeepSeekPlatformUsage{Status: DeepSeekPlatformNotConnected, Month: monthValue}, nil
	}
	client := c.Client
	if client == nil {
		client = http.DefaultClient
	}
	summary, err := c.fetchJSON(ctx, client, "/api/v0/users/get_user_summary", token)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	amount, err := c.fetchJSON(ctx, client, "/api/v0/usage/amount?year="+strconv.Itoa(year)+"&month="+strconv.Itoa(month), token)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	cost, err := c.fetchJSON(ctx, client, "/api/v0/usage/cost?year="+strconv.Itoa(year)+"&month="+strconv.Itoa(month), token)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	now := time.Now().UTC()
	if c.Now != nil {
		now = c.Now().UTC()
	}
	balance, err := parseDeepSeekSummary(summary, now)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	days, err := parseDeepSeekAmount(amount)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	costs, err := parseDeepSeekCost(cost, now, monthValue)
	if err != nil {
		return DeepSeekPlatformUsage{}, err
	}
	return DeepSeekPlatformUsage{
		Status:  DeepSeekPlatformOK,
		Month:   monthValue,
		Balance: balance,
		Days:    days,
		Costs:   costs,
	}, nil
}

func (c *DeepSeekPlatformClient) fetchJSON(ctx context.Context, client *http.Client, path, token string) (map[string]any, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, deepSeekPlatformBaseURL+path, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json, text/plain, */*")
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, deepSeekPlatformMaxResponseBytes))
	if err != nil {
		return nil, err
	}
	if response.StatusCode == http.StatusUnauthorized {
		return nil, errDeepSeekExpired
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("deepseek platform %s: status %d", path, response.StatusCode)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("deepseek platform %s: invalid JSON", path)
	}
	if code, _ := nestedInt(payload, "code"); code == deepSeekExpiredCode {
		return nil, errDeepSeekExpired
	}
	return payload, nil
}

func deepSeekBizData(payload map[string]any) map[string]any {
	current := payload
	for depth := 0; depth < 6; depth++ {
		if current == nil {
			return nil
		}
		if next, ok := current["bizData"].(map[string]any); ok {
			current = next
			continue
		}
		if next, ok := current["data"].(map[string]any); ok {
			current = next
			continue
		}
		return current
	}
	return nil
}

func parseDeepSeekSummary(payload map[string]any, now time.Time) ([]BalanceItem, error) {
	data := deepSeekBizData(payload)
	items := make([]BalanceItem, 0, 4)
	items = append(items, parseDeepSeekWallets(data, "normal_wallets")...)
	items = append(items, parseDeepSeekWallets(data, "bonus_wallets")...)
	return items, nil
}

func parseDeepSeekWallets(data map[string]any, key string) []BalanceItem {
	raw, _ := data[key].([]any)
	items := make([]BalanceItem, 0, len(raw))
	for _, entry := range raw {
		item, _ := entry.(map[string]any)
		if item == nil {
			continue
		}
		currency := deepSeekText(item, "currency", "currency_code", "currencyCode")
		total := deepSeekText(item, "total_balance", "totalBalance", "balance", "total")
		if currency == "" || total == "" {
			continue
		}
		items = append(items, BalanceItem{
			Currency: currency,
			Total:    total,
			Granted:  deepSeekText(item, "granted_balance", "grantedBalance"),
			ToppedUp: deepSeekText(item, "topped_up_balance", "toppedUpBalance"),
		})
	}
	return items
}

func parseDeepSeekAmount(payload map[string]any) ([]DeepSeekPlatformDay, error) {
	data := deepSeekBizData(payload)
	rawDays, ok := firstArray(data, "days", "daily", "daily_usage", "dailyUsage")
	if !ok {
		return nil, nil
	}
	days := make([]DeepSeekPlatformDay, 0, len(rawDays))
	for _, raw := range rawDays {
		entry, _ := raw.(map[string]any)
		if entry == nil {
			continue
		}
		aggregate := deepSeekAggregateUsage(firstArrayValues(entry, "data", "models", "usage", "usages"))
		days = append(days, DeepSeekPlatformDay{
			Date:         deepSeekText(entry, "date", "day"),
			Request:      aggregate.request,
			OutputTokens: aggregate.response,
			HitTokens:    aggregate.promptHit,
			MissTokens:   aggregate.promptMiss,
			TotalTokens:  aggregate.total,
		})
	}
	return days, nil
}

type deepSeekUsageAggregate struct {
	request, response, promptHit, promptMiss, total int64
}

func deepSeekAggregateUsage(items []any) deepSeekUsageAggregate {
	var sum deepSeekUsageAggregate
	for _, item := range items {
		entry, _ := item.(map[string]any)
		if entry == nil {
			continue
		}
		var model deepSeekUsageAggregate
		for _, usageEntry := range firstArrayValues(entry, "usage", "usages", "usage_list", "usageList") {
			usage, _ := usageEntry.(map[string]any)
			if usage == nil {
				continue
			}
			kind := deepSeekText(usage, "type", "usage_type", "usageType", "name", "key")
			amount := deepSeekInt(usage, "amount", "value", "count", "total")
			switch kind {
			case "REQUEST":
				model.request += amount
			case "RESPONSE_TOKEN":
				model.response += amount
			case "PROMPT_CACHE_HIT_TOKEN":
				model.promptHit += amount
			case "PROMPT_CACHE_MISS_TOKEN":
				model.promptMiss += amount
			}
		}
		sum.request += model.request
		sum.response += model.response
		sum.promptHit += model.promptHit
		sum.promptMiss += model.promptMiss
	}
	sum.total = sum.response + sum.promptHit + sum.promptMiss
	return sum
}

func parseDeepSeekCost(payload map[string]any, now time.Time, month DeepSeekPlatformMonth) ([]DeepSeekPlatformCost, error) {
	data := deepSeekBizData(payload)
	rawBlocks, ok := firstArray(data, "cost", "costs", "currencies")
	if !ok {
		if nested, ok := firstArray(data, "data"); ok {
			rawBlocks = nested
		} else {
			return nil, nil
		}
	}
	currentMonth := now.Year() == month.Year && int(now.Month()) == month.Month
	today := now.Format("2006-01-02")
	costs := make([]DeepSeekPlatformCost, 0, len(rawBlocks))
	for _, raw := range rawBlocks {
		block, _ := raw.(map[string]any)
		if block == nil {
			continue
		}
		currency := deepSeekText(block, "currency", "currency_code", "currencyCode")
		if currency == "" {
			continue
		}
		cost := DeepSeekPlatformCost{Currency: currency}
		for _, model := range firstArrayValues(block, "total", "totals", "models", "model_cost", "modelCost") {
			cost.MonthlyCost += deepSeekEntryAmount(model)
		}
		for _, rawDay := range firstArrayValues(block, "days", "daily", "daily_cost", "dailyCost") {
			day, _ := rawDay.(map[string]any)
			if day == nil {
				continue
			}
			date := deepSeekText(day, "date", "day")
			amount := deepSeekFloat(day, "amount", "value", "cost", "total")
			if amount == 0 {
				amount = deepSeekBlockDayAmount(day)
			}
			cost.Daily = append(cost.Daily, DeepSeekPlatformCostDay{Date: date, Amount: amount})
			if currentMonth && date == today {
				cost.TodayCost = amount
			}
		}
		costs = append(costs, cost)
	}
	return costs, nil
}

func deepSeekBlockDayAmount(day map[string]any) float64 {
	var amount float64
	for _, model := range firstArrayValues(day, "models", "data", "costs", "model_cost", "modelCost") {
		amount += deepSeekEntryAmount(model)
	}
	return amount
}

func deepSeekEntryAmount(value any) float64 {
	entry, _ := value.(map[string]any)
	if entry == nil {
		return 0
	}
	var amount float64
	for _, usageEntry := range firstArrayValues(entry, "usage", "usages") {
		usage, _ := usageEntry.(map[string]any)
		if usage == nil {
			continue
		}
		amount += deepSeekFloat(usage, "amount", "value", "cost")
	}
	if amount == 0 {
		amount = deepSeekFloat(entry, "amount", "value", "cost")
	}
	return amount
}

func firstArray(data map[string]any, keys ...string) ([]any, bool) {
	for _, key := range keys {
		if value, ok := data[key].([]any); ok {
			return value, true
		}
	}
	return nil, false
}

func firstArrayValues(data map[string]any, keys ...string) []any {
	for _, key := range keys {
		if value, ok := data[key].([]any); ok {
			return value
		}
	}
	return nil
}

func nestedInt(data map[string]any, key string) (int64, bool) {
	switch value := data[key].(type) {
	case float64:
		return int64(value), true
	case int64:
		return value, true
	case json.Number:
		parsed, err := value.Int64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func deepSeekText(data map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := data[key].(string); ok {
			if text := strings.TrimSpace(value); text != "" {
				return text
			}
		}
	}
	return ""
}

func deepSeekInt(data map[string]any, keys ...string) int64 {
	for _, key := range keys {
		switch value := data[key].(type) {
		case float64:
			return int64(value)
		case int64:
			return value
		case json.Number:
			if parsed, err := value.Int64(); err == nil {
				return parsed
			}
		case string:
			if parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64); err == nil {
				return parsed
			}
		}
	}
	return 0
}

func deepSeekFloat(data map[string]any, keys ...string) float64 {
	for _, key := range keys {
		switch value := data[key].(type) {
		case float64:
			return value
		case json.Number:
			if parsed, err := value.Float64(); err == nil {
				return parsed
			}
		case string:
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil {
				return parsed
			}
		}
	}
	return 0
}

type deepSeekPlatformCacheEntry struct {
	usage     DeepSeekPlatformUsage
	fetchedAt time.Time
}

// DeepSeekPlatformStore owns the token and the per-month cache.
type DeepSeekPlatformStore struct {
	mu     sync.RWMutex
	token  string
	client *http.Client
	now    func() time.Time
	cache  map[string]deepSeekPlatformCacheEntry
}

func NewDeepSeekPlatformStore(token string, client *http.Client) *DeepSeekPlatformStore {
	return &DeepSeekPlatformStore{
		token:  strings.TrimSpace(token),
		client: client,
		now:    time.Now,
		cache:  map[string]deepSeekPlatformCacheEntry{},
	}
}

// SetToken replaces the session token and drops cached responses.
func (s *DeepSeekPlatformStore) SetToken(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.token = strings.TrimSpace(token)
	s.cache = map[string]deepSeekPlatformCacheEntry{}
}

// Get returns cached or freshly fetched platform usage for the month.
func (s *DeepSeekPlatformStore) Get(ctx context.Context, year, month int, force bool) (DeepSeekPlatformUsage, error) {
	key := fmt.Sprintf("%d-%02d", year, month)
	s.mu.RLock()
	entry, exists := s.cache[key]
	token := s.token
	now := s.now().UTC()
	s.mu.RUnlock()
	if exists && !force && cacheFresh(entry, now, year, month) {
		return entry.usage, nil
	}
	client := DeepSeekPlatformClient{Token: token, Client: s.client, Now: s.now}
	usage, err := client.Fetch(ctx, year, month)
	if err != nil {
		if errors.Is(err, errDeepSeekExpired) {
			s.mu.RLock()
			entry, exists = s.cache[key]
			s.mu.RUnlock()
			if exists {
				stale := entry.usage
				stale.Status = DeepSeekPlatformExpired
				return stale, nil
			}
			return DeepSeekPlatformUsage{
				Status: DeepSeekPlatformExpired,
				Month:  DeepSeekPlatformMonth{Year: year, Month: month},
			}, nil
		}
		return DeepSeekPlatformUsage{}, err
	}
	usage.Month = DeepSeekPlatformMonth{Year: year, Month: month}
	usage.CachedAt = &now
	s.mu.Lock()
	s.cache[key] = deepSeekPlatformCacheEntry{usage: usage, fetchedAt: now}
	s.mu.Unlock()
	return usage, nil
}

func cacheFresh(entry deepSeekPlatformCacheEntry, now time.Time, year, month int) bool {
	ttl := deepSeekPlatformPastMonthTTL
	if year == now.Year() && month == int(now.Month()) {
		ttl = deepSeekPlatformCurrentMonthTTL
	}
	return now.Sub(entry.fetchedAt) < ttl
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run:

```powershell
go -C server test ./internal/hub/usage -run 'Test(ParseDeepSeekPlatform|DeepSeekPlatformStore)' -count=1
```

Expected: PASS.

- [ ] **Step 5: Run gofmt and the full usage package**

Run:

```powershell
gofmt -w server/internal/hub/usage/deepseek_platform.go server/internal/hub/usage/deepseek_platform_test.go
go -C server test ./internal/hub/usage -count=1
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/internal/hub/usage/deepseek_platform.go server/internal/hub/usage/deepseek_platform_test.go
git commit -m "feat(usage): fetch deepseek platform usage with cache"
```

---
