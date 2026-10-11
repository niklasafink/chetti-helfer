/**
 * Zertifikat im System eintragen und wieder entfernen (nur auf ausdrücklichen Aufruf des Installers, nie beim normalen Start).
 *
 * macOS: Schlüsselbund des Nutzers (das System fragt nach dem Passwort). Windows: Zertifikatsspeicher des Nutzers, ohne Administrator
 * (das System zeigt eine Bestätigung). Firefox führt eigene Zertifikate, übernimmt aber die des Systems, wenn
 * `security.enterprise_roots.enabled` gesetzt ist; das tragen wir in `user.js` der vorhandenen Profile ein.
 */
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises';

const run = promisify(execFile);
const PREF = 'user_pref("security.enterprise_roots.enabled", true);';

/** Befehle für das Betriebssystem; rein berechnet, damit sie ohne Ausführen geprüft werden können. */
export function trustCommands(action, certFile, { platform = process.platform, home = os.homedir() } = {}) {
  if (platform === 'darwin') {
    const keychain = path.join(home, 'Library', 'Keychains', 'login.keychain-db');
    return action === 'install' ? [['security', ['add-trusted-cert', '-r', 'trustRoot', '-k', keychain, certFile]]] : [['security', ['remove-trusted-cert', certFile]]];
  }
  if (platform === 'win32') return action === 'install' ? [['certutil', ['-user', '-addstore', 'Root', certFile]]] : [['certutil', ['-user', '-delstore', 'Root', 'Chetti Helfer']]];
  return [];
}

/** Firefox-Profilordner des Nutzers (Namen enden auf `.default…` oder tragen eine Kennung vor dem Punkt). */
export async function firefoxProfiles({ platform = process.platform, home = os.homedir(), appData = process.env.APPDATA } = {}) {
  const base = platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles')
    : platform === 'win32' && appData ? path.join(appData, 'Mozilla', 'Firefox', 'Profiles') : null;
  if (!base) return [];
  const names = await readdir(base).catch(() => []);
  return names.filter(name => /^[a-z0-9]{8}\./i.test(name)).map(name => path.join(base, name));
}

export async function setFirefoxRoots(on, options) {
  const touched = [];
  for (const profile of await firefoxProfiles(options)) {
    const file = path.join(profile, 'user.js');
    const text = await readFile(file, 'utf8').catch(() => '');
    if (on && !text.includes(PREF)) { await appendFile(file, `${text && !text.endsWith('\n') ? '\n' : ''}${PREF}\n`); touched.push(profile); }
    if (!on && text.includes(PREF)) { await writeFile(file, text.split('\n').filter(line => line.trim() !== PREF).join('\n')); touched.push(profile); }
  }
  return touched;
}

export async function installTrust(certFile, options = {}) {
  for (const [command, args] of trustCommands('install', certFile, options)) await run(command, args, { windowsHide: true });
  return setFirefoxRoots(true, options);
}
export async function removeTrust(certFile, options = {}) {
  for (const [command, args] of trustCommands('remove', certFile, options)) await run(command, args, { windowsHide: true }).catch(() => {});
  return setFirefoxRoots(false, options);
}
