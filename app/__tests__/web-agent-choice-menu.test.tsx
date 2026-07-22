import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {AgentChoiceMenu} from '../web/src/chat/AgentChoiceMenu';

describe('AgentChoiceMenu', () => {
  test('keeps Claude direct selection separate from expansion', async () => {
    const onSelect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AgentChoiceMenu agents={['claude', 'cc-deepseek', 'cc-glm', 'cc-kimi']} variant="wide" onSelect={onSelect} />,
      );
    });

    expect(renderer!.root.findAllByProps({className: 'agent-choice-child'})).toHaveLength(0);
    const main = renderer!.root.findByProps({className: 'agent-choice-main'});
    const expand = renderer!.root.findByProps({'aria-label': 'Expand Claude agents'});

    await ReactTestRenderer.act(() => {
      main.props.onClick();
    });
    expect(onSelect).toHaveBeenLastCalledWith('claude');
    expect(expand.props['aria-expanded']).toBe(false);

    await ReactTestRenderer.act(() => {
      expand.props.onClick();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findByProps({'aria-label': 'Collapse Claude agents'}).props['aria-expanded']).toBe(true);
    expect(renderer!.root.findAllByProps({className: 'agent-choice-child'})).toHaveLength(3);
  });

  test('selects each compatible child by its internal agent ID', async () => {
    const onSelect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AgentChoiceMenu agents={['claude', 'cc-deepseek', 'cc-glm', 'cc-kimi']} variant="mobile" onSelect={onSelect} />,
      );
    });
    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({'aria-label': 'Expand Claude agents'}).props.onClick();
    });

    const children = renderer!.root.findAllByProps({className: 'agent-choice-child'});
    expect(children).toHaveLength(3);
    await ReactTestRenderer.act(() => {
      children[0].props.onClick();
      children[1].props.onClick();
      children[2].props.onClick();
    });
    expect(onSelect.mock.calls).toEqual([['cc-deepseek'], ['cc-glm'], ['cc-kimi']]);
    expect(renderer!.root.findByProps({className: 'agent-choice-menu mobile'})).toBeTruthy();
  });

  test('renders one child and falls back to direct Claude when no child exists', async () => {
    const onSelect = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AgentChoiceMenu agents={['claude', 'cc-kimi']} variant="wide" onSelect={onSelect} />,
      );
    });
    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({'aria-label': 'Expand Claude agents'}).props.onClick();
    });
    expect(renderer!.root.findAllByProps({className: 'agent-choice-child'})).toHaveLength(1);

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<AgentChoiceMenu agents={['claude']} variant="wide" onSelect={onSelect} />);
    });
    expect(renderer!.root.findAllByProps({className: 'agent-choice-expand'})).toHaveLength(0);
    expect(renderer!.root.findByProps({className: 'agent-choice-menu wide'})).toBeTruthy();
  });
});
