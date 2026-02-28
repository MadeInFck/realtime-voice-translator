import { PicoLLMWorker } from '@picovoice/picollm-web';
import { PV_ACCESS_KEY, PICOLLM_MODEL_PATH } from './config.js';

// LLM translation via PicoVoice picoLLM Web
// Mirrors TranslateAgent.translate() from translate_agent.py:
//   "Translate following text to {language}: {text}. Output needs to be the translation only."
//
// The .pllm model file is served by nginx from the root models/ directory at /models/.
// picoLLM-web caches the model in IndexedDB after the first load — subsequent
// sessions load from cache without re-downloading the full file.
export class Translator {
  constructor() {
    this.picoLLM = null;
  }

  async init(onProgress) {
    onProgress?.('Chargement du modèle LLM… (première fois : téléchargement depuis le serveur, puis mis en cache)');
    // PicoLLMWorker.create(accessKey, { modelFile }) — modelFile accepts a URL string
    this.picoLLM = await PicoLLMWorker.create(PV_ACCESS_KEY, {
      modelFile: PICOLLM_MODEL_PATH,
    });
    onProgress?.('Modèle LLM prêt.');
  }

  // Translate text to targetLanguage (e.g. 'French', 'Spanish', …)
  // Matches the prompt format in translate_agent.py → TranslateAgent.translate()
  async translate(text, targetLanguage) {
    if (!this.picoLLM) throw new Error('Translator not initialized');
    const prompt = `Translate the following text to ${targetLanguage}: "${text}". Output the translation only.`;
    const result = await this.picoLLM.generate(prompt, {
      completionTokenLimit: 256,
      stopPhrases: ['\n', '"'],
    });
    return result.completion.trim().replace(/^"|"$/g, '');
  }

  async release() {
    await this.picoLLM?.release();
    this.picoLLM = null;
  }
}
