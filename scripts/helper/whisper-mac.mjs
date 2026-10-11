// Bündelt whisper-server (Homebrew `whisper-cpp` und `ggml`) für den Chetti-Helfer auf macOS: Programm, Bibliotheken und
// Rechenkerne in einen Ordner, alle Bibliothekspfade auf den Ordner selbst umgebogen und neu signiert (ad hoc; die endgültige
// Signatur setzt der Installer). Aufruf: node scripts/helper/whisper-mac.mjs <Zielordner>
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] || 'build/helper-bin');
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' });
const prefix = run('brew', ['--prefix']).trim();
const real = file => realpathSync(path.join(prefix, file));
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });

const server = real('bin/whisper-server');
// Zielname → Quelldatei; die Zielnamen sind die, auf die die Programme verweisen (ohne Patch-Version).
const files = new Map([['whisper-server', server], ['libwhisper.1.dylib', real('opt/whisper.cpp/lib/libwhisper.1.dylib')],
  ['libggml.0.dylib', real('opt/ggml/lib/libggml.0.dylib')], ['libggml-base.0.dylib', real('opt/ggml/lib/libggml-base.0.dylib')]]);
// Rechenkerne und Metal werden zur Laufzeit aus dem Programmordner geladen.
const backends = path.join(prefix, 'opt/ggml/libexec');
for (const name of readdirSync(backends).filter(n => n.endsWith('.so'))) files.set(name, path.join(backends, name));

// Abhängigkeiten werden nachgezogen (z. B. libomp), bis nichts mehr auf Homebrew zeigt.
const queue = [...files.keys()];
for (let i = 0; i < queue.length; i++) {
  const name = queue[i], target = path.join(out, name);
  copyFileSync(files.get(name), target); chmodSync(target, 0o755);
  if (name.endsWith('.dylib')) run('install_name_tool', ['-id', `@rpath/${name}`, target]);
  for (const line of run('otool', ['-L', target]).split('\n').slice(1)) {
    const dep = line.trim().split(' ')[0];
    if (!dep.startsWith(prefix)) continue;
    const bundled = path.basename(dep);
    if (!files.has(bundled)) { files.set(bundled, realpathSync(dep)); queue.push(bundled); }
    run('install_name_tool', ['-change', dep, `@rpath/${bundled}`, target]);
  }
  try { run('install_name_tool', ['-add_rpath', name === 'whisper-server' ? '@executable_path' : '@loader_path', target]); } catch { /* vorhanden */ }
  run('codesign', ['--force', '--sign', '-', target]);
}
console.log(`Gebündelt: ${[...files.keys()].join(', ')} → ${out}`);
