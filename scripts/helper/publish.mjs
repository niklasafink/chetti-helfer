// Gleicht das öffentliche Repo des Helfers ab: `node scripts/helper/publish.mjs [Zielordner]` (Standard: ../Chetti Helfer).
// Öffentlich ist nur die Hülle: helper/, scripts/helper/ und das Installationsskript. server/ und knowledge/ bleiben privat.
// README und LICENSE liegen nur im Zielordner und bleiben unberührt. Commit und Push dort von Hand.
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const target = path.resolve(process.argv[2] ?? path.join(root, '..', 'Chetti Helfer'));
if (!existsSync(path.join(target, '.git'))) throw new Error(`Kein Git-Repo: ${target}`);

for (const entry of ['helper', 'scripts/helper', 'website/helfer/install.sh']) {
  rmSync(path.join(target, entry), { recursive: true, force: true });
  cpSync(path.join(root, entry), path.join(target, entry), { recursive: true, filter: file => !file.includes(`${path.sep}bin`) });
}
console.log(`Abgeglichen: ${target}`);
