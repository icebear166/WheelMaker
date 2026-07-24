import {LexicalComposer} from '@lexical/react/LexicalComposer';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {ContentEditable} from '@lexical/react/LexicalContentEditable';
import {EditorRefPlugin} from '@lexical/react/LexicalEditorRefPlugin';
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary';
import {HistoryPlugin} from '@lexical/react/LexicalHistoryPlugin';
import {OnChangePlugin} from '@lexical/react/LexicalOnChangePlugin';
import {PlainTextPlugin} from '@lexical/react/LexicalPlainTextPlugin';
import React from 'react';
import {
  BEFORE_INPUT_COMMAND,
  COMMAND_PRIORITY_HIGH,
  DELETE_CHARACTER_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  SKIP_SELECTION_FOCUS_TAG,
  $addUpdateTag,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from 'lexical';

import {
  normalizeChatComposerTokens,
  serializeChatComposerTokens,
  serializedChatComposerTextPosition,
  type ChatComposerFileToken,
  type ChatComposerSkillToken,
  type ChatComposerToken,
} from './chatComposerTokens';
import type {ChatComposerTokenDeletionResult} from './chatComposerTokenEditing';
import {
  $currentComposerPosition,
  $currentComposerSelectionRange,
  $deleteComposerCapsuleForCharacterDeletion,
  $deleteComposerTokenByIdAtBoundary,
  $getSelectedComposerCapsuleId,
  $insertComposerPlainText,
  $insertComposerTokens,
  $readComposerTokens,
  $setComposerTokens,
  $setSelectedComposerCapsule,
  ChatComposerCapsuleNode,
  registerComposerSlashCommandTransform,
} from './chatComposerLexicalModel';

export type ChatRichComposerHandle = {
  focus: () => void;
  getPlainTextSelection: () => ChatRichComposerPlainTextSelection;
  insertSkill: (input: Pick<ChatComposerSkillToken, 'command' | 'label'>) => void;
  insertFile: (input: Pick<ChatComposerFileToken, 'path' | 'name'>) => void;
  insertText: (text: string) => void;
  selectToken: (id: string) => void;
  deleteSelectedCapsule: () => void;
};

export type ChatRichComposerPlainTextSelection = {
  text: string;
  start: number;
  end: number;
};

export type ChatRichComposerSelectionRestore = {
  revision: number;
  cursor: number;
};

export type ChatRichComposerProps = {
  tokens: ChatComposerToken[];
  onTokensChange: (tokens: ChatComposerToken[]) => void;
  readOnly: boolean;
  placeholder?: string;
  enterKeyHint?: React.HTMLAttributes<HTMLDivElement>['enterKeyHint'];
  className?: string;
  slashCommands?: {command: string; label: string}[];
  onPlainTextChange?: (text: string, cursor: number) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  onPaste?: React.ClipboardEventHandler<HTMLDivElement>;
  selectionRestore?: ChatRichComposerSelectionRestore | null;
};

let nextTokenId = 1;

export const ChatRichComposer = React.forwardRef<ChatRichComposerHandle, ChatRichComposerProps>(
  function ChatRichComposer(props, ref) {
    const initialTokensRef = React.useRef(normalizeChatComposerTokens(props.tokens));
    const editorRef = React.useRef<LexicalEditor | null>(null);
    const handleRef = React.useRef<ChatRichComposerHandle>({
      focus: () => undefined,
      getPlainTextSelection: () => ({text: '', start: 0, end: 0}),
      insertSkill: () => undefined,
      insertFile: () => undefined,
      insertText: () => undefined,
      selectToken: () => undefined,
      deleteSelectedCapsule: () => undefined,
    });

    const initialConfig = React.useMemo(() => ({
      namespace: 'WheelMakerChatComposer',
      editable: !props.readOnly,
      nodes: [ChatComposerCapsuleNode],
      editorState: () => {
        $setComposerTokens(initialTokensRef.current);
      },
      onError(error: Error) {
        throw error;
      },
      theme: {},
    }), []);

    React.useImperativeHandle(ref, () => ({
      focus: () => handleRef.current.focus(),
      getPlainTextSelection: () => handleRef.current.getPlainTextSelection(),
      insertSkill: input => handleRef.current.insertSkill(input),
      insertFile: input => handleRef.current.insertFile(input),
      insertText: text => handleRef.current.insertText(text),
      selectToken: id => handleRef.current.selectToken(id),
      deleteSelectedCapsule: () => handleRef.current.deleteSelectedCapsule(),
    }), []);

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <ChatRichComposerContent
          {...props}
          editorRef={editorRef}
          handleRef={handleRef}
        />
      </LexicalComposer>
    );
  },
);

