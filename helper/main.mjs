#!/usr/bin/env node
/**
 * Startpunkt des Chetti-Helfers.
 *
 *   node helper/main.mjs                       startet den Helfer (https auf 127.0.0.1:47813)
 *   node helper/main.mjs --install-trust       trägt das Zertifikat im System ein (Installer, einmalig)
 *   node helper/main.mjs --remove-trust        entfernt es wieder (Deinstallation)
 *   node helper/main.mjs --autostart on|off    Start beim Anmelden ein- oder ausschalten (Installer, Deinstallation)
 *   Weitere Angaben: --port N, --dir ORDNER, --origin URL (wiederholbar), --http (ohne TLS, nur für Entwicklung), --idle-minutes N
 *
 * Der Installer ruft --install-trust und --autostart on einmalig auf.
 */
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DEFAULT_ORIGINS, DEFAULT_PORT, createHelper } from './server.mjs';
import { ensureCertificate } from './tls.mjs';
import { installTrust, removeTrust } from './trust.mjs';
import { setAutostart } from './autostart.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const value = name => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
const values = name => args.flatMap((arg, i) => (arg === `--${name}` && args[i + 1] ? [args[i + 1]] : []));

const defaultDir = () => process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'Chetti Helfer')
  : process.platform === 'win32' ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Chetti Helfer')
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'chetti-helfer');
const directory = path.resolve(value('dir') || process.env.CHETTI_HELPER_DIR || defaultDir());
const version = createRequire(import.meta.url)('../package.json').version;

if (flag('install-trust') || flag('remove-trust')) {
  const certificate = await ensureCertificate(directory);
  const touched = await (flag('install-trust') ? installTrust : removeTrust)(certificate.certFile);
  console.log(`${flag('install-trust') ? 'Zertifikat eingetragen' : 'Zertifikat entfernt'}; Firefox-Profile angepasst: ${touched.length}.`);
  process.exit(0);
}

if (flag('autostart')) {
  const action = value('autostart') === 'off' ? 'off' : 'on';
  await setAutostart(action, { script: fileURLToPath(import.meta.url) });
  console.log(`Start beim Anmelden: ${action === 'on' ? 'eingeschaltet' : 'ausgeschaltet'}.`);
  process.exit(0);
}

const tls = flag('http') ? undefined : await ensureCertificate(directory);
const helper = await createHelper({
  directory, port: Number(value('port') || process.env.CHETTI_HELPER_PORT || DEFAULT_PORT), tls, version,
  origins: [...DEFAULT_ORIGINS, ...values('origin')],
  ...(value('idle-minutes') && { idleMs: Number(value('idle-minutes')) * 60_000 }),
});
console.log(`Chetti-Helfer ${version}: ${helper.url} · Daten in ${directory}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await helper.close(); process.exit(0); });
