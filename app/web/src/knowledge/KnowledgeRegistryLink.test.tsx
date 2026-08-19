import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {KnowledgeRegistryLink} from './KnowledgeRegistryLink';

describe('KnowledgeRegistryLink', () => {
  test('renders a configured personal Wiki link in a new tab', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <KnowledgeRegistryLink publicUrl="https://wiki.example.com" />,
      );
    });

    const link = tree.root.findByProps({'aria-label': 'Open Personal Wiki'});
    expect(link.type).toBe('a');
    expect(link.props.href).toBe('https://wiki.example.com/');
    expect(link.props.target).toBe('_blank');
    expect(link.props.rel).toBe('noopener noreferrer');
    expect(link.props['data-tooltip']).toBe('Open Personal Wiki');
  });

  test('renders a prompt button when the URL is missing or unsafe', () => {
    let missing!: TestRenderer.ReactTestRenderer;
    let unsafe!: TestRenderer.ReactTestRenderer;
    let unconfiguredMessage = '';
    act(() => {
      missing = TestRenderer.create(
        <KnowledgeRegistryLink
          onUnconfigured={(message: string) => {
            unconfiguredMessage = message;
          }}
        />,
      );
      unsafe = TestRenderer.create(
        <KnowledgeRegistryLink publicUrl="javascript:alert(1)" />,
      );
    });

    const missingButton = missing.root.findByProps({
      'aria-label': 'Open Personal Wiki',
    });
    expect(missingButton.type).toBe('button');
    expect(missingButton.props.type).toBe('button');
    expect(missingButton.props['data-tooltip']).toBe(
      'Personal Wiki is not configured',
    );
    act(() => missingButton.props.onClick());
    expect(unconfiguredMessage).toBe(
      'Personal Wiki is not configured. Set knowledgeRegistry.publicUrl on the Registry server.',
    );

    const unsafeButton = unsafe.root.findByProps({
      'aria-label': 'Open Personal Wiki',
    });
    expect(unsafeButton.type).toBe('button');
  });
});
