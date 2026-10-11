// Gleicht das öffentliche Repo des Helfers ab: `node scripts/helper/publish.mjs [Zielordner]` (Standard: ../Chetti Helfer).
// Öffentlich ist alles, woraus das Programm gebaut wird: helper/, scripts/helper/, das Installationsskript und der Teil von server/,
// den der Helfer lädt. Die Wissensbasis (knowledge/) und ihre Adresse bleiben privat, ebenso Konten, Cloud-Speicher und Dev-Ansicht.
// README, LICENSE und .github liegen nur im Zielordner und bleiben unberührt. Commit und Push dort von Hand.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const target = path.resolve(process.argv[2] ?? path.join(root, '..', 'Chetti Helfer'));
if (!existsSync(path.join(target, '.git'))) throw new Error(`Kein Git-Repo: ${target}`);
const PRIVATE = ['abuse.mjs', 'blob-store.mjs', 'dev.mjs', 'http.mjs', 'konto.mjs'].map(file => path.join(root, 'server', file));

for (const entry of ['helper', 'scripts/helper', 'server', 'website/helfer/install.sh']) {
  rmSync(path.join(target, entry), { recursive: true, force: true });
  cpSync(path.join(root, entry), path.join(target, entry), { recursive: true, filter: file => !file.includes(`${path.sep}bin`) && !PRIVATE.includes(file) });
}
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
writeFileSync(path.join(target, 'package.json'), `${JSON.stringify({
  name: 'chetti-helfer', version: pkg.version, description: 'Lokaler Dienst für Chetti: Spracherkennung und Notizen auf dem eigenen Rechner.', license: 'MIT', private: true,
  scripts: { helper: 'node helper/main.mjs', 'package:helper': 'node scripts/helper/build.mjs' },
  dependencies: { selfsigned: pkg.dependencies.selfsigned },
  devDependencies: { electron: pkg.devDependencies.electron, 'electron-builder': pkg.devDependencies['electron-builder'] },
}, null, 2)}\n`);
console.log(`Abgeglichen: ${target}`);
