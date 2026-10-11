/**
 * Wissensbasis des Helfers (Begriffslisten und Schreibprofile). Sie liegt nicht im Programm, sondern wird wie die Modelle
 * beim ersten Start geladen und im Datenordner abgelegt; `server/` findet sie über `CHETTI_KNOWLEDGE`.
 * Die Adresse steht nicht im Quelltext: der Bau trägt sie aus `CHETTI_KNOWLEDGE_URL` in die package.json des Programms ein (Feld `wissen`).
 * Muss laufen, bevor `server.mjs` geladen wird: die Schreibprofile werden beim Laden von `server/fachgebiet.mjs` gelesen.
 */
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const exists = file => access(file).then(() => true, () => false);

/** Ordner der Wissensbasis. Je Programmversion wird einmal geladen; scheitert das Laden, gilt der vorhandene Stand weiter. */
export async function ensureKnowledge(directory, { version, url = process.env.CHETTI_KNOWLEDGE_URL, fetcher = fetch } = {}) {
  if (process.env.CHETTI_KNOWLEDGE) return process.env.CHETTI_KNOWLEDGE;
  // Entwicklung im Projekt: der Ordner liegt neben dem Helfer.
  const local = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');
  if (await exists(path.join(local, 'stil'))) return local;
  const target = path.join(directory, 'wissen'), marker = path.join(target, 'version.txt');
  const have = await readFile(marker, 'utf8').catch(() => null);
  if (have !== version) {
    try {
      if (!url) throw new Error('Die Adresse der Wissensbasis fehlt.');
      const response = await fetcher(url);
      if (!response.ok) throw new Error(`Die Wissensbasis ließ sich nicht laden (${response.status}).`);
      const archive = path.join(directory, 'wissen.tar.gz');
      await mkdir(directory, { recursive: true });
      await writeFile(archive, Buffer.from(await response.arrayBuffer()));
      await rm(target, { recursive: true, force: true });
      await mkdir(target, { recursive: true });
      await run('tar', ['-xzf', archive, '-C', target], { windowsHide: true });
      await rm(archive, { force: true });
      await writeFile(marker, version);
    } catch (error) {
      if (have === null) throw error;
    }
  }
  return process.env.CHETTI_KNOWLEDGE = target;
}
