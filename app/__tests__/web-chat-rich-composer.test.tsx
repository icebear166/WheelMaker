import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {EditorRefPlugin} from '@lexical/react/LexicalEditorRefPlugin';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  DELETE_CHARACTER_COMMAND,
  KEY_BACKSPACE_COMMAND,
  createEditor,
} from 'lexical';
import {
  ChatRichComposer,
  type ChatRichComposerHandle,
} from '../web/src/chat/composer/ChatRichComposer';
import {
  $currentComposerPosition,
  $deleteComposerTokenById,
  $insertComposerPlainText,
  $insertComposerTokens,
  $readComposerTokens,
  $setComposerTokens,
  ChatComposerCapsuleNode,
  chatComposerTokensFromLexicalNodesForTest,
  lexicalNodesFromChatComposerTokensForTest,
  registerComposerSlashCommandTransform,
} from '../web/src/chat/composer/chatComposerLexicalModel';
import {
  serializeChatComposerTokens,
  type ChatComposerToken,
} from '../web/src/chat/composer/chatComposerTokens';

describe('ChatRichComposer', () => {
  const originalNode = global.Node;

  beforeAll(() => {
    (global as typeof global & {Node: typeof Node}).Node = {
      TEXT_NODE: 3,
      ELEMENT_NODE: 1,
    } as typeof Node;
  });

  afterAll(() => {
    (global as typeof global & {Node: typeof Node}).Node = originalNode;
  });

  test('round-trips composer text and capsule tokens through the Lexical model', () => {
    const tokens: ChatComposerToken[] = [
      {type: 'text', text: 'ask '},
      {type: 'skill', id: 's1', command: '/review', label: 'Review'},
      {type: 'text', text: ' about '},
      {type: 'file', id: 'f1', path: 'app/a.ts', name: 'a.ts', label: 'a.ts'},
    ];

    expect(chatComposerTokensFromLexicalNodesForTest(lexicalNodesFromChatComposerTokensForTest(tokens))).toEqual(tokens);
  });

  test('renders placeholder outside the editable selection surface', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer tokens={[]} onTokensChange={jest.fn()} readOnly={false} />,
      );
    });

    const textbox = renderer!.root.findByProps({role: 'textbox'});
    expect(textbox.props['data-placeholder']).toBeUndefined();
    expect(textbox.props['data-empty']).toBeUndefined();

    const placeholder = renderer!.root.findByProps({className: 'chat-rich-composer-placeholder'});
    expect(placeholder.props['aria-hidden']).toBe('true');
    expect(placeholder.children).toEqual(['Send a message...']);
  });

  test('delegates text input and composition ownership to Lexical', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer tokens={[]} onTokensChange={jest.fn()} readOnly={false} />,
      );
    });

    const textbox = renderer!.root.findByProps({role: 'textbox'});
    expect(textbox.props.onBeforeInput).toBeUndefined();
    expect(textbox.props.onInput).toBeUndefined();
    expect(textbox.props.onCompositionStart).toBeUndefined();
    expect(textbox.props.onCompositionEnd).toBeUndefined();
  });

  test('wires parent keyboard handling to the editable capture phase', async () => {
    const onKeyDown = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer tokens={[]} onTokensChange={jest.fn()} onKeyDown={onKeyDown} readOnly={false} />,
      );
    });

    const textbox = renderer!.root.findByProps({role: 'textbox'});
    expect(textbox.props.onKeyDownCapture).toBe(onKeyDown);
    expect(textbox.props.onKeyDown).toBeUndefined();
  });

  test('transforms typed slash commands inside Lexical state and keeps following text editable', () => {
    const editor = createEditor({
      namespace: 'WheelMakerChatComposerTest',
      nodes: [ChatComposerCapsuleNode],
      onError(error) {
        throw error;
      },
    });
    const unregister = registerComposerSlashCommandTransform(editor, [
      {command: '/grill-me', label: 'Grill Me'},
    ]);

    editor.update(() => {
      $setComposerTokens([]);
      $insertComposerPlainText('/grill-me');
    }, {discrete: true});

    expect(editor.getEditorState().read(() => $readComposerTokens())).toEqual([
      {type: 'skill', id: expect.any(String), command: '/grill-me', label: 'Grill Me'},
    ]);

    editor.update(() => {
      $insertComposerPlainText(' next');
    }, {discrete: true});

    expect(editor.getEditorState().read(() => $readComposerTokens())).toEqual([
      {type: 'skill', id: expect.any(String), command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' next'},
    ]);

    unregister();
  });

  test('reads every Lexical paragraph as newline-separated composer text', () => {
    const editor = createEditor({
      namespace: 'WheelMakerChatComposerTest',
      nodes: [ChatComposerCapsuleNode],
      onError(error) {
        throw error;
      },
    });

    editor.update(() => {
      const root = $getRoot();
      root.clear();
      root.append(
        $createParagraphNode().append($createTextNode('line one')),
        $createParagraphNode().append($createTextNode('line two')),
        $createParagraphNode().append($createTextNode('line three')),
      );
    }, {discrete: true});

    expect(editor.getEditorState().read(() => $readComposerTokens())).toEqual([
      {type: 'text', text: 'line one\nline two\nline three'},
    ]);
  });

  test('inserts composer tokens at the cursor inside later Lexical paragraphs', () => {
    const editor = createEditor({
      namespace: 'WheelMakerChatComposerTest',
      nodes: [ChatComposerCapsuleNode],
      onError(error) {
        throw error;
      },
    });

    editor.update(() => {
      const root = $getRoot();
      const secondLine = $createTextNode('second');
      root.clear();
      root.append(
        $createParagraphNode().append($createTextNode('first')),
        $createParagraphNode().append(secondLine),
      );
      secondLine.select(2);
      expect($currentComposerPosition($readComposerTokens())).toBe('first\nse'.length);
      expect($insertComposerTokens([
        {type: 'skill', id: 'skill:review', command: '/review', label: 'Review'},
      ], []).tokens).toEqual([
        {type: 'text', text: 'first\nse'},
        {type: 'skill', id: 'skill:review', command: '/review', label: 'Review'},
        {type: 'text', text: 'cond'},
      ]);
    }, {discrete: true});
  });

  test('keeps the cursor at the removed capsule boundary', () => {
    const editor = createEditor({
      namespace: 'WheelMakerChatComposerTest',
      nodes: [ChatComposerCapsuleNode],
      onError(error) {
        throw error;
      },
    });
    const tokens: ChatComposerToken[] = [
      {type: 'skill', id: 's1', command: '/review', label: 'Review'},
      {type: 'text', text: ' hello'},
    ];

    editor.update(() => {
      $setComposerTokens(tokens, '', 1);
      expect($currentComposerPosition($readComposerTokens())).toBe(1);
      expect($deleteComposerTokenById('s1')).toEqual([{type: 'text', text: ' hello'}]);
      expect($currentComposerPosition($readComposerTokens())).toBe(0);
    }, {discrete: true});
  });

  test('input-method delete across a capsule range removes only the capsule', async () => {
    const onTokensChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    const tokens: ChatComposerToken[] = [
      {type: 'skill', id: 's1', command: '/review', label: 'Review'},
      {type: 'text', text: ' hello'},
    ];

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer tokens={tokens} onTokensChange={onTokensChange} readOnly={false} />,
      );
    });

    const editorRefPlugin = renderer!.root.findByType(EditorRefPlugin);
    const editor = editorRefPlugin.props.editorRef.current;
    expect(editor).toBeTruthy();

    await ReactTestRenderer.act(() => {
      editor.update(() => {
        $setComposerTokens(tokens, '', 0);
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          throw new Error('expected range selection');
        }
        const paragraph = selection.anchor.getNode().getTopLevelElementOrThrow();
        const children = paragraph.getChildren();
        const text = children[1];
        selection.anchor.set(paragraph.getKey(), 0, 'element');
        selection.focus.set(text.getKey(), ' hello'.length, 'text');
      }, {discrete: true});
    });

    await ReactTestRenderer.act(() => {
      editor.dispatchCommand(DELETE_CHARACTER_COMMAND, true);
    });

    expect(editor.getEditorState().read(() => $readComposerTokens())).toEqual([
      {type: 'text', text: ' hello'},
    ]);
    expect(onTokensChange).toHaveBeenLastCalledWith([
      {type: 'text', text: ' hello'},
    ]);
  });

  test('hardware backspace still removes an explicit selected range', async () => {
    const onTokensChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    const tokens: ChatComposerToken[] = [
      {type: 'skill', id: 's1', command: '/review', label: 'Review'},
      {type: 'text', text: ' hello'},
    ];

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer tokens={tokens} onTokensChange={onTokensChange} readOnly={false} />,
      );
    });

    const editorRefPlugin = renderer!.root.findByType(EditorRefPlugin);
    const editor = editorRefPlugin.props.editorRef.current;
    expect(editor).toBeTruthy();

    await ReactTestRenderer.act(() => {
      editor.update(() => {
        $setComposerTokens(tokens, '', 0);
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          throw new Error('expected range selection');
        }
        const paragraph = selection.anchor.getNode().getTopLevelElementOrThrow();
        const children = paragraph.getChildren();
        const text = children[1];
        selection.anchor.set(paragraph.getKey(), 0, 'element');
        selection.focus.set(text.getKey(), ' hello'.length, 'text');
      }, {discrete: true});
    });

    await ReactTestRenderer.act(() => {
      editor.dispatchCommand(KEY_BACKSPACE_COMMAND, {preventDefault: jest.fn()} as unknown as KeyboardEvent);
    });

    expect(editor.getEditorState().read(() => $readComposerTokens())).toEqual([]);
    expect(onTokensChange).toHaveBeenLastCalledWith([]);
  });

  test('pastes rich clipboard links as their plain-text URL', async () => {
    const onTokensChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer tokens={[]} onTokensChange={onTokensChange} readOnly={false} />,
      );
    });

    const textbox = renderer!.root.findByProps({role: 'textbox'});
    const preventDefault = jest.fn();

    await ReactTestRenderer.act(() => {
      textbox.props.onPaste({
        clipboardData: {
          getData: (type: string) => {
            if (type === 'text/plain') {
              return 'https://example.com/docs?x=1#intro';
            }
            if (type === 'text/html') {
              return '<a href="https://example.com/docs?x=1#intro">Example Docs</a>';
            }
            return '';
          },
        },
        defaultPrevented: false,
        preventDefault,
      });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onTokensChange).toHaveBeenLastCalledWith([
      {type: 'text', text: 'https://example.com/docs?x=1#intro'},
    ]);
  });

  test('leaves paste untouched after parent paste handler prevents default', async () => {
    const onTokensChange = jest.fn();
    const onPaste = jest.fn(event => {
      event.preventDefault();
      event.defaultPrevented = true;
    });
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer
          tokens={[]}
          onTokensChange={onTokensChange}
          onPaste={onPaste}
          readOnly={false}
        />,
      );
    });

    const textbox = renderer!.root.findByProps({role: 'textbox'});
    const preventDefault = jest.fn();

    await ReactTestRenderer.act(() => {
      textbox.props.onPaste({
        clipboardData: {
          getData: () => 'https://example.com/',
        },
        defaultPrevented: false,
        preventDefault,
      });
    });

    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onTokensChange).not.toHaveBeenCalled();
  });

  test('does not paste plain text while read only', async () => {
    const onTokensChange = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer tokens={[]} onTokensChange={onTokensChange} readOnly={true} />,
      );
    });

    const textbox = renderer!.root.findByProps({role: 'textbox'});
    const preventDefault = jest.fn();

    await ReactTestRenderer.act(() => {
      textbox.props.onPaste({
        clipboardData: {
          getData: () => 'https://example.com/',
        },
        defaultPrevented: false,
        preventDefault,
      });
    });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onTokensChange).not.toHaveBeenCalled();
  });

  test('imperative insertion appends file and skill tokens', async () => {
    const onTokensChange = jest.fn();
    const ref = React.createRef<ChatRichComposerHandle>();

    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ChatRichComposer
          ref={ref}
          tokens={[{type: 'text', text: 'check '}]}
          onTokensChange={onTokensChange}
          readOnly={false}
        />,
      );
    });

    await ReactTestRenderer.act(() => {
      ref.current!.insertSkill({command: '/grill-me', label: 'Grill Me'});
      ref.current!.insertFile({path: 'app/fix_drop.py', name: 'fix_drop.py'});
    });

    expect(onTokensChange).toHaveBeenLastCalledWith([
      {type: 'text', text: 'check '},
      {type: 'skill', id: expect.any(String), command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' '},
      {type: 'file', id: expect.any(String), path: 'app/fix_drop.py', name: 'fix_drop.py', label: ''},
      {type: 'text', text: ' '},
    ]);
  });

  test('keeps imperative text, skill, file, and capsule deletion working together', async () => {
    const onTokensChange = jest.fn();
    const ref = React.createRef<ChatRichComposerHandle>();
    const StatefulComposer = () => {
      const [tokens, setTokens] = React.useState<ChatComposerToken[]>([]);
      return (
        <ChatRichComposer
          ref={ref}
          tokens={tokens}
          onTokensChange={nextTokens => {
            onTokensChange(nextTokens);
            setTokens(nextTokens);
          }}
          readOnly={false}
        />
      );
    };

    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(<StatefulComposer />);
    });

    await ReactTestRenderer.act(() => {
      ref.current!.insertText('hello');
    });
    expect(onTokensChange).toHaveBeenLastCalledWith([{type: 'text', text: 'hello'}]);

    await ReactTestRenderer.act(() => {
      ref.current!.insertSkill({command: '/review', label: 'Review'});
    });
    expect(onTokensChange).toHaveBeenLastCalledWith([
      {type: 'text', text: 'hello'},
      {type: 'skill', id: expect.any(String), command: '/review', label: 'Review'},
      {type: 'text', text: ' '},
    ]);

    const skillToken = onTokensChange.mock.calls.at(-1)![0][1] as ChatComposerToken;
    await ReactTestRenderer.act(() => {
      ref.current!.insertFile({path: 'app/file.ts', name: 'file.ts'});
      if (skillToken.type !== 'text') {
        ref.current!.selectToken(skillToken.id);
      }
      ref.current!.deleteSelectedCapsule();
    });

    expect(onTokensChange).toHaveBeenLastCalledWith([
      {type: 'text', text: 'hello '},
      {type: 'file', id: expect.any(String), path: 'app/file.ts', name: 'file.ts', label: ''},
      {type: 'text', text: ' '},
    ]);
  });

  test('reports serialized text cursor after replacing an active slash query', async () => {
    const onPlainTextChange = jest.fn();
    const ref = React.createRef<ChatRichComposerHandle>();

    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ChatRichComposer
          ref={ref}
          tokens={[{type: 'text', text: '/gri'}]}
          onTokensChange={jest.fn()}
          onPlainTextChange={onPlainTextChange}
          readOnly={false}
        />,
      );
    });

    await ReactTestRenderer.act(() => {
      ref.current!.insertSkill({command: '/grill-me', label: 'Grill Me'});
    });

    expect(onPlainTextChange).toHaveBeenLastCalledWith('/grill-me ', '/grill-me '.length);
  });

  test('inserts a skill into an empty composer without a leading newline', async () => {
    const onTokensChange = jest.fn();
    const onPlainTextChange = jest.fn();
    const ref = React.createRef<ChatRichComposerHandle>();

    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ChatRichComposer
          ref={ref}
          tokens={[]}
          onTokensChange={onTokensChange}
          onPlainTextChange={onPlainTextChange}
          readOnly={false}
        />,
      );
    });

    await ReactTestRenderer.act(() => {
      ref.current!.insertSkill({command: '/review', label: 'Review'});
    });

    const emittedTokens = onTokensChange.mock.calls.at(-1)![0] as ChatComposerToken[];
    expect(serializeChatComposerTokens(emittedTokens).text).toBe('/review ');
    expect(onPlainTextChange).toHaveBeenLastCalledWith('/review ', '/review '.length);
  });

  test('deleteSelectedCapsule removes the selected token', async () => {
    const onTokensChange = jest.fn();
    const ref = React.createRef<ChatRichComposerHandle>();

    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ChatRichComposer
          ref={ref}
          tokens={[
            {type: 'text', text: 'a '},
            {type: 'file', id: 'f1', path: 'app/a.ts', name: 'a.ts', label: 'a.ts'},
            {type: 'text', text: ' b'},
          ]}
          onTokensChange={onTokensChange}
          readOnly={false}
        />,
      );
    });

    await ReactTestRenderer.act(() => {
      ref.current!.selectToken('f1');
      ref.current!.deleteSelectedCapsule();
    });

    expect(onTokensChange).toHaveBeenLastCalledWith([
      {type: 'text', text: 'a  b'},
    ]);
  });

  test('insertText tokenizes known slash commands into skill capsules', async () => {
    const onTokensChange = jest.fn();
    const ref = React.createRef<ChatRichComposerHandle>();

    await ReactTestRenderer.act(() => {
      ReactTestRenderer.create(
        <ChatRichComposer
          ref={ref}
          tokens={[]}
          onTokensChange={onTokensChange}
          slashCommands={[{command: '/grill-me', label: 'Grill Me'}]}
          readOnly={false}
        />,
      );
    });

    await ReactTestRenderer.act(() => {
      ref.current!.insertText('/grill-me');
    });

    expect(onTokensChange).toHaveBeenLastCalledWith([
      {type: 'skill', id: expect.any(String), command: '/grill-me', label: 'Grill Me'},
    ]);
  });
});
