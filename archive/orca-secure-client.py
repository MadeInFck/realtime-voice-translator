#!/usr/bin/env python3
import asyncio
import websockets
import json
import threading
import pvorca
import pvspeaker
import pvcheetah
import pvrecorder
from translate_agent import TranslateAgent
from dotenv import load_dotenv
import os
import jwt
import ssl
import uuid

user_id = str(uuid.uuid4())

recon_model_mapping = {
    "English": "./models/cheetah_params.pv",
    "French": "./models/cheetah_params_fr.pv",
    "German": "./models/cheetah_params_de.pv",
    "Italian": "./models/cheetah_params_it.pv",
    "Portuguese": "./models/cheetah_params_pt.pv",
    "Spanish": "./models/cheetah_params_es.pv",
}

speak_model_mapping = {
    "Male French": "./models/orca_params_fr_male.pv",
    "Female French": "./models/orca_params_fr_female.pv",
    "Male English": "./models/orca_params_en_male.pv",
    "Female English": "./models/orca_params_en_female.pv",
    "Male German": "./models/orca_params_de_male.pv",
    "Female German": "./models/orca_params_de_female.pv",
    "Male Italian": "./models/orca_params_it_male.pv",
    "Female Italian": "./models/orca_params_it_female.pv",
    "Male Spanish": "./models/orca_params_es_male.pv",
    "Female Spanish": "./models/orca_params_es_female.pv",
    "Male Portuguese": "./models/orca_params_pt_male.pv",
    "Female Portuguese": "./models/orca_params_pt_female.pv",
}

load_dotenv()
port = os.getenv("WS_PORT") # for dev mode
ip = os.getenv("WS_IP") # for dev mode
access_key = os.getenv("PV_ACCESS_KEY")
secret = os.getenv("SECRET_KEY")
url = os.getenv("WS_URL") # for production once deployed at url

# Set threading event to sequence recorder role
recorder_control = threading.Event()
recorder_control.set()  # Recorder is initially active

def generate_token(user_id):
    payload = {"user_id": user_id}
    return jwt.encode(payload, secret, algorithm="HS256")

async def handle_messages(websocket, loop, recorder, speaker, agent, orca):
    async for message in websocket:
        try:

            data = json.loads(message)

            if data.get("type") == "speech":
                recorder_control.clear()
                speaker.start()
                text = data.get("text")
                message_translated = agent.translate(text)
                print("Message translated:", message_translated, " depuis ", text)
                pcm, alignments = orca.synthesize(text=message_translated)
                print("After synthesize")
                speaker.flush(pcm)
                print("Afer flush")
                speaker.stop()
                print("After stop")
                recorder_control.set()
                print("After control set")

        except json.JSONDecodeError:
            print("Received message is not a valid JSON.")
        except Exception as e:
            print(f"Erreur dans handle_messages : {e}")
            recorder_control.set()  # Réactiver l'enregistrement même en cas d'erreur
            print("Recorder control set après erreur")

async def send_status(websocket, status):
    message = json.dumps({"type": "status", "status": status, "from": str(websocket.remote_address)})
    await websocket.send(message)

async def send_text(websocket, text):
    message = json.dumps({
        "type": "speech",
        "text": text,
        "from": str(websocket.remote_address)
    })
    await websocket.send(message)

async def send_inactive_delay(websocket):
    await asyncio.sleep(0.1)
    await send_status(websocket, "inactive")

async def send_authentication(websocket, token):
    auth_message = json.dumps({"type": "auth", "token": token})
    await websocket.send(auth_message)

def capture_audio_thread(websocket, loop, recorder, cheetah):
    try:
        recorder.start()
        print('Listening... (press Ctrl+C to stop)')

        transcript = ""
        while True:
            #print("Recorder thread est en écoute: ", recorder_control.is_set())
            # Wait for event to be defined
            recorder_control.wait()
            partial_transcript, is_endpoint = cheetah.process(recorder.read())
            transcript += partial_transcript
            if is_endpoint:
                final_transcript = cheetah.flush()
                print(transcript+final_transcript)
                asyncio.run_coroutine_threadsafe(send_status(websocket, "active"), loop)
                asyncio.run_coroutine_threadsafe(send_text(websocket, transcript + final_transcript), loop)
                asyncio.run_coroutine_threadsafe(send_inactive_delay(websocket), loop)
                transcript = ""
                recorder_control.set()

    except Exception as error:
        print("Error while capturing audio : ", error)
    except KeyboardInterrupt:
        pass
    finally:
        print("Transcription stopped.")
        recorder.stop()

