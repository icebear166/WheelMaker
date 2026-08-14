import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {AgentChoiceMenu} from '../web/src/chat/AgentChoiceMenu';

describe('AgentChoiceMenu', () => {
  function pillLabels(root: ReactTestRenderer.ReactTestInstance): string[] {
    const pills = root.findAllByProps({role: 'option'});
    return pills.map(pill => pill.findAllByType('span')[1].children[0] as string);
  }

  test('groups pills by engine family with full profile labels', async () => {
    const onSelect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AgentChoiceMenu
          agents={['claude', 'cc-deepseek', 'cc-glm', 'cc-kimi', 'cc-qwen', 'cc-flicker', 'codex']}
          variant="wide"
          onSelect={onSelect}
        />,
      );
    });

    const groupLabels = renderer!.root
      .findAllByProps({className: 'agent-choice-group-label'})
      .map(label => label.children[0]);
    expect(groupLabels).toEqual(['Claude', 'Codex']);

    const pills = renderer!.root.findAllByProps({role: 'option'});
    expect(pills).toHaveLength(7);
    expect(pillLabels(renderer!.root)).toEqual([
      'claude',
      'cc · deepseek',
      'cc · glm',
      'cc · kimi',
      'cc · qwen',
      'cc · flicker',
      'codex',
    ]);
    // No legacy expand control / child structure remains.
    expect(renderer!.root.findAllByProps({'aria-label': 'Expand Claude agents'})).toHaveLength(0);
    expect(renderer!.root.findAllByProps({className: 'agent-choice-child'})).toHaveLength(0);
  });

  test('sorts the default agent family first and keeps Other last', async () => {
    const onSelect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AgentChoiceMenu
          agents={['kimi', 'claude', 'cc-glm', 'codex', 'cx-deepseek']}
          defaultAgent="codex"
          variant="wide"
          onSelect={onSelect}
        />,
      );
    });

    const groupLabels = renderer!.root
      .findAllByProps({className: 'agent-choice-group-label'})
      .map(label => label.children[0]);
    expect(groupLabels).toEqual(['Codex', 'Claude', 'Other']);
    expect(pillLabels(renderer!.root)).toEqual(['codex', 'cx.deepseek', 'claude', 'cc · glm', 'kimi']);
  });

  test('hides the group label when only one family is present', async () => {
    const onSelect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AgentChoiceMenu agents={['claude', 'cc-glm']} variant="wide" onSelect={onSelect} />,
      );
    });

    expect(renderer!.root.findAllByProps({className: 'agent-choice-group-label'})).toHaveLength(0);
    expect(pillLabels(renderer!.root)).toEqual(['claude', 'cc · glm']);
  });

  test('sorts the default agent to the first pill', async () => {
    const onSelect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AgentChoiceMenu
          agents={['codex', 'claude', 'copilot']}
          defaultAgent="claude"
          variant="wide"
          onSelect={onSelect}
        />,
      );
    });

    expect(pillLabels(renderer!.root)[0]).toBe('claude');
  });

  test('selects each agent by its internal id on click', async () => {
    const onSelect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AgentChoiceMenu agents={['claude', 'cc-deepseek', 'codex']} variant="mobile" onSelect={onSelect} />,
      );
    });

    const pills = renderer!.root.findAllByProps({role: 'option'});
    await ReactTestRenderer.act(() => {
      pills[0].props.onClick();
      pills[1].props.onClick();
      pills[2].props.onClick();
    });

    expect(onSelect.mock.calls).toEqual([['claude'], ['cc-deepseek'], ['codex']]);
  });

  test('exposes listbox semantics and marks the active option', async () => {
    const onSelect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AgentChoiceMenu agents={['claude', 'codex']} variant="wide" onSelect={onSelect} />,
      );
    });

    expect(renderer!.root.findByProps({role: 'listbox'})).toBeTruthy();
    const pills = renderer!.root.findAllByProps({role: 'option'});
    expect(pills[0].props['aria-selected']).toBe(true);
    expect(pills[1].props['aria-selected']).toBe(false);
  });

  test('ignores touch pointer enter but keeps mouse hover active state', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AgentChoiceMenu agents={['claude', 'codex']} variant="wide" onSelect={jest.fn()} />,
      );
    });

    const secondPill = renderer!.root.findAllByProps({role: 'option'})[1];
    expect(typeof secondPill.props.onPointerEnter).toBe('function');

    await ReactTestRenderer.act(() => {
      secondPill.props.onPointerEnter({pointerType: 'touch'});
    });
    expect(renderer!.root.findAllByProps({role: 'option'})[0].props['aria-selected']).toBe(true);
    expect(renderer!.root.findAllByProps({role: 'option'})[1].props['aria-selected']).toBe(false);

    await ReactTestRenderer.act(() => {
      secondPill.props.onPointerEnter({pointerType: 'mouse'});
    });
    expect(renderer!.root.findAllByProps({role: 'option'})[0].props['aria-selected']).toBe(false);
    expect(renderer!.root.findAllByProps({role: 'option'})[1].props['aria-selected']).toBe(true);
  });

  test('confirms the active pill on Enter and closes on Escape', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AgentChoiceMenu agents={['claude', 'codex']} variant="wide" onSelect={onSelect} onClose={onClose} />,
      );
    });

    const listbox = renderer!.root.findByProps({role: 'listbox'});

    await ReactTestRenderer.act(() => {
      listbox.props.onKeyDown({key: 'ArrowDown', preventDefault() {}});
    });
    await ReactTestRenderer.act(() => {
      listbox.props.onKeyDown({key: 'Enter', preventDefault() {}});
    });
    expect(onSelect).toHaveBeenLastCalledWith('codex');

    await ReactTestRenderer.act(() => {
      listbox.props.onKeyDown({key: 'Escape', preventDefault() {}});
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
