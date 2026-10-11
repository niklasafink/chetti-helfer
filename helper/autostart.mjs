/**
 * Start des Helfers beim Anmelden: macOS als LaunchAgent des Nutzers, Windows über den Run-Schlüssel des Nutzers
 * (beides ohne Administrator). Der Installer ruft `--autostart on` auf, die Deinstallation `--autostart off`.
 * `autostartPlan` berechnet nur Dateien und Befehle, damit sie ohne Ausführen geprüft werden können.
 */
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, writeFile } from 'node:fs/promises';

const run = promisify(execFile);
const LABEL = 'de.chetti.helper';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const xml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function autostartPlan(action, { platform = process.platform, home = os.homedir(), uid = process.getuid?.() ?? 0, node = process.execPath, script, logDir } = {}) {
  if (platform === 'darwin') {
    const file = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`), domain = `gui/${uid}`;
    const log = path.join(logDir ?? path.join(home, 'Library', 'Logs'), 'Chetti Helfer.log');
    const content = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>${LABEL}</string>\n<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(script)}</string></array>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>StandardOutPath</key><string>${xml(log)}</string>\n<key>StandardErrorPath</key><string>${xml(log)}</string>\n</dict></plist>\n`;
    return action === 'on'
      ? { files: [{ path: file, content }], commands: [['launchctl', ['bootout', `${domain}/${LABEL}`], true], ['launchctl', ['bootstrap', domain, file]]], remove: [] }
      : { files: [], commands: [['launchctl', ['bootout', `${domain}/${LABEL}`], true]], remove: [file] };
  }
  if (platform === 'win32') {
    return action === 'on'
      ? { files: [], commands: [['reg', ['add', RUN_KEY, '/v', 'ChettiHelper', '/t', 'REG_SZ', '/d', `"${node}" "${script}"`, '/f']]], remove: [] }
      : { files: [], commands: [['reg', ['delete', RUN_KEY, '/v', 'ChettiHelper', '/f'], true]], remove: [] };
  }
  return { files: [], commands: [], remove: [] };
}

export async function setAutostart(action, options = {}) {
  const plan = autostartPlan(action, options);
  for (const file of plan.files) { await mkdir(path.dirname(file.path), { recursive: true }); await writeFile(file.path, file.content); }
  // `true` als dritter Wert: ein Fehler ist hier unerheblich (z. B. noch nicht geladen).
  for (const [command, args, tolerate] of plan.commands) { try { await run(command, args, { windowsHide: true }); } catch (error) { if (!tolerate) throw error; } }
  for (const file of plan.remove) await rm(file, { force: true });
  return plan;
}
