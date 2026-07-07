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
  COMMAND_PRIORITY_LOW,
  DELETE_CHARACTER_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from 'lexical';

import {
  chatComposerTokenUnitLength,
  normalizeChatComposerTokens,
  serializeChatComposerTokens,
  serializedChatComposerTextPosition,
  type ChatComposerFileToken,
  type ChatComposerSkillToken,
  type ChatComposerToken,
} from './chatComposerTokens';
import {
  deleteChatComposerTokenById,
  type ChatComposerTokenDeletionResult,
} from './chatComposerTokenEditing';
import {
  $currentComposerPosition,
  $deleteComposerCapsuleForCharacterDeletion,
  $deleteComposerTokenById,
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
  insertSkill: (input: Pick<ChatComposerSkillToken, 'command' | 'label'>) => void;
  insertFile: (input: Pick<ChatComposerFileToken, 'path' | 'name'>) => void;
  insertText: (text: string) => void;
  selectToken: (id: string) => void;
  deleteSelectedCapsule: () => void;
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
};

let nextTokenId = 1;

export const ChatRichComposer = React.forwardRef<ChatRichComposerHandle, ChatRichComposerProps>(
  function ChatRichComposer(props, ref) {
    const initialTokensRef = React.useRef(normalizeChatComposerTokens(props.tokens));
    const editorRef = React.useRef<LexicalEditor | null>(null);
    const handleRef = React.useRef<ChatRichComposerHandle>({
      focus: () => undefined,
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
  editorRef,
  handleRef,
}: ChatRichComposerContentProps): React.ReactElement {
  const [editor] = useLexicalComposerContext();
  const selectedTokenIdRef = React.useRef('');
  const emittedTokensRef = React.useRef<ChatComposerToken[]>(normalizeChatComposerTokens(tokens));
  const tokensRef = React.useRef<ChatComposerToken[]>(normalizeChatComposerTokens(tokens));
  const syncingFromPropsRef = React.useRef(false);
  const skipNextRangeCharacterDeleteRef = React.useRef(false);
  const [selectedTokenId, setSelectedTokenId] = React.useState('');

  React.useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  React.useEffect(() => {
    return registerComposerSlashCommandTransform(editor, slashCommands);
  }, [editor, slashCommands]);

  React.useEffect(() => {
    const normalized = normalizeChatComposerTokens(tokens);
    tokensRef.current = normalized;
    const editorTokens = editor.getEditorState().read(() => $readComposerTokens());
    if (chatComposerTokensEqual(normalized, editorTokens)) {
      emittedTokensRef.current = normalized;
      return;
    }
    syncingFromPropsRef.current = true;
    editor.update(() => {
      $setComposerTokens(normalized, selectedTokenIdRef.current);
    }, {
      onUpdate: () => {
        emittedTokensRef.current = normalized;
        syncingFromPropsRef.current = false;
      },
    });
  }, [editor, tokens]);

  React.useEffect(() => {
    selectedTokenIdRef.current = selectedTokenId;
    editor.update(() => {
      $setSelectedComposerCapsule(selectedTokenId);
    });
  }, [editor, selectedTokenId]);

  React.useEffect(() => {
    handleRef.current = {
      focus: () => editor.focus(),
      insertSkill: input => {
        emitLexicalInsertion(editor, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange, slashCommands, [
          {
            type: 'skill',
            id: createTokenId('skill'),
            command: input.command,
            label: input.label,
          },
          {type: 'text', text: ' '},
        ]);
        setSelectedTokenId('');
      },
      insertFile: input => {
        emitLexicalInsertion(editor, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange, slashCommands, [
          {
            type: 'file',
            id: createTokenId('file'),
            path: input.path,
            name: input.name,
            label: '',
          },
          {type: 'text', text: ' '},
        ]);
        setSelectedTokenId('');
      },
      insertText: text => {
        if (!text) {
          return;
        }
        editor.update(() => {
          $insertComposerPlainText(text);
        });
        setSelectedTokenId('');
      },
      selectToken: id => {
        selectedTokenIdRef.current = id;
        setSelectedTokenId(id);
      },
      deleteSelectedCapsule: () => {
        const selected = selectedTokenIdRef.current;
        if (!selected) {
          return;
        }
        const nextTokens = deleteChatComposerTokenById(tokensRef.current, selected);
        tokensRef.current = nextTokens;
        emittedTokensRef.current = nextTokens;
        const serialized = serializeChatComposerTokens(nextTokens);
        onTokensChange(nextTokens);
        onPlainTextChange?.(serialized.text, serializedChatComposerTextPosition(nextTokens, chatComposerTokenUnitLength(nextTokens)));
        setSelectedTokenId('');
        editor.update(() => {
          $setComposerTokens(nextTokens, '', chatComposerTokenUnitLength(nextTokens));
        });
      },
    };
  }, [editor, handleRef, onPlainTextChange, onTokensChange, slashCommands]);

  React.useEffect(() => {
    return editor.registerCommand<KeyboardEvent>(
      KEY_BACKSPACE_COMMAND,
      event => {
        if (!selectedTokenIdRef.current) {
          const deletion = $deleteComposerCapsuleForCharacterDeletion(true, {includeRange: false});
          if (!deletion) {
            skipNextRangeCharacterDeleteRef.current = true;
            return false;
          }
          event.preventDefault();
          emitComposerDeletion(deletion, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange);
          setSelectedTokenId('');
          return true;
        }
        event.preventDefault();
        deleteComposerToken(editor, selectedTokenIdRef.current, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange);
        setSelectedTokenId('');
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onPlainTextChange, onTokensChange]);

  React.useEffect(() => {
    return editor.registerCommand<KeyboardEvent>(
      KEY_DELETE_COMMAND,
      event => {
        if (!selectedTokenIdRef.current) {
          const deletion = $deleteComposerCapsuleForCharacterDeletion(false, {includeRange: false});
          if (!deletion) {
            skipNextRangeCharacterDeleteRef.current = true;
            return false;
          }
          event.preventDefault();
          emitComposerDeletion(deletion, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange);
          setSelectedTokenId('');
          return true;
        }
        event.preventDefault();
        deleteComposerToken(editor, selectedTokenIdRef.current, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange);
        setSelectedTokenId('');
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onPlainTextChange, onTokensChange]);

  React.useEffect(() => {
    return editor.registerCommand<InputEvent>(
      BEFORE_INPUT_COMMAND,
      event => {
        if (event.inputType !== 'deleteContentBackward' && event.inputType !== 'deleteContentForward') {
          return false;
        }
        const deletion = $deleteComposerCapsuleForCharacterDeletion(event.inputType === 'deleteContentBackward');
        if (!deletion) {
          return false;
        }
        event.preventDefault();
        emitComposerDeletion(deletion, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange);
        setSelectedTokenId('');
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onPlainTextChange, onTokensChange]);

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
        emitComposerDeletion(deletion, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange);
        setSelectedTokenId('');
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onPlainTextChange, onTokensChange]);

  React.useEffect(() => {
    return editor.registerCommand<KeyboardEvent>(
      KEY_BACKSPACE_COMMAND,
      () => {
        setSelectedTokenId('');
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);

  const handleMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[data-chat-composer-capsule="true"]')
        : null;
      if (!target) {
        setSelectedTokenId('');
        return;
      }
      const tokenId = target.dataset.tokenId ?? '';
      if (!tokenId) {
        return;
      }
      event.preventDefault();
      setSelectedTokenId(tokenId);
    },
    [],
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
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <OnChangePlugin
        ignoreSelectionChange
        onChange={handleChange}
      />
      <span className="chat-rich-composer-placeholder" aria-hidden="true">
        {placeholder}
      </span>
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

function deleteComposerToken(
  editor: LexicalEditor,
  tokenId: string,
  tokensRef: React.MutableRefObject<ChatComposerToken[]>,
  emittedTokensRef: React.MutableRefObject<ChatComposerToken[]>,
  onTokensChange: (tokens: ChatComposerToken[]) => void,
  onPlainTextChange: ((text: string, cursor: number) => void) | undefined,
): void {
  let nextTokens: ChatComposerToken[] = [];
  let cursor = 0;
  editor.update(() => {
    nextTokens = $deleteComposerTokenById(tokenId);
    cursor = $currentComposerPosition(nextTokens);
  });
  emitComposerDeletion({tokens: nextTokens, cursor}, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange);
}

function emitComposerDeletion(
  deletion: ChatComposerTokenDeletionResult,
  tokensRef: React.MutableRefObject<ChatComposerToken[]>,
  emittedTokensRef: React.MutableRefObject<ChatComposerToken[]>,
  onTokensChange: (tokens: ChatComposerToken[]) => void,
  onPlainTextChange: ((text: string, cursor: number) => void) | undefined,
): void {
  tokensRef.current = deletion.tokens;
  emittedTokensRef.current = deletion.tokens;
  onTokensChange(deletion.tokens);
  const serialized = serializeChatComposerTokens(deletion.tokens);
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
