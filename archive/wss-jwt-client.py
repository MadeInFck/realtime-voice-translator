#!/usr/bin/env python3
## Websocket client SSL + JWT to secure connection
import asyncio
import websockets
import json
import threading
import ssl
import jwt
import os
from dotenv import load_dotenv
import uuid

# Create UUID for this client
user_id = str(uuid.uuid4())

# Get env variables
load_dotenv()

secret = os.getenv("SECRET_KEY")
url = os.getenv("WS_URL") # for production

ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

# Generate JWT token
def generate_token(userid):
    """Generates a JWT token with a simple payload."""
    payload = {"user_id": userid}
    return jwt.encode(payload, secret, algorithm="HS256")


async def handle_messages(websocket):
    """
    Continuously listens to messages received from the server and displays them immediately.
    """
    async for message in websocket:
        try:
            data = json.loads(message)
        except json.JSONDecodeError:
            print("Received message is not a valid JSON.")
            continue

        if data.get("type") == "speech":
            print(f"\nText received: {data.get('text')}")
            # Redisplay the prompt to ensure the user can continue typing
            print("Enter your message: ", end="", flush=True)


async def send_status(websocket, status):
    """
    Sends a "status" type message to indicate the client's status.
    """
    message = json.dumps({"type": "status", "status": status})
    await websocket.send(message)


async def send_text(websocket, text):
    """
    Sends a "speech" type message containing the entered text.
    """
    message = json.dumps({
        "type": "speech",
        "text": text,
        "from": str(websocket.remote_address)
    })
    print("Message sent")
    print(message)
    await websocket.send(message)


async def send_inactive_delay(websocket):
    """
    Waits for a short delay and then sets the client's status to "inactive".
    """
    await asyncio.sleep(0.1)
    await send_status(websocket, "inactive")

async def send_authentication(websocket, token):
    """Sends the authentication message with the JWT token."""
    auth_message = json.dumps({"type": "auth", "token": token})
    await websocket.send(auth_message)


def input_thread(websocket, loop):
    """
    Function executed in a separate thread for user input.
    For each entered message, the corresponding coroutines are scheduled in the loop.
    """
    while True:
        try:
            text = input("Enter your message: ").strip()
        except EOFError:
            break

        if text == "":
            continue  # Ignore empty inputs

        # Schedule the sending of messages in the asynchronous loop via run_coroutine_threadsafe
        asyncio.run_coroutine_threadsafe(send_status(websocket, "active"), loop)
        asyncio.run_coroutine_threadsafe(send_text(websocket, text), loop)
        asyncio.run_coroutine_threadsafe(send_inactive_delay(websocket), loop)


async def start_client():
    """
    Connects to the server and starts tasks for displaying received messages
    and user input via a thread.
    """
    websocket_url = "wss://" + url  # Production: Check URL is correct, Dev mode: switch IP and PORT
    async with websockets.connect(websocket_url, ssl=ssl_context) as websocket:
        print("WebSocket connection established.")

        # Generate and send the JWT token (example with user_id=1)
        token = generate_token(user_id)
        await send_authentication(websocket, token)

        # Get the current asynchronous loop
        loop = asyncio.get_running_loop()
        # Start the thread for user input
        thread = threading.Thread(target=input_thread, args=(websocket, loop), daemon=True)
        thread.start()

        try:
            await handle_messages(websocket)
        except websockets.ConnectionClosed as e:
            print(f"Connection closed: {e}")


if __name__ == "__main__":
    asyncio.run(start_client())
