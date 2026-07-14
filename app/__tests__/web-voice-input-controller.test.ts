import {
  createVoiceInputSession,
  replaceVoiceSegment,
  resolveVoiceGestureState,
} from '../web/src/features/speech/useVoiceInputController';
import fs from 'fs';
import path from 'path';

describe('voice input controller helpers', () => {
  test('replaces the active voice segment instead of appending text', () => {
    expect(replaceVoiceSegment('hi world', 3, 8, 'there')).toBe('hi there');
    expect(replaceVoiceSegment('prefix suffix', 7, 7, 'voice ')).toBe(
      'prefix voice suffix',
    );
  });

  test('tracks transcript replacement and restores base text on cancel', () => {
    const session = createVoiceInputSession('hello world', 6, 11);

    expect(session.applyTranscript('WheelMaker')).toBe('hello WheelMaker');
    expect(session.applyTranscript('WheelMaker speech')).toBe(
      'hello WheelMaker speech',
    );
    expect(session.cancel()).toBe('hello world');
  });

  test('commits current stream transcript before applying a new stream transcript', () => {
    const session = createVoiceInputSession('prefix suffix', 7, 7);

    expect(session.applyTranscript('你好')).toBe('prefix 你好suffix');
    expect(session.currentCursor()).toBe('prefix 你好'.length);
    session.commitLiveTranscript();
    expect(session.applyTranscript('世界')).toBe('prefix 你好世界suffix');
    expect(session.currentTranscriptText()).toBe('你好世界');
    expect(session.currentCursor()).toBe('prefix 你好世界'.length);
  });

  test('replaces live speech with shorter full transcript from the provider', () => {
    const session = createVoiceInputSession('prefix suffix', 7, 7);

    expect(session.applyTranscript('我想打开')).toBe('prefix 我想打开suffix');
    expect(session.applyTranscript('语音输入')).toBe('prefix 语音输入suffix');
    expect(session.currentTranscriptText()).toBe('语音输入');
    expect(session.currentCursor()).toBe('prefix 语音输入'.length);
  });

  test('restores the original insertion cursor after voice cancellation', () => {
    const session = createVoiceInputSession('prefix suffix', 7, 7);

    expect(session.applyTranscript('voice')).toBe('prefix voicesuffix');
    expect(session.currentCursor()).toBe('prefix voice'.length);
    expect(session.cancel()).toBe('prefix suffix');
    expect(session.currentCursor()).toBe('prefix '.length);
  });

  test('detects swipe-up cancellation threshold', () => {
    expect(resolveVoiceGestureState(200, 170)).toBe('recording');
    expect(resolveVoiceGestureState(200, 144)).toBe('cancel');
  });

  test('keeps Android direct speech out of the Registry PCM lifecycle', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'web/src/app/WorkspaceApp.tsx'), 'utf8');
    const nativeStart = app.slice(
      app.indexOf('if (nativeSpeechHost) {', app.indexOf('const startVoiceInput = async')),
      app.indexOf("logVoiceInputState('debug', 'microphone_start_requested')"),
    );

    expect(nativeStart).toContain('synchronizeAndroidSpeechCredential');
    expect(nativeStart).toContain('androidSpeechRuntime.start({');
    expect(nativeStart).toContain("model: settings.model");
    expect(nativeStart).not.toContain('service.startSpeech');
    expect(nativeStart).not.toContain('service.sendSpeechChunk');
    expect(nativeStart).not.toContain('streamId: registryStreamId');
    expect(app).not.toContain('finishAndroidRegistryStream');
    expect(app).not.toContain("event.type === 'audio'");
  });
});
