import { OrcaWorker } from '@picovoice/orca-web';
import { PV_ACCESS_KEY, LANGUAGES } from './config.js';

// TTS via PicoVoice Orca Web — mirrors pvorca + pvspeaker usage in orca-secure-client.py
// Orca outputs Int16Array PCM at 22050 Hz — played via Web AudioContext
export class TextToSpeech {
  constructor({ language, gender }) {
    this.language = language;
    this.gender = gender; // 'Male' | 'Female'
    this.orca = null;
    this.audioContext = null;
    this.sampleRate = 22050; // matches pvspeaker sample_rate=22050
    this.isSpeaking = false;
  }

  async init(onProgress) {
    onProgress?.('Chargement TTS (Orca)…');
    const modelPath = LANGUAGES[this.language].orcaModels[this.gender];
    // OrcaWorker.create(accessKey, model) — model uses publicPath, not modelPath
    this.orca = await OrcaWorker.create(PV_ACCESS_KEY, {
      publicPath: modelPath,
      customWritePath: `orca_${this.language}_${this.gender}`,
    });
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: this.sampleRate,
    });
    onProgress?.('TTS prêt.');
  }

  // Synthesize text and play it through the browser audio output.
  // Returns a Promise that resolves when playback is complete.
  async speak(text) {
    if (!this.orca || !this.audioContext) return;
    this.isSpeaking = true;

    try {
      const { pcm } = await this.orca.synthesize(text);

      // Convert Int16Array → Float32Array for Web Audio API
      const float32 = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) {
        float32[i] = pcm[i] / 32768;
      }

      const buffer = this.audioContext.createBuffer(1, float32.length, this.sampleRate);
      buffer.copyToChannel(float32, 0);

      await new Promise((resolve) => {
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        source.onended = resolve;
        source.start();
      });
    } finally {
      this.isSpeaking = false;
    }
  }

  async release() {
    await this.orca?.release();
    await this.audioContext?.close();
    this.orca = null;
  }
}
