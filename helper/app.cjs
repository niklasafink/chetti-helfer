/**
 * Chetti-Helfer als Programm: läuft ohne Fenster im Hintergrund, ein Symbol in der Menüleiste (macOS) bzw. im Infobereich (Windows)
 * zeigt den Stand und beendet ihn. Beim ersten Start trägt es das Zertifikat im System ein und schaltet den Start beim Anmelden ein.
 * Paketiert über scripts/helper/build.mjs; die Spracherkennung liegt dann in `resources/bin`.
 */
const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { X509Certificate } = require('node:crypto');
const { pathToFileURL } = require('node:url');

let tray, helper;
// CHETTI_HELPER_TEST=1: Testlauf ohne Eintrag im Schlüsselbund und ohne Start beim Anmelden.
const TEST = process.env.CHETTI_HELPER_TEST === '1';
const here = file => pathToFileURL(path.join(__dirname, file)).href;
if (process.platform === 'darwin') app.dock?.hide();

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('window-all-closed', event => event.preventDefault());
  const data = app.getPath('userData');
  // Fehler beim Start landen in der Logdatei des Helfers (für die Fehlersuche in der Praxis), nicht im Nichts.
  const log = error => fs.mkdir(data, { recursive: true }).then(() => fs.appendFile(path.join(data, 'helfer.log'), `${new Date().toISOString()} ${error?.stack || error}\n`)).catch(() => {});
  app.whenReady().then(async () => {
    if (app.isPackaged) process.env.CHETTI_BIN_DIR ||= path.join(process.resourcesPath, 'bin');
    const { createHelper, DEFAULT_ORIGINS } = await import(here('server.mjs'));
    const { ensureCertificate } = await import(here('tls.mjs'));
    const { installTrust } = await import(here('trust.mjs'));
    const certificate = await ensureCertificate(data);
    // Einmal je Zertifikat: im System eintragen (das System fragt dabei nach Bestätigung bzw. Passwort).
    const fingerprint = new X509Certificate(certificate.cert).fingerprint256;
    const marker = path.join(data, 'trust.txt');
    if (!TEST && (await fs.readFile(marker, 'utf8').catch(() => '')) !== fingerprint) {
      try { await installTrust(certificate.certFile); await fs.writeFile(marker, fingerprint); } catch { /* Nutzer hat abgelehnt: beim nächsten Start erneut */ }
    }
    if (!TEST && app.isPackaged && !(await fs.stat(path.join(data, 'autostart.txt')).catch(() => null))) {
      app.setLoginItemSettings({ openAtLogin: true });
      await fs.writeFile(path.join(data, 'autostart.txt'), '1');
    }
    try {
      helper = await createHelper({ directory: data, tls: certificate, version: app.getVersion(), origins: [...DEFAULT_ORIGINS, ...(process.env.CHETTI_HELPER_ORIGINS || '').split(',').filter(Boolean)] });
    } catch (error) { await log(error); app.quit(); return; }
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip('Chetti-Helfer');
    const label = () => {
      const state = helper.runtime.snapshot();
      return state.stt.state === 'ready' || state.llm.state === 'ready' ? 'Modelle sind geladen' : 'Bereit, Modelle ruhen';
    };
    const render = () => tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Chetti-Helfer läuft', enabled: false },
      { label: label(), enabled: false },
      { label: 'Arbeitsspeicher freigeben', click: () => void helper.runtime.stopAll().then(render) },
      { type: 'separator' },
      { label: 'Beenden', click: () => { void helper.close().finally(() => app.quit()); } },
    ]));
    render();
    setInterval(render, 5000).unref();
  }).catch(async error => { await log(error); app.quit(); });
}
