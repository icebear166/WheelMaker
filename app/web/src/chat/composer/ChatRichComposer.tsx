import {LexicalComposer} from '@lexical/react/LexicalComposer';
import {useLexicalComposerContext} from '@lexical/react/LexicalComposerContext';
import {ContentEditable} from '@lexical/react/LexicalContentEditable';
import {EditorRefPlugin} from '@lexical/react/LexicalEditorRefPlugin';
import {LexicalErrorBoundary} from '@lexical/react/LexicalErrorBoundary';
import {HistoryPlugin} from '@lexical/react/LexicalHistoryPlugin';
import {OnChangePlugin} from '@lexical/react/LexicalOnChangePlugin';
import {RichTextPlugin} from '@lexical/react/LexicalRichTextPlugin';
import React from 'react';
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from 'lexical';

import {
  chatComposerTokenUnitLength,
  normalizeChatComposerTokens,
  serializeChatComposerTokens,
  serializedChatComposerTextPosition,
  tokenizeKnownChatSlashCommands,
  type ChatComposerFileToken,
  type ChatComposerSkillToken,
  type ChatComposerToken,
} from './chatComposerTokens';
import {
  chatComposerCapsuleAfterPosition,
  chatComposerCapsuleBeforePosition,
  deleteChatComposerTokenById,
  insertChatComposerTokens,
} from './chatComposerTokenEditing';
import {
  $currentComposerPosition,
  $readComposerTokens,
  $setComposerTokens,
  $setSelectedComposerCapsule,
  ChatComposerCapsuleNode,
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
  onSend?: () => void;
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
  onSend,
  editorRef,
  handleRef,
}: ChatRichComposerContentProps): React.ReactElement {
  const [editor] = useLexicalComposerContext();
  const selectedTokenIdRef = React.useRef('');
  const emittedTokensRef = React.useRef<ChatComposerToken[]>(normalizeChatComposerTokens(tokens));
  const tokensRef = React.useRef<ChatComposerToken[]>(normalizeChatComposerTokens(tokens));
  const syncingFromPropsRef = React.useRef(false);
  const [selectedTokenId, setSelectedTokenId] = React.useState('');

  React.useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  React.useEffect(() => {
    const normalized = normalizeChatComposerTokens(tokens);
    tokensRef.current = normalized;
    if (chatComposerTokensEqual(normalized, emittedTokensRef.current)) {
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
        insertComposerTokens(editor, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange, slashCommands, [
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
        insertComposerTokens(editor, tokensRef, emittedTokensRef, onTokensChange, onPlainTextChange, slashCommands, [
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
        insertPlainText(editor, text);
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
      KEY_ENTER_COMMAND,
      event => {
        onKeyDown?.(reactKeyboardEventFromNative(event));
        if (event.defaultPrevented) {
          return true;
        }
        if (!event.shiftKey && !event.altKey && !event.isComposing) {
          event.preventDefault();
          onSend?.();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onKeyDown, onSend]);

  React.useEffect(() => {
    return editor.registerCommand<KeyboardEvent>(
      KEY_BACKSPACE_COMMAND,
      event => {
        if (!selectedTokenIdRef.current) {
          const currentTokens = tokensRef.current;
          const removable = chatComposerCapsuleBeforePosition(
            currentTokens,
            editor.getEditorState().read(() => $currentComposerPosition(currentTokens)),
          );
          if (!removable) {
            return false;
          }
          event.preventDefault();
          deleteComposerToken(editor, removable.id, tokensRef, emittedTokensRef, onTokensChange);
          setSelectedTokenId('');
          return true;
        }
        event.preventDefault();
        deleteComposerToken(editor, selectedTokenIdRef.current, tokensRef, emittedTokensRef, onTokensChange);
        setSelectedTokenId('');
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onTokensChange]);

  React.useEffect(() => {
    return editor.registerCommand<KeyboardEvent>(
      KEY_DELETE_COMMAND,
      event => {
        if (!selectedTokenIdRef.current) {
          const currentTokens = tokensRef.current;
          const removable = chatComposerCapsuleAfterPosition(
            currentTokens,
            editor.getEditorState().read(() => $currentComposerPosition(currentTokens)),
          );
          if (!removable) {
            return false;
          }
          event.preventDefault();
          deleteComposerToken(editor, removable.id, tokensRef, emittedTokensRef, onTokensChange);
          setSelectedTokenId('');
          return true;
        }
        event.preventDefault();
        deleteComposerToken(editor, selectedTokenIdRef.current, tokensRef, emittedTokensRef, onTokensChange);
        setSelectedTokenId('');
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onTokensChange]);

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
      insertPlainText(editor, text);
    },
    [editor, onPaste, readOnly],
  );

  const handleChange = React.useCallback(() => {
    if (syncingFromPropsRef.current) {
      return;
    }
    editor.getEditorState().read(() => {
      const currentTokens = tokenizeTextTokens($readComposerTokens(), slashCommands);
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
  }, [editor, onPlainTextChange, onTokensChange, slashCommands]);

  return (
    <>
      <EditorRefPlugin editorRef={editorRef} />
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            className={`chat-rich-composer ${className}`.trim()}
            role="textbox"
            aria-label={placeholder}
            aria-multiline="true"
            enterKeyHint={enterKeyHint}
            onMouseDown={handleMouseDown}
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

function tokenizeTextTokens(
  tokens: ChatComposerToken[],
  slashCommands: {command: string; label: string}[],
): ChatComposerToken[] {
  if (slashCommands.length === 0) {
    return normalizeChatComposerTokens(tokens);
  }
  return normalizeChatComposerTokens(tokens.flatMap(token => {
    if (token.type !== 'text') {
      return [token];
    }
    return tokenizeKnownChatSlashCommands(token.text, slashCommands);
  }));
}

function insertComposerTokens(
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
    const current = $readComposerTokens();
    const sourceTokens = current.length > 0 ? current : tokensRef.current;
    const position = $currentComposerPosition(sourceTokens);
    const insertion = insertChatComposerTokens(sourceTokens, position, insertedTokens);
    const nextTokens = tokenizeTextTokens(insertion.tokens, slashCommands);
    tokensRef.current = nextTokens;
    emittedTokensRef.current = nextTokens;
    emitted = nextTokens;
    emittedCursor = insertion.cursor;
    $setComposerTokens(nextTokens, '', insertion.cursor);
  });
  if (emitted) {
    onTokensChange(emitted);
    const serialized = serializeChatComposerTokens(emitted);
    onPlainTextChange?.(serialized.text, serializedChatComposerTextPosition(emitted, emittedCursor));
  }
}

function insertPlainText(editor: LexicalEditor, text: string): void {
  editor.update(() => {
    $getSelectionInsertText(text);
  });
}

function $getSelectionInsertText(text: string): void {
  const node = $createTextNode(text);
  const lexicalSelection = $getSelection();
  if ($isRangeSelection(lexicalSelection)) {
    lexicalSelection.insertNodes([node]);
    return;
  }
  const currentTokens = $readComposerTokens();
  const nextTokens = normalizeChatComposerTokens([...currentTokens, {type: 'text', text}]);
  $setComposerTokens(nextTokens, '', chatComposerTokenUnitLength(nextTokens));
}

function deleteComposerToken(
  editor: LexicalEditor,
  tokenId: string,
  tokensRef: React.MutableRefObject<ChatComposerToken[]>,
  emittedTokensRef: React.MutableRefObject<ChatComposerToken[]>,
  onTokensChange: (tokens: ChatComposerToken[]) => void,
): void {
  const nextTokens = deleteChatComposerTokenById(tokensRef.current, tokenId);
  tokensRef.current = nextTokens;
  emittedTokensRef.current = nextTokens;
  onTokensChange(nextTokens);
  editor.update(() => {
    $setComposerTokens(nextTokens, '', chatComposerTokenUnitLength(nextTokens));
  });
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

function reactKeyboardEventFromNative(event: KeyboardEvent): React.KeyboardEvent<HTMLDivElement> {
  return event as unknown as React.KeyboardEvent<HTMLDivElement>;
}
