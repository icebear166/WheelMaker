import fs from 'fs';
import path from 'path';

function readAppSource(relativePath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('registry protocol domain service', () => {
  test('registers external file reads without changing the protocol version', () => {
    const registryMethodsTs = readAppSource('web/src/registry/registryMethods.ts');

    expect(registryMethodsTs).toContain("ProjectFSExternalInfo: 'project.fs.external.info'");
    expect(registryMethodsTs).toContain("ProjectFSExternalRead: 'project.fs.external.read'");
    expect(registryMethodsTs).toContain("RegistryProtocolVersion = '2.6'");
  });

  test('RegistryRepository does not send removed public method names', () => {
    const repositoryTs = readAppSource('web/src/registry/RegistryRepository.ts');
    const removedRequestMarkers = [
      "method: 'local_read.proof'",
      "method: 'project.list'",
      "method: 'project.sync.check'",
      "method: 'project.syncCheck'",
      "method: 'fs.",
      "method: 'git.",
      "method: 'relay.",
      "method: 'session.new'",
      "method: 'session.setConfig'",
      "method: 'session.token.",
      "method: 'cmd.",
    ];

    for (const marker of removedRequestMarkers) {
      expect(repositoryTs).not.toContain(marker);
    }
    expect(repositoryTs).not.toContain("protocolVersion: '2.4'");
  });

  test('RegistryRepository uses protocol constants for target method domains', () => {
    const repositoryTs = readAppSource('web/src/registry/RegistryRepository.ts');

    expect(repositoryTs).not.toContain('ConnectLocalReadProof');
    expect(repositoryTs).toContain('RegistryMethods.RegistryProjectList');
    expect(repositoryTs).toContain('RegistryMethods.ProjectFSRead');
    expect(repositoryTs).toContain('RegistryMethods.ProjectGitRev');
    expect(repositoryTs).toContain('RegistryMethods.ProjectGitStatus');
    expect(repositoryTs).toContain('RegistryMethods.SessionCreate');
    expect(repositoryTs).toContain('RegistryMethods.SessionConfig');
    expect(repositoryTs).toContain('RegistryMethods.HubStateRefresh');
    expect(repositoryTs).toContain('RegistryMethods.HubStateAction');
  });

  test('speech registry client uses shared registry method constants', () => {
    const speechClientTs = readAppSource('web/src/features/speech/registrySpeechClient.ts');

    expect(speechClientTs).toContain("import {RegistryMethods} from '../../registry/registryMethods';");
    expect(speechClientTs).toContain('RegistryMethods.SpeechStart');
    expect(speechClientTs).toContain('RegistryMethods.SpeechChunk');
    expect(speechClientTs).toContain('RegistryMethods.SpeechFinish');
    expect(speechClientTs).toContain('RegistryMethods.SpeechCancel');
    expect(speechClientTs).toContain('RegistryMethods.SpeechTranscript');
    expect(speechClientTs).toContain('RegistryMethods.SpeechError');
  });
});
