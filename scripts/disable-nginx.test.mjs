import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Nginx disable helpers only stop and disable known services', async () => {
  const shell = await readFile(new URL('./disable-nginx.sh', import.meta.url), 'utf8');
  const powershell = await readFile(new URL('./disable-nginx.ps1', import.meta.url), 'utf8');
  for (const source of [shell, powershell]) {
    assert.match(source, /nginx/i);
    assert.match(source, /stop/i);
    assert.match(source, /disable/i);
    assert.doesNotMatch(source, /rm\s+-rf|Remove-Item|apt(-get)?\s+(remove|purge)|uninstall|firewall|certbot/i);
    assert.doesNotMatch(source, /gateway/i);
  }
  assert.match(shell, /No known nginx service was detected/);
  assert.match(powershell, /No known nginx service was detected/);
});
