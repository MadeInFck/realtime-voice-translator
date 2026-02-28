#!/usr/bin/env python3

import asyncio
import websockets
import logging
import os
import ssl
import json
import uuid
import jwt
import deepl
# import picollm
from collections import defaultdict
from dotenv import load_dotenv
import http

# Load .env (ignored if env vars already set by Docker)
load_dotenv()

port   = int(os.getenv("WS_PORT", "8765"))
ip     = os.getenv("WS_IP", "0.0.0.0")
secret = os.getenv("SECRET_KEY")

if not secret:
    raise RuntimeError("SECRET_KEY environment variable is required")

# DeepL translation
DEEPL_API_KEY = os.getenv("DEEPL_API_KEY")
if not DEEPL_API_KEY:
    raise RuntimeError("DEEPL_API_KEY environment variable is required")

# picoLLM — disabled, replaced by DeepL
# PV_ACCESS_KEY   = os.getenv("PV_ACCESS_KEY", "")
# PLLM_MODEL_PATH = os.getenv("PLLM_MODEL_PATH", "/models/gemma-2b-414.pllm")
# pllm = picollm.create(access_key=PV_ACCESS_KEY, model_path=PLLM_MODEL_PATH, device="cpu")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("server.log", mode="a"),
    ],
)

deepl_translator = deepl.Translator(DEEPL_API_KEY)
logging.info("DeepL translator ready.")

# TLS is disabled by default: Caddy (reverse proxy) handles TLS termination.
use_tls = os.getenv("USE_TLS", "false").lower() == "true"
if use_tls:
    ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ssl_context.load_cert_chain(
        certfile=os.getenv("SSL_CERT", "./cert/localhost.crt"),
        keyfile=os.getenv("SSL_KEY",  "./cert/localhost.key"),
    )
else:
    ssl_context = None

# Global clients dict: websocket -> {"status": str, "name": str, "user_id": str, "lang": str}
clients = {}


def create_jwt():
    """Generate a signed JWT with a random user_id (server-side)."""
    user_id = str(uuid.uuid4())
    return jwt.encode({"user_id": user_id}, secret, algorithm="HS256")


def verify_token(token):
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None


async def process_request(connection, request):
    """Intercept HTTP requests before WebSocket upgrade (asyncio websockets API).
    GET /token → return a signed JWT as plain text.
    All other paths → proceed with WebSocket handshake (return None).
    """
    if request.path == "/token":
        token = create_jwt()
        return connection.respond(http.HTTPStatus.OK, token)
    return None


async def broadcast_presence():
    """Send the updated list of connected users to every client."""
    users = [info["name"] for info in clients.values()]
    msg = json.dumps({"type": "presence", "users": users})
    if clients:
        await asyncio.gather(*[ws.send(msg) for ws in list(clients.keys())])


# Maps app language keys → DeepL target language codes
_DEEPL_LANG = {
    'English':    'EN-US',
    'French':     'FR',
    'German':     'DE',
    'Spanish':    'ES',
    'Italian':    'IT',
    'Portuguese': 'PT-PT',
}

async def translate_text(text, target_language):
    """Translate text via DeepL API (non-blocking). Falls back to original on error."""
    target_code = _DEEPL_LANG.get(target_language)
    if not target_code:
        logging.warning(f"Unknown target language: {target_language}")
        return text
    def _call():
        result = deepl_translator.translate_text(text, target_lang=target_code)
        return result.text
    try:
        translated = await asyncio.to_thread(_call)
        logging.info(f"translate {target_language}: {repr(translated)}")
        return translated if translated else text
    except Exception as e:
        logging.error(f"DeepL translation error ({target_language}): {e}")
        return text  # fallback: send original text


async def handler(websocket):
    logging.info(f"Client connected: {websocket.remote_address}")

    # ── Authentication ────────────────────────────────────────────────────────
    try:
        raw = await websocket.recv()
        data = json.loads(raw)
        if data.get("type") != "auth" or "token" not in data:
            await websocket.close(1008, "Invalid authentication message")
            return
        payload = verify_token(data["token"])
        if not payload:
            await websocket.close(1008, "Invalid token")
            return
        name = str(data.get("name", "")).strip() or f"User-{payload.get('user_id', '?')[:6]}"
        user_id = payload.get("user_id", "")
        lang = str(data.get("lang", "English")).strip()
        logging.info(f"Authenticated: {name} ({user_id}) lang={lang}")
    except (json.JSONDecodeError, websockets.ConnectionClosed):
        await websocket.close(1008, "Authentication error")
        return

    # ── Register client & announce presence ───────────────────────────────────
    clients[websocket] = {"status": "inactive", "name": name, "user_id": user_id, "lang": lang}
    await broadcast_presence()

    try:
        async for raw_msg in websocket:
            logging.info(f"Message from {name}: {raw_msg[:120]}")
            try:
                data = json.loads(raw_msg)
            except json.JSONDecodeError:
                continue

            if len(raw_msg) > 10_000:
                logging.warning(f"Oversized message from {name}, ignored")
                continue

            msg_type = data.get("type")

            if msg_type == "status":
                clients[websocket]["status"] = data.get("status", "inactive")

            elif msg_type == "speech":
                try:
                    logging.info("SPEECH ENTRY")
                    clients[websocket]["status"] = "active"
                    text = data.get("text", "")

                    lang_groups = defaultdict(list)
                    for recv_ws, info in list(clients.items()):
                        if recv_ws is not websocket and info["status"] == "inactive":
                            lang_groups[info["lang"]].append(recv_ws)

                    groups_str = str({k: len(v) for k, v in lang_groups.items()})
                    logging.info(f"Speech from {name}: {groups_str}")

                    async def translate_and_send(target_lang, ws_list, src_text, src_name):
                        logging.info(f"Translating to {target_lang}")
                        translated = await translate_text(src_text, target_lang)
                        logging.info(f"Translated: {translated}")
                        out = json.dumps({"type": "speech", "text": translated, "from": src_name})
                        await asyncio.gather(*[w.send(out) for w in ws_list])
                        logging.info(f"Sent to {len(ws_list)} in {target_lang}")

                    if lang_groups:
                        await asyncio.gather(*[
                            translate_and_send(tgt_lang, ws_list, text, name)
                            for tgt_lang, ws_list in list(lang_groups.items())
                        ])
                    else:
                        logging.info(f"No inactive recipients for {name}")

                    clients[websocket]["status"] = "inactive"
                except Exception as e:
                    logging.error(f"SPEECH ERROR: {e}", exc_info=True)

    except websockets.ConnectionClosed:
        logging.info(f"Connection closed: {name}")
    finally:
        del clients[websocket]
        logging.info(f"Client disconnected: {name}")
        await broadcast_presence()


async def main():
    proto = "wss" if ssl_context else "ws"
    logging.info(f"Server starting at {proto}://{ip}:{port}")
    async with websockets.serve(handler, ip, port, ssl=ssl_context, process_request=process_request):
        logging.info(f"Server ready at {proto}://{ip}:{port}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
