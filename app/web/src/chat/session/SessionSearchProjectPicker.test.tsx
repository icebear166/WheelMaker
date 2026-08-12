import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import type {RegistryProject} from '../../registry/registryTypes';
import {SessionSearchProjectPicker} from './SessionSearchProjectPicker';

const projects: RegistryProject[] = [
  {projectId: 'p1', name: 'WheelMaker', online: true, path: 'D:/Code/WheelMaker', hubId: 'local-hub'},
  {projectId: 'p2', name: 'ToolBox', online: true, path: 'D:/Code/ToolBox', hubId: 'ks-hub'},
];

async function renderPicker(value = '') {
  let tree: ReactTestRenderer | undefined;
  const onChange = jest.fn();
  await act(async () => {
    tree = create(
      <SessionSearchProjectPicker
        projects={projects}
        value={value}
        onChange={onChange}
      />,
    );
  });
  return {tree: tree!, onChange};
}

describe('SessionSearchProjectPicker', () => {
  it('renders an All Projects trigger and opens the custom project menu', async () => {
    const {tree} = await renderPicker();
    const trigger = tree.root.findByProps({className: 'session-search-project-trigger'});

    expect(trigger.props['aria-haspopup']).toBe('listbox');
    expect(trigger.findByProps({className: 'session-search-project-label'}).children).toEqual(['All Projects']);

    await act(async () => trigger.props.onClick());

    const menu = tree.root.find(node => typeof node.props.className === 'string' && node.props.className.includes('session-search-project-menu'));
    expect(menu.props.role).toBe('listbox');
    expect(tree.root.findAllByProps({role: 'option'})).toHaveLength(3);
  });

  it('selects a project from the menu and exposes its Hub label', async () => {
    const {tree, onChange} = await renderPicker();
    const trigger = tree.root.findByProps({className: 'session-search-project-trigger'});
    await act(async () => trigger.props.onClick());

    const option = tree.root.find(node => typeof node.props.className === 'string' && node.props.className.includes('session-search-project-option-p2'));
    expect(option.find(node => node.props.className === 'session-search-project-hub').children).toEqual(['ks-hub']);
    await act(async () => option.props.onClick());

    expect(onChange).toHaveBeenCalledWith('p2');
  });
});