async def start_client(recorder, speaker, agent, orca, cheetah):
    websocket_url = "wss://" + url     # Dev mode: f"wss://{ip}:{port}"
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE

    async with websockets.connect(websocket_url, ssl=ssl_context) as websocket:
        print(f"WebSocket connection established at wss://{websocket_url}.")#Dev mode {ip}:{port}

        token = generate_token(user_id)
        await send_authentication(websocket, token)

        loop = asyncio.get_running_loop()
        recorder_control.set()
        thread = threading.Thread(target=capture_audio_thread, args=(websocket, loop, recorder, cheetah), daemon=True)
        thread.start()
        await handle_messages(websocket, loop, recorder, speaker, agent, orca)

def print_decorator(n):
    print("="*n)

def select_device_audio_capture():
    print_decorator(50)
    print("Available devices to capture audio : ")
    devices = pvrecorder.PvRecorder.get_available_devices()
    for idx, device in enumerate(devices):
        print(f"{idx + 1}. {device}")

    choice = int(input("Select a device to capture audio: ")) - 1
    print_decorator(50)
    if 0 <= choice < len(devices):
        return choice
    else:
        print("Invalid selection. First model in list will be used by default.")
        return 0

def select_device_audio_speak():
    print_decorator(50)
    print("Available devices to speak audio : ")
    devices = pvspeaker.PvSpeaker.get_available_devices()
    for idx, device in enumerate(devices):
        print(f"{idx + 1}. {device}")

    choice = int(input("Select a device to speak audio: ")) - 1
    print_decorator(50)
    if 0 <= choice < len(devices):
        return choice
    else:
        print("Invalid selection. First model in list will be used by default.")
        return 0

def run():
    agent = TranslateAgent()
    agent.choose_model()
    agent.select_language()
    agent.select_gender_speak()

    device_listen = select_device_audio_capture()
    recorder = pvrecorder.PvRecorder(frame_length=512, device_index=device_listen, buffered_frames_count=50)
    device_speak = select_device_audio_speak()
    print(f"→ PV Recorder v{recorder.version} started.")

    cheetah = pvcheetah.create(access_key=access_key, model_path=recon_model_mapping[agent._language], endpoint_duration_sec=2, enable_automatic_punctuation=True)
    print(f"→ PV Cheetah v{cheetah.version} started with language {agent._language}.")

    orca = pvorca.create(access_key=access_key, model_path=speak_model_mapping[f"{agent._gender_speak} {agent._language}"])
    print(f"→ PV Orca v{orca.version} started with {agent._gender_speak} voice.")

    speaker = pvspeaker.PvSpeaker(
        sample_rate=22050,
        bits_per_sample=16,
        buffer_size_secs=20,
        device_index=device_speak)
    print(f"→ PV Speaker v{speaker.version} started.")

    print("PV Speaker selected : ", speaker.selected_device)
    print("PV Recoder selected : ", recorder.selected_device)
    print_decorator(50)

    try:
        asyncio.run(start_client(recorder, speaker, agent, orca, cheetah))
    except KeyboardInterrupt:
        print("Client stopped by user.")
    finally:
        try:
            speaker.stop()
            print("PV Speaker stopped.")
            speaker.delete()
            print("PV Speaker resources released.")
            orca.delete()
            print("PV Orca resources released.")
            cheetah.delete()
            print("PV Cheetah resources released.")
            recorder.stop()
            print("PV Recorder stopped.")
            recorder.delete()
            print("PV Recorder released.")
        except Exception as e:
            print(f"Error while shutting down : {e}")

if __name__ == "__main__":
    run()