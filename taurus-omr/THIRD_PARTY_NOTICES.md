# Componenti di terze parti

Il servizio esegue i motori come programmi separati e non modificati; l'impaginazione usa Verovio e CairoSVG come librerie, non modificate, in un processo separato. I sorgenti delle versioni incluse nell'immagine sono disponibili agli indirizzi indicati.

| Componente | Versione | Licenza | Sorgenti | Uso |
| --- | --- | --- | --- | --- |
| Audiveris | 5.11.0 | AGPL-3.0 | https://github.com/Audiveris/audiveris/tree/5.11.0 | riconoscimento, processo separato |
| homr | 0.7.0 | AGPL-3.0 | https://github.com/liebharc/homr (pacchetto `homr` 0.7.0 su PyPI) | riconoscimento, processo separato |
| Modelli di homr (`onnx_checkpoints`) | segnet 308, transformer 396 | AGPL-3.0; dati di addestramento con licenze diverse, tra cui Camera-PrIMuS (CC BY-NC 4.0) | https://github.com/liebharc/homr/releases/tag/onnx_checkpoints | ammessi perché Taurus non è commerciale |
| RapidOCR e modelli PP-OCR | 3.10.0 | Apache-2.0 | https://github.com/RapidAI/RapidOCR | lettura del testo delle pagine (`/v1/text-recognitions`) e del titolo in homr; modelli PP-OCRv6 small e classificatore dell'orientamento |
| Dati Tesseract (`eng`, `ita`) | 4.1.0 | Apache-2.0 | https://github.com/tesseract-ocr/tessdata/tree/4.1.0 | lettura dei testi in Audiveris |
| music21 | 10.5.2 | BSD-3-Clause | https://github.com/cuthbertLab/music21 | conversione MIDI → MusicXML |
| Verovio | 6.4.1 | LGPL-3.0 | https://github.com/rism-digital/verovio (pacchetto `verovio` 6.4.1 su PyPI) | impaginazione delle parti scritte (`/v1/engravings`) |
| Carattere Leipzig | incluso in Verovio 6.4.1 | SIL OFL 1.1 | https://github.com/rism-digital/leipzig | simboli musicali scritti come testo nelle pagine impaginate |
| CairoSVG, cairocffi | 2.9.1, 1.7.1 | LGPL-3.0, BSD-3-Clause | https://github.com/Kozea/CairoSVG | disegno delle pagine impaginate in PNG e PDF |
| Cairo | pacchetto `libcairo2` di Ubuntu 24.04 | LGPL-2.1 o MPL-1.1 | https://www.cairographics.org | libreria di disegno usata da CairoSVG |
| Liberation Fonts | pacchetto `fonts-liberation` di Ubuntu 24.04 | SIL OFL 1.1 | https://github.com/liberationfonts/liberation-fonts | testi delle pagine impaginate, con le metriche di Times |
| FastAPI, Starlette, Uvicorn | vedi `requirements.txt` | MIT, BSD-3-Clause | https://github.com/fastapi/fastapi | API HTTP |
| Pillow | 13.0.0 | MIT-CMU | https://github.com/python-pillow/Pillow | lettura delle immagini |

Le versioni esatte di tutte le dipendenze Python sono in `requirements.txt`; le impronte SHA-256 di modelli e dati sono in `models.sha256` e quella del pacchetto Audiveris nel `Dockerfile`.
