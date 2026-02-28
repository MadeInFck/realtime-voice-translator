#!/usr/bin/env python3
## Websocket client SSL only to secure connection

import asyncio
import websockets
import json
import threading
import ssl

ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

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
    websocket_url = "wss://172.20.10.2:8765"  # Verify that the URL and port are correct
    async with websockets.connect(websocket_url, ssl=ssl_context) as websocket:
        print("WebSocket connection established.")
        # Get the current asynchronous loop
        loop = asyncio.get_running_loop()
        # Start the thread for user input
        thread = threading.Thread(target=input_thread, args=(websocket, loop), daemon=True)
        thread.start()
        # Stay in the reception of messages
        await handle_messages(websocket)


if __name__ == "__main__":
    asyncio.run(start_client())
