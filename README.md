# Chetti-Helfer

Der Chetti-Helfer ist das Programm, das [Chetti](https://chettiai.de) auf dem Rechner der Praxis installiert. Er nimmt Anfragen der Webapp entgegen und lässt Spracherkennung und Notiz lokal laufen. Gesprächsdaten verlassen den Rechner nicht.

Dieses Repo legt offen, was der Helfer auf dem Rechner tut: was er installiert, welche Rechte er sich holt und wer ihn ansprechen darf.

## Was der Helfer auf dem Rechner tut

- **Lokaler Dienst:** Er lauscht nur auf `127.0.0.1:47813` und antwortet per https. Anfragen nimmt er nur von `chettiai.de` an ([helper/server.mjs](helper/server.mjs)).
- **Zertifikat:** Für https auf `127.0.0.1` erzeugt er ein eigenes Zertifikat, das nur für diese Adresse gilt, und trägt es einmal im Schlüsselbund des Nutzers ein. Dafür fragt das System nach dem Passwort ([helper/tls.mjs](helper/tls.mjs), [helper/trust.mjs](helper/trust.mjs)).
- **Autostart:** Er startet beim Anmelden, auf macOS als LaunchAgent des Nutzers, auf Windows über den Run-Schlüssel des Nutzers. Administratorrechte braucht er nicht ([helper/autostart.mjs](helper/autostart.mjs)).
- **Modelle:** Spracherkennung (whisper.cpp) und Sprachmodell (Ollama) starten erst, wenn eine Konsultation beginnt, und enden nach einigen Minuten ohne Anfrage ([helper/runtime.mjs](helper/runtime.mjs)).
- **Installation:** Das Skript lädt das Paket, entpackt es nach `~/Applications` und startet es ([website/helfer/install.sh](website/helfer/install.sh)).

## Was hier fehlt

Der Helfer lädt zur Laufzeit zwei Teile, die nicht in diesem Repo liegen: die Notiz-Logik (`server/`) und die Wissensbasis (`knowledge/`). Beide sind nicht öffentlich. Der Code hier lässt sich deshalb lesen und prüfen, aber nicht allein bauen oder starten.

## Signatur

Das macOS-Paket ist ad hoc signiert, also ohne Apple-Entwicklerzertifikat. Gatekeeper würde es nach einem Download im Browser ablehnen. Die Installation läuft deshalb über das Skript, das per `curl` lädt:

```
curl -fsSL https://chettiai.de/helfer/install.sh | bash
```

## Lizenz

MIT, siehe [LICENSE](LICENSE). Die Lizenz gilt für die Dateien in diesem Repo.
