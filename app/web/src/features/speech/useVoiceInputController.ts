export type VoiceGestureState = 'recording' | 'cancel';

export type VoiceInputSession = {
  applyTranscript: (text: string) => string;
  commitLiveTranscript: () => string;
  cancel: () => string;
  currentText: () => string;
  currentTranscriptText: () => string;
  currentCursor: () => number;
};

export function mergeVoiceTranscriptUpdate(
  previous: string,
  next: string,
): string {
  void previous;
  return next;
}

export function replaceVoiceSegment(
  baseText: string,
  insertStart: number,
  insertEnd: number,
  voiceText: string,
): string {
  const safeStart = Math.max(
    0,
    Math.min(baseText.length, Math.floor(insertStart)),
  );
  const safeEnd = Math.max(
    safeStart,
    Math.min(baseText.length, Math.floor(insertEnd)),
  );
  return `${baseText.slice(0, safeStart)}${voiceText}${baseText.slice(
    safeEnd,
  )}`;
}

export function createVoiceInputSession(
  baseText: string,
  insertStart: number,
  insertEnd: number,
): VoiceInputSession {
  let current = baseText;
  let committedTranscript = '';
  let liveTranscript = '';
  const currentTranscript = () => `${committedTranscript}${liveTranscript}`;
  const render = () => {
    current = replaceVoiceSegment(
      baseText,
      insertStart,
      insertEnd,
      currentTranscript(),
    );
    return current;
  };
  return {
    applyTranscript: text => {
      liveTranscript = mergeVoiceTranscriptUpdate(liveTranscript, text);
      return render();
    },
    commitLiveTranscript: () => {
      committedTranscript += liveTranscript;
      liveTranscript = '';
      return render();
    },
    cancel: () => {
      committedTranscript = '';
      liveTranscript = '';
      current = baseText;
      return current;
    },
    currentText: () => current,
    currentTranscriptText: currentTranscript,
    currentCursor: () => insertStart + currentTranscript().length,
  };
}

export function resolveVoiceGestureState(
  startY: number,
  currentY: number,
  threshold = 52,
): VoiceGestureState {
  return startY - currentY >= threshold ? 'cancel' : 'recording';
}