type ChatRichComposerContentProps = ChatRichComposerProps & {
  editorRef: React.MutableRefObject<LexicalEditor | null>;
  handleRef: React.MutableRefObject<ChatRichComposerHandle>;
};

function ChatRichComposerContent({
  tokens,
  onTokensChange,
  readOnly,
  placeholder = 'Send a message...',
  enterKeyHint,
  className = '',
  slashCommands = [],
  onPlainTextChange,
  onKeyDown,
  onPaste,
  selectionRestore,
  editorRef,
  handleRef,
}: ChatRichComposerContentProps): React.ReactElement {
  const [editor] = useLexicalComposerContext();
  const emittedTokensRef = React.useRef<ChatComposerToken[]>(normalizeChatComposerTokens(tokens));
  const tokensRef = React.useRef<ChatComposerToken[]>(normalizeChatComposerTokens(tokens));
  const pendingEmissionRef = React.useRef<ChatComposerTokenDeletionResult | null>(null);
  const syncingFromPropsRef = React.useRef(false);
  const skipNextRangeCharacterDeleteRef = React.useRef(false);
  const appliedSelectionRestoreRevisionRef = React.useRef<number | null>(null);
  const slashCommandsKey = JSON.stringify(slashCommands.map(command => [command.command, command.label]));
  const stableSlashCommands = React.useMemo(() => slashCommands, [slashCommandsKey]);

  React.useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  React.useEffect(() => {
    return registerComposerSlashCommandTransform(editor, stableSlashCommands);
  }, [editor, stableSlashCommands]);

  React.useEffect(() => {
    return editor.registerUpdateListener(() => {
      const pending = pendingEmissionRef.current;
      if (!pending) {
        return;
      }
      pendingEmissionRef.current = null;
      emitComposerCallbacks(pending, onTokensChange, onPlainTextChange);
    });
  }, [editor, onPlainTextChange, onTokensChange]);

  React.useEffect(() => {
    const normalized = normalizeChatComposerTokens(tokens);
    tokensRef.current = normalized;
    const restoreCursor = selectionRestore && appliedSelectionRestoreRevisionRef.current !== selectionRestore.revision
      ? selectionRestore.cursor
      : null;
    const editorTokens = editor.getEditorState().read(() => $readComposerTokens());
    if (chatComposerTokensEqual(normalized, editorTokens)) {
      emittedTokensRef.current = normalized;
      if (restoreCursor !== null) {
        syncingFromPropsRef.current = true;
        editor.update(() => {
          $addUpdateTag(SKIP_SELECTION_FOCUS_TAG);
          $setSelectedComposerCapsule('');
          $setComposerTokens(normalized, '', restoreCursor);
        }, {
          onUpdate: () => {
            appliedSelectionRestoreRevisionRef.current = selectionRestore?.revision ?? null;
            syncingFromPropsRef.current = false;
          },
        });
      }
      return;
    }
    syncingFromPropsRef.current = true;
    editor.update(() => {
      $addUpdateTag(SKIP_SELECTION_FOCUS_TAG);
      $setComposerTokens(normalized, '', restoreCursor ?? undefined);
    }, {
      onUpdate: () => {
        emittedTokensRef.current = normalized;
        if (restoreCursor !== null) {
          appliedSelectionRestoreRevisionRef.current = selectionRestore?.revision ?? null;
        }
        syncingFromPropsRef.current = false;
      },
    });
  }, [editor, selectionRestore, tokens]);

  React.useEffect(() => {
    handleRef.current = {
      focus: () => editor.focus(),
      getPlainTextSelection: () => editor.getEditorState().read(() => {
        const currentTokens = $readComposerTokens();
        const serialized = serializeChatComposerTokens(currentTokens);
        const range = $currentComposerSelectionRange(currentTokens);
        return {
          text: serialized.text,
          start: serializedChatComposerTextPosition(currentTokens, range.start),
          end: serializedChatComposerTextPosition(currentTokens, range.end),
        };
      }),
      insertSkill: input => {
        emitLexicalInsertion(editor, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange, stableSlashCommands, [
          {
            type: 'skill',
            id: createTokenId('skill'),
            command: input.command,
            label: input.label,
          },
          {type: 'text', text: ' '},
        ]);
      },
      insertFile: input => {
        emitLexicalInsertion(editor, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange, stableSlashCommands, [
          {
            type: 'file',
            id: createTokenId('file'),
            path: input.path,
            name: input.name,
            label: '',
          },
          {type: 'text', text: ' '},
        ]);
      },
      insertText: text => {
        if (!text) {
          return;
        }
        editor.update(() => {
          $setSelectedComposerCapsule('');
          $insertComposerPlainText(text);
        });
      },
      selectToken: id => {
        editor.update(() => {
          $setSelectedComposerCapsule(id);
        }, {discrete: true});
      },
      deleteSelectedCapsule: () => {
        editor.update(() => {
          const selected = $getSelectedComposerCapsuleId();
          if (!selected) {
            return;
          }
          const deletion = $deleteComposerTokenByIdAtBoundary(selected);
          queueComposerEmission(deletion, tokensRef, emittedTokensRef, pendingEmissionRef);
        }, {discrete: true});
      },
    };
  }, [editor, handleRef, onPlainTextChange, onTokensChange, stableSlashCommands]);

  React.useEffect(() => {
    return editor.registerCommand<KeyboardEvent>(
      KEY_BACKSPACE_COMMAND,
      event => {
        const selected = $getSelectedComposerCapsuleId();
        if (!selected) {
          const deletion = $deleteComposerCapsuleForCharacterDeletion(true, {includeRange: false});
          if (!deletion) {
            skipNextRangeCharacterDeleteRef.current = true;
            return false;
          }
          event.preventDefault();
          queueComposerEmission(deletion, tokensRef, emittedTokensRef, pendingEmissionRef);
          return true;
        }
        event.preventDefault();
        queueComposerEmission(
          $deleteComposerTokenByIdAtBoundary(selected),
          tokensRef,
          emittedTokensRef,
          pendingEmissionRef,
        );
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  React.useEffect(() => {
    return editor.registerCommand<KeyboardEvent>(
      KEY_DELETE_COMMAND,
      event => {
        const selected = $getSelectedComposerCapsuleId();
        if (!selected) {
          const deletion = $deleteComposerCapsuleForCharacterDeletion(false, {includeRange: false});
          if (!deletion) {
            skipNextRangeCharacterDeleteRef.current = true;
            return false;
          }
          event.preventDefault();
          queueComposerEmission(deletion, tokensRef, emittedTokensRef, pendingEmissionRef);
          return true;
        }
        event.preventDefault();
        queueComposerEmission(
          $deleteComposerTokenByIdAtBoundary(selected),
          tokensRef,
          emittedTokensRef,
          pendingEmissionRef,
        );
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  React.useEffect(() => {
    return editor.registerCommand<InputEvent>(
      BEFORE_INPUT_COMMAND,
      event => {
        if (event.inputType !== 'deleteContentBackward' && event.inputType !== 'deleteContentForward') {
          $setSelectedComposerCapsule('');
          return false;
        }
        const deletion = $deleteComposerCapsuleForCharacterDeletion(event.inputType === 'deleteContentBackward');
        if (!deletion) {
          return false;
        }
        event.preventDefault();
        queueComposerEmission(deletion, tokensRef, emittedTokensRef, pendingEmissionRef);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  React.useEffect(() => {
    return editor.registerCommand<boolean>(
      DELETE_CHARACTER_COMMAND,
      isBackward => {
        if (skipNextRangeCharacterDeleteRef.current) {
          skipNextRangeCharacterDeleteRef.current = false;
          const selection = $getSelection();
          if ($isRangeSelection(selection) && !selection.isCollapsed()) {
            return false;
          }
        }
        const deletion = $deleteComposerCapsuleForCharacterDeletion(isBackward);
        if (!deletion) {
          return false;
        }
        queueComposerEmission(deletion, tokensRef, emittedTokensRef, pendingEmissionRef);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);

  const handleMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[data-chat-composer-capsule="true"]')
        : null;
      if (!target) {
        editor.update(() => {
          $setSelectedComposerCapsule('');
        }, {discrete: true});
        return;
      }
      const tokenId = target.dataset.tokenId ?? '';
      if (!tokenId) {
        return;
      }
      event.preventDefault();
      editor.update(() => {
        $setSelectedComposerCapsule(tokenId);
      }, {discrete: true});
    },
    [editor],
  );

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      onPaste?.(event);
      if (event.defaultPrevented || readOnly) {
        return;
      }
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text) {
        return;
      }
      event.preventDefault();
      editor.update(() => {
        $setSelectedComposerCapsule('');
        $insertComposerPlainText(text);
      });
    },
    [editor, onPaste, readOnly],
  );

  const handleChange = React.useCallback(() => {
    if (syncingFromPropsRef.current) {
      return;
    }
    editor.getEditorState().read(() => {
      const currentTokens = $readComposerTokens();
      if (chatComposerTokensEqual(currentTokens, emittedTokensRef.current)) {
        tokensRef.current = currentTokens;
        return;
      }
      const cursor = $currentComposerPosition(currentTokens);
      tokensRef.current = currentTokens;
      emittedTokensRef.current = currentTokens;
      onTokensChange(currentTokens);
      const serialized = serializeChatComposerTokens(currentTokens);
      onPlainTextChange?.(serialized.text, serializedChatComposerTextPosition(currentTokens, cursor));
    });
  }, [editor, onPlainTextChange, onTokensChange]);

  return (
    <>
      <EditorRefPlugin editorRef={editorRef} />
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            className={`chat-rich-composer ${className}`.trim()}
            role="textbox"
            aria-label={placeholder}
            aria-multiline="true"
            enterKeyHint={enterKeyHint}
            onMouseDown={handleMouseDown}
            onKeyDownCapture={onKeyDown}
            onPaste={handlePaste}
          />
        }
        placeholder={
          <div className="chat-rich-composer-placeholder" aria-hidden="true">
            {placeholder}
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <OnChangePlugin
        ignoreSelectionChange
        onChange={handleChange}
      />
    </>
  );
}

function emitLexicalInsertion(
  editor: LexicalEditor,
  tokensRef: React.MutableRefObject<ChatComposerToken[]>,
  emittedTokensRef: React.MutableRefObject<ChatComposerToken[]>,
  onTokensChange: (tokens: ChatComposerToken[]) => void,
  onPlainTextChange: ((text: string, cursor: number) => void) | undefined,
  slashCommands: {command: string; label: string}[],
  insertedTokens: ChatComposerToken[],
): void {
  let emitted: ChatComposerToken[] | null = null;
  let emittedCursor = 0;
  editor.update(() => {
    const insertion = $insertComposerTokens(insertedTokens, slashCommands);
    const nextTokens = insertion.tokens;
    tokensRef.current = nextTokens;
    emittedTokensRef.current = nextTokens;
    emitted = nextTokens;
    emittedCursor = insertion.cursor;
  });
  if (emitted) {
    onTokensChange(emitted);
    const serialized = serializeChatComposerTokens(emitted);
    onPlainTextChange?.(serialized.text, serializedChatComposerTextPosition(emitted, emittedCursor));
  }
}

function queueComposerEmission(
  deletion: ChatComposerTokenDeletionResult,
  tokensRef: React.MutableRefObject<ChatComposerToken[]>,
  emittedTokensRef: React.MutableRefObject<ChatComposerToken[]>,
  pendingEmissionRef: React.MutableRefObject<ChatComposerTokenDeletionResult | null>,
): void {
  tokensRef.current = deletion.tokens;
  emittedTokensRef.current = deletion.tokens;
  pendingEmissionRef.current = deletion;
}

function emitComposerCallbacks(
  deletion: ChatComposerTokenDeletionResult,
  onTokensChange: (tokens: ChatComposerToken[]) => void,
  onPlainTextChange: ((text: string, cursor: number) => void) | undefined,
): void {
  const serialized = serializeChatComposerTokens(deletion.tokens);
  onTokensChange(deletion.tokens);
  onPlainTextChange?.(serialized.text, serializedChatComposerTextPosition(deletion.tokens, deletion.cursor));
}

function createTokenId(kind: string): string {
  nextTokenId += 1;
  return `${kind}:${Date.now()}:${nextTokenId}`;
}

function chatComposerTokensEqual(left: ChatComposerToken[], right: ChatComposerToken[]): boolean {
  const normalizedLeft = normalizeChatComposerTokens(left);
  const normalizedRight = normalizeChatComposerTokens(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((token, index) => chatComposerTokenEqual(token, normalizedRight[index]));
}

function chatComposerTokenEqual(left: ChatComposerToken, right: ChatComposerToken | undefined): boolean {
  if (!right || left.type !== right.type) {
    return false;
  }
  if (left.type === 'text' && right.type === 'text') {
    return left.text === right.text;
  }
  if (left.type === 'skill' && right.type === 'skill') {
    return left.id === right.id && left.command === right.command && left.label === right.label;
  }
  return left.type === 'file' &&
    right.type === 'file' &&
    left.id === right.id &&
    left.path === right.path &&
    left.name === right.name &&
    left.label === right.label;
}
