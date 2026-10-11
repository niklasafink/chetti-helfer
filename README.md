# Chetti-Helfer

Der Chetti-Helfer ist das Programm, das [Chetti](https://chettiai.de) auf dem Rechner der Praxis installiert. Er nimmt Anfragen der Webapp entgegen und lässt Spracherkennung und Notiz lokal laufen. Gesprächsdaten verlassen den Rechner nicht.

Dieses Repo enthält den Quelltext, aus dem das Programm gebaut wird.

## English summary

Chetti-Helfer ("Chetti helper") is a small background program for medical and dental practices that use the [Chetti](https://chettiai.de) web app. It runs speech recognition (whisper.cpp) and a local language model (Ollama) on the practice's own computer, so recordings, transcripts and notes never leave the machine.

- **What it does on the computer:** It listens on `127.0.0.1:47813` only, answers over https and accepts requests from `chettiai.de` only. For https on `127.0.0.1` it creates its own certificate, valid for that address only, and adds it to the current user's certificate store; the system asks for confirmation. It starts at login and needs no administrator rights.
- **Source:** `helper/` is the program, `server/` the note logic, `scripts/helper/` the build. Every release is built by [GitHub Actions](.github/workflows/build.yml) from this repository; the workflow installs, starts, queries and uninstalls the program on a clean Windows runner.
- **Data loaded at first start:** the models and the terminology lists. They are data files, not code, and not part of this repository.
- **Uninstall:** Windows: "Apps" in Windows settings; this removes the certificate, the autostart entry and the data folder. macOS: see below.
- **Code signing policy:** Windows builds are currently unsigned. Free code signing by SignPath.io with a certificate by SignPath Foundation has been applied for. Committers, reviewers and approvers: [niklasafink](https://github.com/niklasafink).
- **Privacy:** The program does not transfer conversations, transcripts or notes to other systems. On its own it only downloads files (models and terminology lists). Privacy policy: [chettiai.de/datenschutz](https://chettiai.de/datenschutz).
- **License:** MIT.

## Was der Helfer auf dem Rechner tut

- **Lokaler Dienst:** Er lauscht nur auf `127.0.0.1:47813` und antwortet per https. Anfragen nimmt er nur von `chettiai.de` an ([helper/server.mjs](helper/server.mjs)).
- **Zertifikat:** Für https auf `127.0.0.1` erzeugt er ein eigenes Zertifikat, das nur für diese Adresse gilt, und trägt es einmal im Zertifikatsspeicher des Nutzers ein. Das System fragt dabei nach einer Bestätigung ([helper/tls.mjs](helper/tls.mjs), [helper/trust.mjs](helper/trust.mjs)).
- **Autostart:** Er startet beim Anmelden. Administratorrechte braucht er nicht.
- **Modelle:** Spracherkennung (whisper.cpp) und Sprachmodell (Ollama) starten erst, wenn eine Konsultation beginnt, und enden nach einigen Minuten ohne Anfrage ([helper/runtime.mjs](helper/runtime.mjs)).
- **Notiz:** Aus dem Transkript entsteht die Notiz mit der Logik in [server/](server/).

## Aufbau

| Ordner | Inhalt |
|---|---|
| `helper/` | Programm, lokaler Dienst, Zertifikat, Autostart, Start der Modelle |
| `server/` | Notiz-Logik: Fachgebiet, Korrektur, Sprecher, Prompts |
| `scripts/helper/` | Bau des Programms mit electron-builder |
| `website/helfer/` | Installationsskript für macOS |

Die Wissensbasis (Begriffslisten und Schreibprofile) gehört nicht zum Programm. Sie besteht aus Daten, die der Helfer beim ersten Start lädt, so wie die Modelle. Ihre Adresse erhält der Bau über `CHETTI_KNOWLEDGE_URL`.

## Bauen

```
npm install
CHETTI_KNOWLEDGE_URL=<Adresse> node scripts/helper/build.mjs
```

Unter Windows muss vorher `build/helper-bin-win` mit `whisper-server.exe` und den DLLs aus dem whisper.cpp-Release vorliegen. Der Ablauf steht in [.github/workflows/build.yml](.github/workflows/build.yml).

## Installieren und entfernen

**Windows:** den Installer aus den [Releases](https://github.com/niklasafink/chetti-helfer/releases) ausführen. Entfernen über „Apps“ in den Windows-Einstellungen; dabei werden Zertifikat, Autostart und der Datenordner gelöscht.

**macOS (Apple-Chip):**

```
curl -fsSL https://chettiai.de/helfer/install.sh | bash
```

Entfernen: den Helfer über das Symbol in der Menüleiste beenden, `~/Applications/Chetti Helfer.app` löschen, in der Schlüsselbundverwaltung das Zertifikat „Chetti Helfer“ löschen und den Ordner `~/Library/Application Support/Chetti Helfer` entfernen.

## Code signing policy

Die Windows-Builds sind derzeit unsigniert. Eine kostenlose Signatur über SignPath.io mit einem Zertifikat der SignPath Foundation ist beantragt.

- Committers and reviewers: [niklasafink](https://github.com/niklasafink)
- Approvers: [niklasafink](https://github.com/niklasafink)

## Datenschutz

Der Helfer überträgt keine Gesprächsdaten, Transkripte oder Notizen an andere Systeme. Von sich aus lädt er nur Dateien herunter: die Modelle und die Wissensbasis. Die Datenschutzerklärung von Chetti steht unter [chettiai.de/datenschutz](https://chettiai.de/datenschutz).

## Lizenz

MIT, siehe [LICENSE](LICENSE).
