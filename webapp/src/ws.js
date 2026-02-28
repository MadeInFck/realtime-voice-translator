import { WS_URL } from './config.js';
import { generateToken } from './auth.js';

// WebSocket client — mirrors wss-jwt-client.py + orca-secure-client.py protocol
export class TranslatorWS {
  constructor({ onSpeech, onConnected, onDisconnected, onError, onReconnecting, onPresence }) {
    this.ws = null;
    this.onSpeech = onSpeech;
    this.onConnected = onConnected;
    this.onDisconnected = onDisconnected;
    this.onError = onError;
    this.onReconnecting = onReconnecting;
    this.onPresence = onPresence;
    this._name = '';
    this._lang = 'English';
    this._shouldReconnect = false; // true after first successful open
    this._reconnecting = false;    // true while a reconnect loop is running
    this._reconnectDelay = 2000;   // current backoff delay (ms)
    this._reconnectTimer = null;
    this._intentionalClose = false;
  }

  async connect(name = 'Utilisateur', lang = 'English') {
    this._name = name;
    this._lang = lang;
    this._intentionalClose = false;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = async () => {
        this._shouldReconnect = true;
        this._reconnecting = false;
        this._reconnectDelay = 2000; // reset backoff on success
        try {
          const token = await generateToken();
          // First message must be auth — includes display name and target language
          this.ws.send(JSON.stringify({ type: 'auth', token, name: this._name, lang: this._lang }));
          this.onConnected?.();
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'speech') {
            this.onSpeech?.(data.text, data.from);
          } else if (data.type === 'presence') {
            this.onPresence?.(data.users);
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      this.ws.onclose = (event) => {
        this.onDisconnected?.(event.code);
        // Auto-reconnect only after at least one successful connection
        if (this._shouldReconnect && !this._intentionalClose && !this._reconnecting) {
          this._scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        this.onError?.();
        reject(new Error('WebSocket connection failed'));
      };
    });
  }

  // Exponential backoff reconnect: 2s → 4s → 8s → … → 30s max
  _scheduleReconnect() {
    this._reconnecting = true;
    clearTimeout(this._reconnectTimer);
    this.onReconnecting?.();
    this._reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(this._name, this._lang);
      } catch {
        // connect() failed → retry (onclose already fired, _reconnecting still true)
        this._scheduleReconnect();
      }
    }, this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000);
  }

  // Mirrors the send_status + send_text sequence in orca-secure-client.py
  sendSpeech(text) {
    if (!this.isOpen()) return;
    this.ws.send(JSON.stringify({ type: 'status', status: 'active' }));
    this.ws.send(JSON.stringify({ type: 'speech', text }));
    // Small delay mirrors send_inactive_delay (asyncio.sleep(0.1)) in Python
    setTimeout(() => {
      if (this.isOpen()) {
        this.ws.send(JSON.stringify({ type: 'status', status: 'inactive' }));
      }
    }, 100);
  }

  isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect() {
    this._intentionalClose = true;
    clearTimeout(this._reconnectTimer);
    this.ws?.close();
  }
}
