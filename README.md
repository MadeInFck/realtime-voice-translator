# realtime-voice-translator

Real-time bidirectional voice translator over secure WebSocket.
User A speaks in their language → STT → translation → TTS → User B hears in their language, and vice versa.

## Architecture

```
Browser (PWA)                        Server (VPS)                  Browser (PWA)
Mic → Cheetah STT                                                  Orca TTS → Speaker
    → WebSocket (wss://) ──── speech text ────► DeepL translate ──────► WebSocket
                                                                   ◄── translated text
```

- **STT**: PicoVoice Cheetah (runs in browser via WASM)
- **Translation**: DeepL API (server-side, key never exposed to client)
- **TTS**: PicoVoice Orca (runs in browser via WASM)
- **Transport**: WebSocket + JWT auth (token issued by server)
- **Deployment**: Docker + Caddy (HTTPS reverse proxy)

## Supported languages

English, French, German, Spanish, Italian, Portuguese

## Project structure

```
wss-jwt-server.py        # WebSocket server — JWT auth + DeepL translation
webapp/                  # PWA client (Vite + vanilla JS)
  src/
    app.js               # Main orchestration
    voice.js             # Cheetah STT + microphone capture
    tts.js               # Orca TTS + audio playback
    ws.js                # WebSocket client
    auth.js              # JWT token fetch from server
    config.js            # Server URL, PicoVoice key, language models
  public/
    sw.js                # Service worker (PWA cache)
    manifest.json        # PWA manifest
Dockerfile               # Server container
docker-compose.yml       # Server + nginx (PWA static files)
nginx/pwa.conf           # COOP/COEP headers (required for SharedArrayBuffer)
archive/                 # Legacy Python clients (reference only)
```

## Setup

### Server

```bash
cp .env.example .env     # not committed — fill in your keys
# Required env vars:
# SECRET_KEY=<32-byte hex>
# DEEPL_API_KEY=<your DeepL API key>
# WS_PORT=8765

pip install -r requirements-server.txt
python wss-jwt-server.py
```

### PWA client

```bash
cd webapp
cp .env.example .env     # fill in VITE_PV_ACCESS_KEY
npm install
npm run build            # outputs to webapp/dist/
```

### Deploy (Docker)

```bash
docker compose up -d
```

Caddy handles HTTPS (Let's Encrypt) and reverse-proxies both the WebSocket server and the PWA static files.

## Notes

- PicoVoice models (`.pv` files) are not included in the repo (gitignored). Copy them into `webapp/public/models/` before building.
- `PV_ACCESS_KEY` ends up in the compiled JS bundle — unavoidable with browser-side PicoVoice SDKs. Acceptable for private use.
- `SECRET_KEY` never leaves the server — the client fetches a JWT from `GET /token`.
