// Baut den Chetti-Helfer als eigenständiges Programm (Electron, ohne Fenster): `node scripts/helper/build.mjs [--dmg]`.
// Ergebnis liegt unter build/helper-app/release. Der Bau bleibt unsigniert; Signatur und Notarisierung setzt der Veröffentlichende
// (Apple-Developer-Konto, Windows-Zertifikat) über die Umgebungsvariablen von electron-builder (CSC_LINK, CSC_KEY_PASSWORD, APPLE_*).
// macOS: whisper-server wird aus Homebrew gebündelt (scripts/helper/whisper-mac.mjs). Windows: Ordner `build/helper-bin-win`
// mit whisper-server.exe und seinen DLLs muss vorliegen (whisper.cpp-Release `whisper-bin-x64`).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIcons } from './icon.mjs';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const stage = path.join(root, 'build', 'helper-app');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
const mac = process.platform === 'darwin';

rmSync(stage, { recursive: true, force: true }); mkdirSync(stage, { recursive: true });
cpSync(path.join(root, 'helper'), path.join(stage, 'helper'), { recursive: true, filter: file => !file.includes(`${path.sep}bin`) });
cpSync(path.join(root, 'server'), path.join(stage, 'server'), { recursive: true });
cpSync(path.join(root, 'knowledge'), path.join(stage, 'knowledge'), { recursive: true, filter: file => !/knowledge[\\/](rohdaten|datenbank)/.test(file) });
writeIcons(path.join(stage, 'helper', 'assets'));

const bin = path.join(stage, 'bin');
if (mac) run('node', [path.join(root, 'scripts/helper/whisper-mac.mjs'), bin]);
else if (existsSync(path.join(root, 'build', 'helper-bin-win'))) cpSync(path.join(root, 'build', 'helper-bin-win'), bin, { recursive: true });
else console.warn('Hinweis: build/helper-bin-win fehlt; der Bau enthält keine Spracherkennung.');

writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: 'chetti-helfer', productName: 'Chetti Helfer', version: pkg.version, description: 'Lokaler Dienst für Chetti: Spracherkennung und Notizen auf dem eigenen Rechner.',
  author: 'Dealzforest UG (haftungsbeschränkt)', main: 'helper/app.cjs', dependencies: { selfsigned: pkg.dependencies.selfsigned },
  build: {
    appId: 'de.chetti.helper', productName: 'Chetti Helfer', electronVersion: pkg.devDependencies.electron.replace(/^[^\d]*/, ''),
    directories: { output: 'release' }, files: ['helper/**/*', 'server/**/*', 'knowledge/**/*', 'package.json'],
    extraResources: [{ from: 'bin', to: 'bin' }],
    mac: { category: 'public.app-category.medical', electronLanguages: ['de', 'en'], target: process.argv.includes('--dmg') ? ['dmg'] : ['dir'], identity: null, extendInfo: { LSUIElement: true } },
    win: { target: 'nsis' }, nsis: { oneClick: true, perMachine: false },
  },
}, null, 2));
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stage });
run(path.join(root, 'node_modules', '.bin', 'electron-builder'), ['--projectDir', stage, mac ? '--mac' : '--win', '--publish', 'never'], { env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_LINK ? 'true' : 'false' } });
if (mac) {
  // Ohne Apple-Konto: ad hoc signieren (Apple Silicon verlangt mindestens das) und für die Verteilung packen.
  const app = path.join(stage, 'release', 'mac-arm64', 'Chetti Helfer.app');
  run('codesign', ['--force', '--deep', '--sign', '-', app]);
  // tar.xz statt zip: rund 82 statt 118 MB und damit unter dem Dateilimit der Website. Das Installationsskript der Website entpackt es.
  const archive = path.join(stage, 'release', `Chetti-Helfer-mac-${process.arch}.tar.xz`);
  rmSync(archive, { force: true });
  run('tar', ['-cJf', archive, '-C', path.dirname(app), 'Chetti Helfer.app']);
  const site = path.join(root, 'website', 'helfer');
  mkdirSync(site, { recursive: true });
  cpSync(archive, path.join(site, path.basename(archive)));
  console.log(`Paket: ${archive}\nFür die Verteilung liegt es in website/helfer; die Website mit \`vercel deploy --cwd website --prod\` veröffentlichen.`);
}
console.log(`Fertig: ${path.join(stage, 'release')}`);
