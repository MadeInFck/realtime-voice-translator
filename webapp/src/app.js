import { LANGUAGES } from './config.js';
import { TranslatorWS } from './ws.js';
import { VoiceCapture } from './voice.js';
import { TextToSpeech } from './tts.js';

// ── DOM references ──────────────────────────────────────────────────────────
const setupScreen   = document.getElementById('setup-screen');
const loadingScreen = document.getElementById('loading-screen');
const mainScreen    = document.getElementById('main-screen');
const loadingLog    = document.getElementById('loading-log');
const statusDot     = document.getElementById('status-dot');
const statusText    = document.getElementById('status-text');
const wsDot         = document.getElementById('ws-dot');
const wsText        = document.getElementById('ws-text');
const micBtn        = document.getElementById('mic-btn');
const chat          = document.getElementById('chat');
const startBtn      = document.getElementById('start-btn');
const nameInput     = document.getElementById('name-input');
const usersList     = document.getElementById('users-list');

// ── State ───────────────────────────────────────────────────────────────────
let selectedLanguage = null;
let selectedGender   = null;
let voiceCapture     = null;
let tts              = null;
let ws               = null;
let isListening      = true;
let localUserName    = '';

// ── Setup screen — language & gender selection ───────────────────────────────
function buildSetupUI() {
  const langGrid   = document.getElementById('lang-grid');
  const genderGrid = document.getElementById('gender-grid');

  Object.entries(LANGUAGES).forEach(([key, lang]) => {
    const btn = document.createElement('button');
    btn.className = 'select-btn';
    btn.dataset.value = key;
    btn.innerHTML = `<span class="flag">${lang.flag}</span><span>${lang.label}</span>`;
    btn.onclick = () => {
      langGrid.querySelectorAll('.select-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedLanguage = key;
      checkReady();
    };
    langGrid.appendChild(btn);
  });

  ['Female', 'Male'].forEach((g) => {
    const btn = document.createElement('button');
    btn.className = 'select-btn';
    btn.dataset.value = g;
    btn.textContent = g === 'Female' ? '♀ Féminin' : '♂ Masculin';
    btn.onclick = () => {
      genderGrid.querySelectorAll('.select-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedGender = g;
      checkReady();
    };
    genderGrid.appendChild(btn);
  });

  nameInput.addEventListener('input', checkReady);
}

function checkReady() {
  startBtn.disabled = !(selectedLanguage && selectedGender && nameInput.value.trim());
}

// ── Loading phase ────────────────────────────────────────────────────────────
function log(msg) {
  const p = document.createElement('p');
  p.textContent = '▶ ' + msg;
  loadingLog.appendChild(p);
  loadingLog.scrollTop = loadingLog.scrollHeight;
}

async function initAll() {
  const userName = nameInput.value.trim();
  localUserName = userName;
  setupScreen.hidden = true;
  loadingScreen.hidden = false;

  try {
    // 1. Cheetah STT
    voiceCapture = new VoiceCapture({
      language: selectedLanguage,
      onTranscript: handleTranscript,
      onPartial: () => {},
    });
    await voiceCapture.init(log);

    // 2. Orca TTS
    tts = new TextToSpeech({ language: selectedLanguage, gender: selectedGender });
    await tts.init(log);

    // 3. WebSocket — server handles translation via DeepL
    log('Connexion au serveur…');
    ws = new TranslatorWS({
      onSpeech:       (text, from) => handleIncomingSpeech(text, from),
      onConnected:    () => { setWsStatus('connected'); setStatus('listening'); },
      onDisconnected: () => setWsStatus('disconnected'),
      onError:        () => setWsStatus('error'),
      onReconnecting: () => setWsStatus('reconnecting'),
      onPresence:     (users) => setPresence(users),
    });
    await ws.connect(userName, selectedLanguage);
    log('Connecté !');

    // 4. Start mic capture
    await voiceCapture.startCapture();
    log('Micro actif. Parlez !');

    loadingScreen.hidden = true;
    mainScreen.hidden = false;
    setStatus('listening');
  } catch (err) {
    log('❌ Erreur : ' + err.message);
    console.error(err);
    // Show a back button so the user can retry with different settings
    const backBtn = document.createElement('button');
    backBtn.className = 'btn-primary';
    backBtn.style.marginTop = '1.5rem';
    backBtn.textContent = '← Retour';
    backBtn.onclick = () => {
      loadingScreen.hidden = true;
      loadingLog.innerHTML = '';
      setupScreen.hidden = false;
    };
    loadingLog.appendChild(backBtn);
  }
}

// ── Runtime handlers ─────────────────────────────────────────────────────────

// ── Chat helpers ──────────────────────────────────────────────────────────────
function addBubble(text, type, sender = '') {
  const wrap = document.createElement('div');
  wrap.className = 'bubble bubble--' + type;
  if (sender) {
    const s = document.createElement('div');
    s.className = 'bubble-sender';
    s.textContent = sender;
    wrap.appendChild(s);
  }
  const p = document.createElement('div');
  p.className = 'bubble-text';
  p.textContent = text;
  wrap.appendChild(p);
  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
}

// Called when Cheetah detects a complete phrase (endpoint)
async function handleTranscript(text) {
  if (!ws?.isOpen()) return;
  if (text.trim().length < 3) return; // filter noise artifacts (single chars, "ah", etc.)
  addBubble(text, 'sent');
  setStatus('sending');
  ws.sendSpeech(text);
  // Restore status based on actual mic state (may have been muted mid-phrase)
  if (isListening) {
    setStatus('listening');
  } else {
    statusText.textContent = 'Micro coupé';
    statusDot.className = 'dot dot--red';
  }
}

// Called when we receive a speech message from another user
// Text is already translated by the server — just display and speak it
async function handleIncomingSpeech(text, from) {
  if (!text?.trim()) return;
  addBubble(text, 'recv', from);
  // If the server echoes our own message back, skip TTS
  if (from === localUserName) return;
  setStatus('speaking');
  voiceCapture?.pause();
  try {
    await tts.speak(text);
  } catch (err) {
    console.error('TTS error:', err);
  } finally {
    // Short pause after TTS ends to let room echo die down before re-enabling mic
    await new Promise((r) => setTimeout(r, 300));
    if (isListening) {
      voiceCapture?.resume();
      setStatus('listening');
    } else {
      statusText.textContent = 'Micro coupé';
      statusDot.className = 'dot dot--red';
    }
  }
}

// ── Connected users (presence) ────────────────────────────────────────────────
function setPresence(users) {
  usersList.innerHTML = '';
  // Local user first, then others alphabetically
  const sorted = [
    ...users.filter((n) => n === localUserName),
    ...users.filter((n) => n !== localUserName),
  ];
  sorted.forEach((name) => {
    const pill = document.createElement('span');
    const isSelf = name === localUserName;
    pill.className = 'user-pill' + (isSelf ? ' user-pill--self' : '');
    pill.textContent = name + (isSelf ? ' (moi)' : '');
    usersList.appendChild(pill);
  });
}

// ── WebSocket connection indicator ────────────────────────────────────────────
const WS_STATUS_LABELS = {
  connected:    { text: 'Serveur connecté',   dot: 'green'  },
  disconnected: { text: 'Déconnecté',         dot: 'red'    },
  reconnecting: { text: 'Reconnexion…',       dot: 'orange' },
  error:        { text: 'Erreur serveur',     dot: 'red'    },
};

function setWsStatus(state) {
  const s = WS_STATUS_LABELS[state] || { text: state, dot: 'grey' };
  wsDot.className = 'dot dot--' + s.dot;
  wsText.textContent = s.text;
}

// ── Status helpers ────────────────────────────────────────────────────────────
const STATUS_LABELS = {
  listening:   { text: 'En écoute…',   dot: 'green'  },
  sending:     { text: 'Envoi…',       dot: 'blue'   },
  speaking:    { text: 'Lecture…',     dot: 'purple' },
};

function setStatus(key, extra = '') {
  const s = STATUS_LABELS[key] || { text: key, dot: 'grey' };
  statusText.textContent = s.text + (extra ? ` (${extra})` : '');
  statusDot.className = 'dot dot--' + s.dot;
}

// ── Mic toggle button ────────────────────────────────────────────────────────
micBtn.addEventListener('click', () => {
  isListening = !isListening;
  if (isListening) {
    voiceCapture?.resume();
    micBtn.classList.remove('muted');
    micBtn.classList.add('listening');
    setStatus('listening');
  } else {
    voiceCapture?.pause(); // also resets Cheetah's internal buffer
    micBtn.classList.remove('listening');
    micBtn.classList.add('muted');
    statusText.textContent = 'Micro coupé';
    statusDot.className = 'dot dot--red';
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
buildSetupUI();
startBtn.addEventListener('click', initAll);
