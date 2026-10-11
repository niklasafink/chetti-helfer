/**
 * Zertifikat des Helfers. Eine https-Seite (chettiai.de) darf ohne Warnung nur Ziele mit https ansprechen; ein lokaler Dienst
 * unter http wird von Safari und Firefox blockiert (Spike 2026-10-11). Der Helfer antwortet deshalb mit https auf 127.0.0.1
 * und bringt dafür ein eigenes, nur für diese Adresse gültiges Zertifikat mit, das der Installer einmal im System einträgt (trust.mjs).
 */
import { X509Certificate } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { generate } from 'selfsigned';

const DAY = 86_400_000;

/** Liest Schlüssel und Zertifikat aus dem Datenordner oder legt sie an; ein Zertifikat mit weniger als 30 Tagen Laufzeit wird erneuert. */
export async function ensureCertificate(directory, now = Date.now()) {
  const keyFile = path.join(directory, 'helper-key.pem'), certFile = path.join(directory, 'helper-cert.pem');
  try {
    const [key, cert] = await Promise.all([readFile(keyFile, 'utf8'), readFile(certFile, 'utf8')]);
    if (new Date(new X509Certificate(cert).validTo).getTime() - now > 30 * DAY) return { key, cert, keyFile, certFile, created: false };
  } catch { /* neu anlegen */ }
  const made = await generate([{ name: 'commonName', value: 'Chetti Helfer' }], {
    days: 3650, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }, { type: 2, value: 'localhost' }] }],
  });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(keyFile, made.private, { mode: 0o600 });
  await writeFile(certFile, made.cert);
  await chmod(keyFile, 0o600).catch(() => {});
  return { key: made.private, cert: made.cert, keyFile, certFile, created: true };
}
