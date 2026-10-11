/**
 * Hardware-Check des Chetti-Helfers: Reicht dieser Rechner für den lokalen Weg, und welches Sprachmodell trägt er?
 *
 * Grenzen nach Arbeitsspeicher wie `localPackage` (server/lokal.mjs): ab 16 GB Ministral 8B mit 16.384 Tokens Fenster, ab 8 GB
 * Ministral 3B mit 4.096 Tokens (`localContext`; mit Spracherkennung rund 4,4 GB während einer Konsultation).
 * Darunter, oder mit weniger als vier Prozessorkernen, ist der Rechner zu schwach; Konten weichen dann nicht auf die Cloud aus,
 * die Oberfläche meldet es nur. Die Grenzen sind vorläufig: gemessen ist nur ein M1 mit 16 GB (reports/KPI-Status lokal gegen Cloud.md),
 * ein Büro-PC ohne Grafikkarte ist es nicht.
 */
import os from 'node:os';

export const MIN_RAM_GB = 8, MIN_CORES = 4;

export function assess({ totalmem = os.totalmem(), cores = os.availableParallelism?.() ?? os.cpus().length, platform = process.platform, arch = process.arch } = {}) {
  // 8-GB-Rechner melden knapp unter 8 GB nutzbar (Grafikspeicher, Firmware); deshalb 7,5.
  const tier = totalmem >= 15.5e9 ? 'ministral-3:8b' : totalmem >= 7.5e9 ? 'ministral-3:3b' : null;
  const reason = tier === null ? 'ram' : cores < MIN_CORES ? 'cores' : null;
  return { ramGb: Math.round(totalmem / 1e8) / 10, cores, platform, arch, tier: reason ? null : tier, capable: !reason, reason };
}
