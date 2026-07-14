export type AndroidNativeTestRequest = {
  requestId: string;
  action: string;
  payload: Record<string, unknown>;
};

export function createAndroidNativeMessageTestHost(
  handlers: Record<string, (payload: Record<string, unknown>) => unknown>,
): {
  target: {postMessage(message: string): void; onmessage?: (event: {data: string}) => void};
  requests: AndroidNativeTestRequest[];
  messages: string[];
} {
  const requests: AndroidNativeTestRequest[] = [];
  const messages: string[] = [];
  const target: {postMessage(message: string): void; onmessage?: (event: {data: string}) => void} = {
    postMessage(message: string) {
      messages.push(message);
      const request = JSON.parse(message) as AndroidNativeTestRequest;
      requests.push(request);
      const handler = handlers[request.action];
      queueMicrotask(() => {
        if (!handler) {
          target.onmessage?.({data: JSON.stringify({
            requestId: request.requestId,
            ok: false,
            error: 'unsupported_test_action',
          })});
          return;
        }
        try {
          target.onmessage?.({data: JSON.stringify({
            requestId: request.requestId,
            ok: true,
            result: handler(request.payload),
          })});
        } catch (error) {
          target.onmessage?.({data: JSON.stringify({
            requestId: request.requestId,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })});
        }
      });
    },
  };
  return {target, requests, messages};
}
