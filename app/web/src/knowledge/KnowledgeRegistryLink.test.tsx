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

  test('does not render when the URL is missing or unsafe', () => {
    let missing!: TestRenderer.ReactTestRenderer;
    let unsafe!: TestRenderer.ReactTestRenderer;
    act(() => {
      missing = TestRenderer.create(<KnowledgeRegistryLink />);
      unsafe = TestRenderer.create(<KnowledgeRegistryLink publicUrl="javascript:alert(1)" />);
    });
    expect(missing.toJSON()).toBeNull();
    expect(unsafe.toJSON()).toBeNull();
  });
});
