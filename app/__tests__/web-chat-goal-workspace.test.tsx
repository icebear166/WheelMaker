import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import fs from 'fs';
import path from 'path';

import {
  AppConfirmDialog,
  AppGoalEditDialog,
} from '../web/src/shell/AppDialogs';
import type {RegistrySessionGoal} from '../web/src/registry/registryTypes';

const projectRoot = path.join(__dirname, '..');

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function goal(overrides: Partial<RegistrySessionGoal> = {}): RegistrySessionGoal {
  return {
    sessionId: 'session-1',
    objective: 'Ship Goal',
    status: 'active',
    tokenBudget: null,
    tokensUsed: 10,
    timeUsedSeconds: 20,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function renderedText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root.findAll(node => typeof node.children[0] === 'string')
    .flatMap(node => node.children.filter((child): child is string => typeof child === 'string'))
    .join(' ');
}

describe('Workspace Session Goal integration', () => {
  test('places Goal above Plan on desktop and mobile', () => {
    const source = readSource('web/src/app/WorkspaceApp.tsx');
    const stackStart = source.indexOf('chat-edge-surface-stack');
    const desktop = source.slice(stackStart, stackStart + 3600);
    const mobileStart = source.indexOf('{!isWide ? (', stackStart);
    const mobile = source.slice(mobileStart, mobileStart + 1000);

    expect(stackStart).toBeGreaterThanOrEqual(0);
    expect(desktop.indexOf('<ChatGoalSurface')).toBeGreaterThanOrEqual(0);
    expect(desktop.indexOf('<ChatGoalSurface')).toBeLessThan(desktop.indexOf('<ChatPlanSurface'));
    expect(mobile.indexOf('<ChatGoalSurface')).toBeGreaterThanOrEqual(0);
    expect(mobile.indexOf('<ChatGoalSurface')).toBeLessThan(mobile.indexOf('<ChatPlanSurface'));
  });

  test('gates the console by capability and routes every Goal control', () => {
    const source = readSource('web/src/app/WorkspaceApp.tsx');

    expect(source).toContain('selectedChatSession?.sessionActions?.goal?.supported === true');
    expect(source).toMatch(
      /service\.updateProjectSessionGoal\(selectedKey\.projectId, selectedKey\.sessionId, \{\s*status:/,
    );
    expect(source).toContain("status: 'paused'");
    expect(source).toContain("status: 'active'");
    expect(source).toContain('service.clearProjectSessionGoal(');
    expect(source).toContain('service.stopProjectSessionGoal(selectedKey.projectId, selectedKey.sessionId)');
    expect(source).toContain('selectedGoal?.status === \'active\'');
  });

  test('validates and submits objective plus an unlimited budget', async () => {
    const onSubmit = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AppGoalEditDialog
          goal={goal({tokenBudget: 20_000})}
          busy={false}
          error=""
          onCancel={jest.fn()}
          onSubmit={onSubmit}
        />,
      );
    });

    const objective = renderer!.root.findByProps({'aria-label': 'Goal objective'});
    await ReactTestRenderer.act(() => {
      objective.props.onChange({target: {value: ''}});
    });
    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({'aria-label': 'Save goal changes'}).props.onClick();
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(renderer!.root.findByProps({role: 'alert'}).children).toContain('Objective is required.');

    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({'aria-label': 'Goal objective'}).props.onChange({
        target: {value: '  New objective  '},
      });
      renderer!.root.findByProps({'aria-label': 'Goal token budget'}).props.onChange({
        target: {value: ''},
      });
    });
    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({'aria-label': 'Save goal changes'}).props.onClick();
    });
    expect(onSubmit).toHaveBeenCalledWith({
      objective: 'New objective',
      tokenBudget: null,
    });
  });

  test('submits only changed Goal fields', async () => {
    const onSubmit = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AppGoalEditDialog
          goal={goal({objective: 'Old objective', tokenBudget: 20_000})}
          busy={false}
          error=""
          onCancel={jest.fn()}
          onSubmit={onSubmit}
        />,
      );
    });

    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({'aria-label': 'Goal objective'}).props.onChange({
        target: {value: 'New objective'},
      });
    });
    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({'aria-label': 'Save goal changes'}).props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledWith({objective: 'New objective'});
  });

  test('counts Unicode code points when validating the objective limit', async () => {
    const onSubmit = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AppGoalEditDialog
          goal={goal({objective: 'Old objective'})}
          busy={false}
          error=""
          onCancel={jest.fn()}
          onSubmit={onSubmit}
        />,
      );
    });

    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({'aria-label': 'Goal objective'}).props.onChange({
        target: {value: '🚀'.repeat(4000)},
      });
    });
    await ReactTestRenderer.act(() => {
      renderer!.root.findByProps({'aria-label': 'Save goal changes'}).props.onClick();
    });

    expect(onSubmit).toHaveBeenCalledWith({objective: '🚀'.repeat(4000)});
  });

  test('confirms clear and explains that the current turn continues', async () => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(
        <AppConfirmDialog
          target={{
            kind: 'goalClear',
            projectId: 'project-a',
            sessionId: 'session-1',
            objective: 'Ship Goal',
          }}
          busy={false}
          error=""
          onCancel={jest.fn()}
          onPrimary={jest.fn()}
        />,
      );
    });

    expect(renderedText(renderer!)).toMatch(/current turn will continue/i);
    expect(renderer!.root.findByProps({className: 'app-confirm-btn primary danger'}).children)
      .toContain('Clear Goal');
  });
});
