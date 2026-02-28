import { TOKEN_URL } from './config.js';

// Fetch a signed JWT from the server — SECRET_KEY never leaves the server
export async function generateToken() {
  const resp = await fetch(TOKEN_URL);
  if (!resp.ok) throw new Error(`Token fetch failed: ${resp.status}`);
  return (await resp.text()).trim();
}
