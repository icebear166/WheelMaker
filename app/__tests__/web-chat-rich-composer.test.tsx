import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  ChatRichComposer,
  type ChatRichComposerHandle,
} from '../web/src/chat/composer/ChatRichComposer';
import type {ChatComposerToken} from '../web/src/chat/composer/chatComposerTokens';

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

  test('keeps the contenteditable root DOM-owned to avoid duplicate browser input', async () => {
    const tokens: ChatComposerToken[] = [
      {type: 'skill', id: 's1', command: '/grill-me', label: 'Grill Me'},
      {type: 'text', text: ' in '},
      {type: 'file', id: 'f1', path: 'app/fix_drop.py', name: 'fix_drop.py', label: 'fix_drop.py'},
    ];
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer tokens={tokens} onTokensChange={jest.fn()} readOnly={false} />,
      );
    });

    const textbox = renderer!.root.findByProps({role: 'textbox'});
    expect(textbox.children).toHaveLength(0);
  });

  test('keeps IME composition DOM local until composition ends', async () => {
    const onTokensChange = jest.fn();
    const composerRoot = createComposerDomRoot();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer
          tokens={[{type: 'text', text: 'ni'}]}
          onTokensChange={onTokensChange}
          readOnly={false}
        />,
        {
          createNodeMock: element => (element.props.role === 'textbox' ? composerRoot : null),
        },
      );
    });

    const textbox = renderer!.root.findByProps({role: 'textbox'});

    await ReactTestRenderer.act(() => {
      textbox.props.onCompositionStart();
      textbox.props.onInput();
    });

    expect(onTokensChange).not.toHaveBeenCalled();

    await ReactTestRenderer.act(() => {
      textbox.props.onCompositionEnd();
    });

    expect(onTokensChange).toHaveBeenCalledTimes(1);
    expect(onTokensChange).toHaveBeenLastCalledWith([{type: 'text', text: 'ni'}]);
  });

  test('keeps placeholder mounted during local composition input before tokens commit', async () => {
    const onTokensChange = jest.fn();
    const composerRoot = createComposerDomRoot();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer tokens={[]} onTokensChange={onTokensChange} readOnly={false} />,
        {
          createNodeMock: element => (element.props.role === 'textbox' ? composerRoot : null),
        },
      );
    });

    expect(renderer!.root.findAllByProps({className: 'chat-rich-composer-placeholder'})).toHaveLength(1);

    await ReactTestRenderer.act(() => {
      textboxAppendText(composerRoot, 'n');
      const textbox = renderer!.root.findByProps({role: 'textbox'});
      textbox.props.onCompositionStart();
      textbox.props.onInput();
    });

    expect(onTokensChange).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByProps({className: 'chat-rich-composer-placeholder'})).toHaveLength(1);
  });

  test('keeps early IME beforeinput local until composition ends', async () => {
    const onTokensChange = jest.fn();
    const composerRoot = createComposerDomRoot();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <ChatRichComposer tokens={[]} onTokensChange={onTokensChange} readOnly={false} />,
        {
          createNodeMock: element => (element.props.role === 'textbox' ? composerRoot : null),
        },
      );
    });

    const textbox = renderer!.root.findByProps({role: 'textbox'});

    expect(textbox.props.onBeforeInput).toEqual(expect.any(Function));

    await ReactTestRenderer.act(() => {
      textbox.props.onBeforeInput({
        nativeEvent: {
          inputType: 'insertCompositionText',
          isComposing: false,
        },
      });
      textboxReplaceText(composerRoot, 'w');
      textbox.props.onInput({
        nativeEvent: {
          inputType: 'insertText',
          isComposing: false,
        },
      });
    });

    expect(onTokensChange).not.toHaveBeenCalled();

    await ReactTestRenderer.act(() => {
      textboxReplaceText(composerRoot, 'wo');
      textbox.props.onCompositionEnd();
    });

    expect(onTokensChange).toHaveBeenCalledTimes(1);
    expect(onTokensChange).toHaveBeenLastCalledWith([{type: 'text', text: 'wo'}]);
  });

  test('does not replace browser-owned text after committed IME text is cleared and restarted', async () => {
    const onTokensChange = jest.fn();
    const composerRoot = createComposerDomRoot();
    const replaceChildren = jest.spyOn(composerRoot, 'replaceChildren');
    const StatefulComposer = () => {
      const [tokens, setTokens] = React.useState<ChatComposerToken[]>([]);
      return (
        <ChatRichComposer
          tokens={tokens}
          onTokensChange={nextTokens => {
            onTokensChange(nextTokens);
            setTokens(nextTokens);
          }}
          readOnly={false}
        />
      );
    };
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<StatefulComposer />, {
        createNodeMock: element => (element.props.role === 'textbox' ? composerRoot : null),
      });
    });

    const textbox = renderer!.root.findByProps({role: 'textbox'});
    replaceChildren.mockClear();

    await ReactTestRenderer.act(() => {
      textbox.props.onCompositionStart();
      textboxReplaceText(composerRoot, '哟');
      textbox.props.onCompositionEnd();
    });

    expect(onTokensChange).toHaveBeenLastCalledWith([{type: 'text', text: '哟'}]);
    expect(replaceChildren).not.toHaveBeenCalled();

    await ReactTestRenderer.act(() => {
      textboxReplaceText(composerRoot, '');
      textbox.props.onInput({
        nativeEvent: {
          inputType: 'deleteContentBackward',
          isComposing: false,
        },
      });
    });

    expect(onTokensChange).toHaveBeenLastCalledWith([]);
    expect(replaceChildren).not.toHaveBeenCalled();

    await ReactTestRenderer.act(() => {
      textbox.props.onBeforeInput({
        nativeEvent: {
          inputType: 'insertText',
          isComposing: false,
          data: 'y',
        },
      });
      textboxReplaceText(composerRoot, 'y');
      textbox.props.onInput({
        nativeEvent: {
          inputType: 'insertText',
          isComposing: false,
          data: 'y',
        },
      });
    });

    expect(onTokensChange).toHaveBeenLastCalledWith([{type: 'text', text: 'y'}]);
    expect(replaceChildren).not.toHaveBeenCalled();
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
});

function createComposerDomRoot(): HTMLDivElement {
  const ownerDocument = {
    createTextNode: (text: string) => ({
      nodeType: 3,
      textContent: text,
    }),
    createElement: (tagName: string) => ({
      nodeType: 1,
      nodeName: tagName.toUpperCase(),
      dataset: {},
      className: '',
      contentEditable: '',
      childNodes: [],
      appendChild(child: Node) {
        this.childNodes.push(child);
      },
      setAttribute() {
        return undefined;
      },
    }),
  };
  return {
    ownerDocument,
    childNodes: [],
    querySelectorAll() {
      return [];
    },
    replaceChildren(...children: Node[]) {
      this.childNodes = children;
    },
  } as unknown as HTMLDivElement;
}

function textboxAppendText(root: HTMLDivElement, text: string): void {
  root.childNodes = [
    ...Array.from(root.childNodes),
    {
      nodeType: 3,
      textContent: text,
    } as unknown as ChildNode,
  ] as unknown as NodeListOf<ChildNode>;
}

function textboxReplaceText(root: HTMLDivElement, text: string): void {
  root.childNodes = [
    {
      nodeType: 3,
      textContent: text,
    } as unknown as ChildNode,
  ] as unknown as NodeListOf<ChildNode>;
}
