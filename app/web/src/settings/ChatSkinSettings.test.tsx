// @ts-nocheck
import React from 'react';
import {act, create} from 'react-test-renderer';
import {ChatSkinSettings} from './ChatSkinSettings';

function renderSettings(overrides = {}) {
  let tree;
  const props = {
    previewUrl: '',
    fileName: '',
    busy: false,
    error: '',
    scale: 1,
    opacity: 0.17,
    offset: 24,
    onSelect: jest.fn(async () => undefined),
    onRemove: jest.fn(async () => undefined),
    onScaleChange: jest.fn(),
    onOpacityChange: jest.fn(),
    onOffsetChange: jest.fn(),
    ...overrides,
  };
  act(() => {
    tree = create(<ChatSkinSettings {...props} />);
  });
  return {tree, props};
}

describe('ChatSkinSettings', () => {
  test('offers a browser image picker when no skin is selected', () => {
    const {tree} = renderSettings();
    const input = tree.root.findAllByType('input').find(candidate => candidate.props.type === 'file');

    expect(input).toBeDefined();
    if (!input) return;
    expect(input.props.type).toBe('file');
    expect(input.props.accept).toBe('image/*');
    expect(tree.root.findAllByType('button').some(button => button.children.includes('Choose image'))).toBe(true);
  });

  test('shows the preview, filename, replace, and remove actions', () => {
    const {tree} = renderSettings({previewUrl: 'blob:skin', fileName: 'skin.png'});

    expect(tree.root.findByType('img').props.src).toBe('blob:skin');
    expect(JSON.stringify(tree.toJSON())).toContain('skin.png');
    expect(tree.root.findAllByType('button').some(button => button.children.includes('Replace'))).toBe(true);
    expect(tree.root.findAllByType('button').some(button => button.children.includes('Remove'))).toBe(true);
  });

  test('exposes scale, opacity, and image offset controls for the active skin', () => {
    const {tree, props} = renderSettings({previewUrl: 'blob:skin', scale: 0.75, opacity: 0.42, offset: 24});
    const rangeInputs = tree.root.findAllByType('input').filter(input => input.props.type === 'range');

    expect(rangeInputs).toHaveLength(3);
    expect(rangeInputs[0].props.value).toBe(75);
    expect(rangeInputs[1].props.value).toBe(0.42);
    expect(rangeInputs[2].props.value).toBe(24);

    act(() => {
      rangeInputs[0].props.onChange({target: {value: '50'}});
      rangeInputs[1].props.onChange({target: {value: '0.55'}});
      rangeInputs[2].props.onChange({target: {value: '-60'}});
    });

    expect(props.onScaleChange).toHaveBeenCalledWith(0.5);
    expect(props.onOpacityChange).toHaveBeenCalledWith(0.55);
    expect(props.onOffsetChange).toHaveBeenCalledWith(-60);
  });

  test('disables actions while busy and exposes an actionable error', () => {
    const {tree} = renderSettings({previewUrl: 'blob:skin', fileName: 'skin.png', busy: true, error: 'Could not save image.'});
    const buttons = tree.root.findAllByType('button');

    expect(buttons.every(button => button.props.disabled === true)).toBe(true);
    expect(tree.root.findByProps({role: 'alert'}).children.join('')).toContain('Could not save image.');
  });

  test('passes the selected file to onSelect and removes the active skin', async () => {
    const {tree, props} = renderSettings({previewUrl: 'blob:skin', fileName: 'skin.png'});
    const file = new File(['skin'], 'new.webp', {type: 'image/webp'});
    const input = tree.root.findAllByType('input').find(candidate => candidate.props.type === 'file');
    const removeButton = tree.root.findAllByType('button').find(button => button.children.includes('Remove'));

    expect(input).toBeDefined();
    expect(removeButton).toBeDefined();
    if (!input || !removeButton) return;
    await act(async () => {
      input.props.onChange({target: {files: [file]}});
      await Promise.resolve();
      removeButton.props.onClick();
      await Promise.resolve();
    });

    expect(props.onSelect).toHaveBeenCalledWith(file);
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });
});
