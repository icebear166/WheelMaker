import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  ChatRichComposer,
  type ChatRichComposerHandle,
} from '../web/src/chat/composer/ChatRichComposer';
import type {ChatComposerToken} from '../web/src/chat/composer/chatComposerTokens';

describe('ChatRichComposer', () => {
  test('renders skill and file capsules inline', async () => {
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

    const capsules = renderer!.root.findAllByProps({'data-chat-composer-capsule': true});
    expect(capsules.map(item => item.props['data-kind'])).toEqual(['skill', 'file']);
    expect(capsules.map(item => item.props.contentEditable)).toEqual([false, false]);
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
