import {
  PREVIEW_WORKBENCH_CHANNEL_VERSION,
  type PreviewWorkbenchChannel,
  type PreviewWorkbenchIntent,
  type PreviewWorkbenchMessage,
  type PreviewWorkbenchMirrorState,
} from './previewWorkbenchChannel';

export type PreviewWorkbenchHost = {
  publishState: (state: PreviewWorkbenchMirrorState) => void;
  publishScroll: (scrollTop: number) => void;
  close: () => void;
};

export type PreviewWorkbenchHostOptions = {
  channel: PreviewWorkbenchChannel;
  getState: () => PreviewWorkbenchMirrorState;
  onReady: () => void;
  onIntent: (intent: PreviewWorkbenchIntent) => void;
  onClosed: () => void;
};

function postState(channel: PreviewWorkbenchChannel, state: PreviewWorkbenchMirrorState): void {
  channel.post({
    kind: 'preview-state',
    version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
    state,
  });
}

function postScroll(channel: PreviewWorkbenchChannel, scrollTop: number): void {
  channel.post({
    kind: 'preview-scroll',
    version: PREVIEW_WORKBENCH_CHANNEL_VERSION,
    scrollTop,
  });
}

export function createPreviewWorkbenchHost(options: PreviewWorkbenchHostOptions): PreviewWorkbenchHost {
  let closed = false;
  let closedNotified = false;
  const handleMessage = (message: PreviewWorkbenchMessage) => {
    if (closed) return;
    if (message.kind === 'preview-ready') {
      closedNotified = false;
      options.onReady();
      postState(options.channel, options.getState());
      return;
    }
    if (message.kind === 'preview-intent') {
      options.onIntent(message.intent);
      return;
    }
    if (message.kind === 'preview-window-closed') {
      if (closedNotified) return;
      closedNotified = true;
      options.onClosed();
    }
  };
  const unsubscribe = options.channel.subscribe(handleMessage);

  return {
    publishState: state => {
      if (!closed) postState(options.channel, state);
    },
    publishScroll: scrollTop => {
      if (!closed && Number.isFinite(scrollTop)) postScroll(options.channel, scrollTop);
    },
    close: () => {
      if (closed) return;
      closed = true;
      unsubscribe();
    },
  };
}
