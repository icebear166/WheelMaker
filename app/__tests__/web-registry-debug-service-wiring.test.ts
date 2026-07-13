import fs from 'fs';
import path from 'path';

describe('registry debug service wiring', () => {
  const projectRoot = path.join(__dirname, '..');

  test('passes an optional debug sink from workspace service to registry client', () => {
    const repositoryTs = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'registry', 'RegistryRepository.ts'),
      'utf8',
    );
    const workspaceServiceTs = fs.readFileSync(
      path.join(projectRoot, 'web', 'src', 'registry', 'RegistryWorkspaceService.ts'),
      'utf8',
    );

    expect(repositoryTs).toContain("import { RegistryClient, type RegistryDebugSink } from './RegistryClient';");
    expect(repositoryTs).toContain("import type {RegistryDebugConnection} from '../debug/registryDebug';");
    expect(repositoryTs).toContain("debugConnection: RegistryDebugConnection = 'Remote'");
    expect(repositoryTs).toContain('return new RegistryRepository(new RegistryClient(8000, debugSink, debugConnection));');

    expect(workspaceServiceTs).toContain("import type {RegistryDebugSink} from './RegistryClient';");
    expect(workspaceServiceTs).toContain("import type {RegistryDebugConnection} from '../debug/registryDebug';");
    expect(workspaceServiceTs).toContain('createRepository?: (debugSink?: RegistryDebugSink, debugConnection?: RegistryDebugConnection) => RegistryRepository;');
    expect(workspaceServiceTs).toContain(
      'constructor(private readonly debugSink?: RegistryDebugSink, options: RegistryWorkspaceServiceOptions = {})',
    );
    expect(workspaceServiceTs).toContain('this.createRepository = options.createRepository ?? createRegistryRepository;');
    expect(workspaceServiceTs).not.toContain("this.createRepository(this.debugSink, 'Local')");
    expect(workspaceServiceTs).toContain("const repository = this.createRepository(this.debugSink, 'Remote');");
  });
});
