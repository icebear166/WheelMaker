export type ChatPermissionReadToken = {
  epoch: number;
  readId: number;
};

export class ChatPermissionReadGate {
  private epoch = 0;
  private nextReadId = 1;
  private readonly latestReadByRuntimeKey = new Map<string, ChatPermissionReadToken>();
  private readonly readyRuntimeKeys = new Set<string>();

  begin(runtimeKey: string): ChatPermissionReadToken {
    const token = {epoch: this.epoch, readId: this.nextReadId++};
    this.latestReadByRuntimeKey.set(runtimeKey, token);
    this.readyRuntimeKeys.delete(runtimeKey);
    return token;
  }

  complete(runtimeKey: string, token: ChatPermissionReadToken): boolean {
    const latest = this.latestReadByRuntimeKey.get(runtimeKey);
    if (
      token.epoch !== this.epoch ||
      !latest ||
      latest.epoch !== token.epoch ||
      latest.readId !== token.readId
    ) {
      return false;
    }
    this.readyRuntimeKeys.add(runtimeKey);
    return true;
  }

  isReady(runtimeKey: string): boolean {
    return this.readyRuntimeKeys.has(runtimeKey);
  }

  disconnect(): void {
    this.epoch += 1;
    this.latestReadByRuntimeKey.clear();
    this.readyRuntimeKeys.clear();
  }
}
