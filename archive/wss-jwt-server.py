#!/usr/bin/env python3

import asyncio
import websockets
import logging
import os
import ssl
import json
import jwt
from dotenv import load_dotenv

# Configure logging to write in "server.log" in append mode
logging.basicConfig(
    level=logging.INFO,
    filename="server.log",
    filemode="a",
    format="%(asctime)s %(message)s"
)

# Create SSL context, .crt and .key files are needed
# Self signed certificates generated in development mode, use signing authority in production like Letsecrypt
ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ssl_context.load_cert_chain(certfile='./cert/localhost.crt', keyfile='./cert/localhost.key')

# Get env variables for dev mode
load_dotenv()
port = os.getenv("WS_PORT")
ip = os.getenv("WS_IP")
secret = os.getenv("SECRET_KEY")
# Global dictionary of clients: websocket -> status ("active" or "inactive")
clients = {}

def verify_token(token):
    """Verifies the validity of the JWT token and returns the payload if valid."""
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return payload
    except jwt.InvalidTokenError:
        return None

async def handler(websocket):
    logging.info(f"Client connected: {websocket.remote_address}")
    print(f"Client connected: {websocket.remote_address}")

    # Wait for the authentication message
    try:
        auth_message = await websocket.recv()
        data = json.loads(auth_message)
        if data.get("type") != "auth" or "token" not in data:
            # Close the connection if the authentication message is invalid
            await websocket.close(1008, "Invalid authentication message")
            return
        token = data["token"]
        payload = verify_token(token)
        if not payload:
            # Close the connection if the token is invalid
            await websocket.close(1008, "Invalid token")
            return
        # Log and print the authenticated client
        logging.info(f"Authenticated client: {payload}")
        print(f"Authenticated client: {payload}")
    except (json.JSONDecodeError, websockets.ConnectionClosed):
        await websocket.close(1008, "Authentication error")
        return


    # Add the client with a default "inactive" status
    clients[websocket] = "inactive"
    try:
        async for message in websocket:
            # Log the received message in the log file
            logging.info(f"Message received from {websocket.remote_address}: {message}")

            # Mark the sender as "active"
            clients[websocket] = "active"

            # Broadcast the message to all clients with the "inactive" status
            broadcast_clients = [
                ws for ws, status in clients.items() if status == "inactive"
            ]
            if broadcast_clients:
                await asyncio.gather(*[ws.send(message) for ws in broadcast_clients])

            # Set the sender's status back to "inactive"
            clients[websocket] = "inactive"
    except websockets.ConnectionClosed:
        logging.info(f"Connection closed: {websocket.remote_address}")
        print(f"Connection closed: {websocket.remote_address}")
    finally:
        # Cleanup when the client disconnects
        del clients[websocket]
        logging.info(f"Client disconnected: {websocket.remote_address}")
        print(f"Client disconnected: {websocket.remote_address}")


async def main():


    async with websockets.serve(handler, ip, port, ssl=ssl_context):
        print(f"Server started at wss://{ip}:{port}")
        await asyncio.Future()  # Keeps the server running indefinitely


if __name__ == "__main__":
    asyncio.run(main())
