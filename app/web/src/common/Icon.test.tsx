import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';

import {Icon, ICON_NAMES} from './Icon';

test('registers the circle arrow up glyph for skill upgrades', () => {
  expect(ICON_NAMES).toContain('circleArrowUp');
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Icon name="circleArrowUp" />);
  });
  expect(renderer.root.findByType('svg').props['data-icon-name']).toBe('circleArrowUp');
});
