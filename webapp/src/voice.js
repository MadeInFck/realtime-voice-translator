import { CheetahWorker } from '@picovoice/cheetah-web';
import { PV_ACCESS_KEY, LANGUAGES, ENDPOINT_DURATION_SEC } from './config.js';

// STT via PicoVoice Cheetah Web — mirrors pvcheetah usage in orca-secure-client.py
// Audio capture via Web Audio API (MediaStream → ScriptProcessor → Cheetah)
export class VoiceCapture {
  constructor({ language, onTranscript, onPartial }) {
    this.language = language;
    this.onTranscript = onTranscript; // called when endpoint detected (complete phrase)
    this.onPartial = onPartial;       // called for intermediate partial text
    this.cheetah = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.processor = null;
    this.active = false;
    this._partialBuffer = '';
  }

  async init(onProgress) {
    onProgress?.('Chargement STT (Cheetah)…');
    const langConfig = LANGUAGES[this.language];
    // CheetahWorker.create(accessKey, transcriptCallback, model, options)
    // Callback receives CheetahTranscript object: { transcript, isEndpoint, isFlushed }
    this._suppressCallback = false; // true while paused — discards Cheetah callbacks

    this.cheetah = await CheetahWorker.create(
      PV_ACCESS_KEY,
      (cheetahTranscript) => {
        if (this._suppressCallback) { this._partialBuffer = ''; return; }
        this._partialBuffer += cheetahTranscript.transcript;
        this.onPartial?.(this._partialBuffer);
        if ((cheetahTranscript.isEndpoint || cheetahTranscript.isFlushed) && this._partialBuffer.trim()) {
          this.onTranscript(this._partialBuffer.trim());
          this._partialBuffer = '';
        }
      },
      // Model (3rd arg): publicPath served from /models/
      { publicPath: langConfig.cheetahModel, customWritePath: `cheetah_${this.language}` },
      // Options (4th arg, separate from model)
      { endpointDurationSec: ENDPOINT_DURATION_SEC, enableAutomaticPunctuation: true }
    );
    onProgress?.('STT prêt.');
  }

  async startCapture() {
    // Request microphone — 16kHz mono, matching pvrecorder config in Python
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });

    const source = this.audioContext.createMediaStreamSource(this.mediaStream);

    // ScriptProcessor is deprecated but widely supported on mobile browsers.
    // bufferSize 512 matches Python pvrecorder frame_length=512
    this.processor = this.audioContext.createScriptProcessor(512, 1, 1);
    // Noise gate threshold: RMS below this value → treat as silence.
    // ~0.01 ≈ -40 dB. Raise if Cheetah still picks up background noise.
    this._noiseThreshold = 0.01;

    this.processor.onaudioprocess = async (e) => {
      if (!this.active || !this.cheetah) return;
      const float32 = e.inputBuffer.getChannelData(0);

      // Noise gate: compute RMS; if below threshold send silence to Cheetah
      let sumSq = 0;
      for (let i = 0; i < float32.length; i++) sumSq += float32[i] * float32[i];
      const rms = Math.sqrt(sumSq / float32.length);
      const int16 = new Int16Array(float32.length); // zeros by default
      if (rms >= this._noiseThreshold) {
        for (let i = 0; i < float32.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32768)));
        }
      }

      try {
        await this.cheetah.process(int16);
      } catch (err) {
        console.error('Cheetah process error:', err);
      }
    };

    source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
    this.active = true;
  }

  pause() {
    this.active = false;
    this._suppressCallback = true;
    this._partialBuffer = '';
    // Flush Cheetah's internal buffer to prevent stale audio resurfacing on resume.
    // The callback will be discarded via _suppressCallback.
    // Promise.resolve() wraps safely whether flush() returns a Promise or undefined.
    if (this.cheetah) Promise.resolve(this.cheetah.flush()).catch(() => {});
  }

  // Flush remaining partial transcript and send it as a complete phrase
  async flush() {
    if (this._partialBuffer.trim() && this.cheetah) {
      await this.cheetah.flush();
    }
  }

  resume() {
    this._partialBuffer = '';
    this._suppressCallback = false;
    this.active = true;
  }

  async release() {
    this.active = false;
    this.processor?.disconnect();
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    await this.audioContext?.close();
    await this.cheetah?.release();
    this.cheetah = null;
  }
}
