import type {RegistryConnectInitPayload, RegistryEnvelope, RegistryErrorPayload} from './registryTypes';
import {RegistryMethods} from './registryMethods';

type PendingRequest = {
  resolve: (value: RegistryEnvelope) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
};

function registryAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Registry request aborted', 'AbortError');
  }
  const error = new Error('Registry request aborted');
  error.name = 'AbortError';
  return error;
}

export class RegistryRequestError extends Error {
  code?: string;
  details?: unknown;

  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'RegistryRequestError';
    this.code = code;
    this.details = details;
  }
}

function parseErrorPayload(payload: unknown): RegistryErrorPayload {
  if (!payload || typeof payload !== 'object') {
    return {};
  }
  const input = payload as Record<string, unknown>;
  return {
    code: typeof input.code === 'string' ? input.code : undefined,
    message: typeof input.message === 'string' ? input.message : undefined,
    details: input.details,
  };
}

export class RegistryClient {
  private ws: WebSocket | null = null;
  private cancelConnect: (() => void) | null = null;
  private seq = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly eventListeners = new Set<(event: RegistryEnvelope) => void>();
  private readonly closeListeners = new Set<() => void>();
  private closing = false;

  constructor(
    private readonly timeoutMs = 8000,
  ) {}

  async connect(url: string): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }
    this.cancelConnect?.();
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      let settled = false;
      let sawErrorEvent = false;
      let cancelConnect: (() => void) | null = null;
      const clearConnectAttempt = () => {
        if (this.cancelConnect === cancelConnect) {
          this.cancelConnect = null;
        }
      };
      const connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        clearConnectAttempt();
        reject(
          new Error(
            `registry websocket connect timeout: url=${url} (check network, TLS cert, and nginx websocket proxy)`,
          ),
        );
        try {
          ws.close();
        } catch {}
      }, this.timeoutMs);

      const fail = (message: string, closeSocket = true) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearConnectAttempt();
        reject(new Error(message));
        if (closeSocket) {
          try {
            ws.close();
          } catch {}
        }
      };
      cancelConnect = () => fail(`registry websocket closed during connect: url=${url}`);
      this.cancelConnect = cancelConnect;

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearConnectAttempt();
        this.ws = ws;
        this.bind(ws);
        resolve();
      };
      ws.onerror = () => {
        sawErrorEvent = true;
      };
      ws.onclose = event => {
        if (!settled) {
          const suffix = sawErrorEvent ? ' (after websocket error event)' : '';
          fail(
            `registry websocket closed during connect: code=${event.code} reason=${event.reason || 'n/a'} url=${url}${suffix}`,
            false,
          );
        }
      };
    });
  }

  async connectInit(payload: RegistryConnectInitPayload): Promise<void> {
    await this.request({
      method: RegistryMethods.ConnectInit,
      payload,
    });
  }

  async request(args: {
    method: string;
    payload: unknown;
    projectId?: string;
    hubId?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<RegistryEnvelope> {
    if (args.signal?.aborted) {
      throw registryAbortError();
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('registry websocket is not connected');
    }
    const requestId = this.seq++;
    const envelope: RegistryEnvelope = {
      requestId,
      type: 'request',
      method: args.method,
      payload: args.payload,
      ...(args.projectId ? {projectId: args.projectId} : {}),
      ...(args.hubId ? {hubId: args.hubId} : {}),
    };

    const timeoutMs = args.timeoutMs ?? this.timeoutMs;
    const raw = JSON.stringify(envelope);
    return new Promise<RegistryEnvelope>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        pending.removeAbortListener?.();
        reject(new Error(`registry request timed out (${timeoutMs}ms): ${args.method}`));
      }, timeoutMs);
      const handleAbort = () => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.pending.delete(requestId);
        clearTimeout(pending.timer);
        pending.removeAbortListener?.();
        pending.reject(registryAbortError());
      };
      const removeAbortListener = args.signal
        ? () => args.signal?.removeEventListener('abort', handleAbort)
        : undefined;
      args.signal?.addEventListener('abort', handleAbort, {once: true});
      this.pending.set(requestId, {resolve, reject, timer, removeAbortListener});
      this.ws?.send(raw);
    });
  }

  sendEvent(args: {
    method: string;
    payload: unknown;
    projectId?: string;
    hubId?: string;
  }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('registry websocket is not connected');
    }
    const envelope: RegistryEnvelope = {
      type: 'event',
      method: args.method,
      payload: args.payload,
      ...(args.projectId ? {projectId: args.projectId} : {}),
      ...(args.hubId ? {hubId: args.hubId} : {}),
    };
    const raw = JSON.stringify(envelope);
    this.ws.send(raw);
  }

  close(): void {
    this.closing = true;
    this.cancelConnect?.();
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.removeAbortListener?.();
      pending.reject(new Error(`connection closed before response: ${id}`));
    }
    this.pending.clear();
    const closingWs = this.ws;
    closingWs?.close();
    this.ws = null;
    this.emitClosed();
    this.closing = false;
  }

  onEvent(listener: (event: RegistryEnvelope) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  private bind(ws: WebSocket): void {
    ws.onmessage = event => {
      if (typeof event.data !== 'string') return;
      let envelope: RegistryEnvelope;
      try {
        envelope = JSON.parse(event.data) as RegistryEnvelope;
      } catch {
        return;
      }
      if (envelope.type === 'event') {
        this.emitEvent(envelope);
        return;
      }
      if (!envelope.requestId) return;
      const pending = this.pending.get(envelope.requestId);
      if (!pending) return;
      this.pending.delete(envelope.requestId);
      clearTimeout(pending.timer);
      pending.removeAbortListener?.();
      if (envelope.type === 'error') {
        const payload = parseErrorPayload(envelope.payload);
        pending.reject(new RegistryRequestError(payload.message ?? 'registry error', payload.code, payload.details));
        return;
      }
      pending.resolve(envelope);
    };
    ws.onclose = () => this.handleSocketClosed(ws);
    ws.onerror = () => {
      // Error events may fire transiently; wait for onclose before treating as disconnect.
      if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
        this.handleSocketClosed(ws);
      }
    };
  }

  private emitEvent(event: RegistryEnvelope): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  private emitClosed(): void {
    for (const listener of this.closeListeners) {
      listener();
    }
  }

  private handleSocketClosed(ws: WebSocket): void {
    if (this.ws !== ws) {
      return;
    }
    this.ws = null;
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.removeAbortListener?.();
      pending.reject(new Error(`connection closed before response: ${id}`));
    }
    this.pending.clear();
    if (!this.closing) {
      this.emitClosed();
    }
  }
}

