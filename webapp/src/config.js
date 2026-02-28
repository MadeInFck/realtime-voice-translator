// WebSocket server — port 443 géré par Caddy (reverse proxy du VPS)
export const WS_URL = 'wss://live-translator.madeinfck.com';

// Token endpoint — server issues JWT, SECRET_KEY never leaves the server
export const TOKEN_URL = 'https://live-translator.madeinfck.com/token';

// PicoVoice access key — set VITE_PV_ACCESS_KEY in webapp/.env (gitignored)
// Note: visible in the compiled JS bundle (client-side SDK limitation, acceptable for private use)
export const PV_ACCESS_KEY = import.meta.env.VITE_PV_ACCESS_KEY;

// picoLLM model path — served by nginx from the root models/ directory
// File: models/gemma-2b-414.pllm (mounted in nginx at /models/)
export const PICOLLM_MODEL_PATH = '/models/gemma-2b-414.pllm';

// Cheetah endpoint detection (seconds of silence = end of phrase)
export const ENDPOINT_DURATION_SEC = 1.2;

// Supported languages — model paths relative to /public/models/ in Vite
export const LANGUAGES = {
  English: {
    label: 'English',
    flag: '🇬🇧',
    cheetahModel: '/models/cheetah_params.pv',
    orcaModels: {
      Male:   '/models/orca_params_en_male.pv',
      Female: '/models/orca_params_en_female.pv',
    },
  },
  French: {
    label: 'Français',
    flag: '🇫🇷',
    cheetahModel: '/models/cheetah_params_fr.pv',
    orcaModels: {
      Male:   '/models/orca_params_fr_male.pv',
      Female: '/models/orca_params_fr_female.pv',
    },
  },
  German: {
    label: 'Deutsch',
    flag: '🇩🇪',
    cheetahModel: '/models/cheetah_params_de.pv',
    orcaModels: {
      Male:   '/models/orca_params_de_male.pv',
      Female: '/models/orca_params_de_female.pv',
    },
  },
  Spanish: {
    label: 'Español',
    flag: '🇪🇸',
    cheetahModel: '/models/cheetah_params_es.pv',
    orcaModels: {
      Male:   '/models/orca_params_es_male.pv',
      Female: '/models/orca_params_es_female.pv',
    },
  },
  Italian: {
    label: 'Italiano',
    flag: '🇮🇹',
    cheetahModel: '/models/cheetah_params_it.pv',
    orcaModels: {
      Male:   '/models/orca_params_it_male.pv',
      Female: '/models/orca_params_it_female.pv',
    },
  },
  Portuguese: {
    label: 'Português',
    flag: '🇵🇹',
    cheetahModel: '/models/cheetah_params_pt.pv',
    orcaModels: {
      Male:   '/models/orca_params_pt_male.pv',
      Female: '/models/orca_params_pt_female.pv',
    },
  },
};
