require('dotenv').config();
const axios  = require('axios');
const https  = require('https');
const crypto = require('crypto');

// Ignorar SSL self-signed del servidor Avigilon local
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ─── Token generator ──────────────────────────────────────────────────────────
// Formato: userNonce:timestamp:sha256(timestamp+userKey)[:integrationId]
function generateToken(userNonce, userKey, integrationId = '') {
  const timestamp  = Math.floor(Date.now() / 1000).toString();
  const encrypted  = crypto
    .createHash('sha256')
    .update(`${timestamp}${userKey}`)
    .digest('hex');

  if (integrationId.length > 0) {
    return `${userNonce}:${timestamp}:${encrypted}:${integrationId}`;
  }
  return `${userNonce}:${timestamp}:${encrypted}`;
}

// ─── WEP Session ─────────────────────────────────────────────────────────────
class WepSession {
  constructor({ baseUrl, userNonce, userKey, username, password, clientName = 'lpr-snapshot-agent' }) {
    this.baseUrl    = baseUrl;
    this.userNonce  = userNonce;
    this.userKey    = userKey;
    this.username   = username;
    this.password   = password;
    this.clientName = clientName;
    this.session    = null;
    this.sessionExpiry = null;
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  // POST /mt/api/rest/v1/login
  // Body: { username, password, clientName, authorizationToken }
  // Respuesta: { status: "success", result: { session, externalUserId, domainId } }
  async login() {
    const authorizationToken = generateToken(this.userNonce, this.userKey);
    const url = `${this.baseUrl}/mt/api/rest/v1/login`;

    console.log('[WEP] Iniciando sesión...');

    const res = await axios.post(url, {
      username:           this.username,
      password:           this.password,
      clientName:         this.clientName,
      authorizationToken,
    }, {
      httpsAgent,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.data?.status !== 'success') {
      throw new Error(`Login fallido: ${JSON.stringify(res.data)}`);
    }

    this.session       = res.data.result.session;
    // Sesión expira tras 1h de inactividad — renovamos cada 50 minutos
    this.sessionExpiry = Date.now() + 50 * 60 * 1000;

    console.log(`[WEP] ✅ Sesión obtenida: ${this.session.substring(0, 20)}...`);
    return this.session;
  }

  // ── Obtener sesión activa (renueva si venció) ──────────────────────────────
  async getSession() {
    if (!this.session || Date.now() >= this.sessionExpiry) {
      await this.login();
    }
    return this.session;
  }

  // ── Listar cámaras ─────────────────────────────────────────────────────────
  // GET /mt/api/rest/v1/cameras?session=...&verbosity=HIGH
  async getCameras(verbosity = 'HIGH') {
    const session = await this.getSession();
    const res = await axios.get(`${this.baseUrl}/mt/api/rest/v1/cameras`, {
      params: { session, verbosity },
      httpsAgent,
      timeout: 10000,
    });

    const cameras = Array.isArray(res.data) ? res.data
      : Array.isArray(res.data?.result?.cameras) ? res.data.result.cameras
      : [];

    console.log(`[WEP] ${cameras.length} cámaras encontradas`);
    return cameras;
  }

  // ── Obtener snapshot JPEG ──────────────────────────────────────────────────
  // GET /mt/api/rest/v1/media?session=...&cameraId=...&format=jpeg&t=<timestamp|live>
  async getSnapshot(cameraId, timestamp = 'live') {
  const session = await this.getSession();
  try {
    const res = await axios.get(`${this.baseUrl}/mt/api/rest/v1/media`, {
      params: { session, cameraId, format: 'jpeg', t: timestamp },
      httpsAgent,
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    return Buffer.from(res.data);
  } catch (err) {
    // Si 403, sesión expirada — forzar re-login y reintentar UNA vez
    if (err.response?.status === 403) {
      console.warn(`[WEP] Sesión expirada, renovando...`);
      this.session = null;
      await this.login();
      const newSession = await this.getSession();
      const res = await axios.get(`${this.baseUrl}/mt/api/rest/v1/media`, {
        params: { session: newSession, cameraId, format: 'jpeg', t: timestamp },
        httpsAgent,
        responseType: 'arraybuffer',
        timeout: 15000,
      });
      return Buffer.from(res.data);
    }
    throw err;
  }
}

  // ── Logout ─────────────────────────────────────────────────────────────────
  // POST /mt/api/rest/v1/logout  body: { session }
  async logout() {
  if (!this.session) return;
  try {
    await axios.post(`${this.baseUrl}/mt/api/rest/v1/logout`,
      { session: this.session },
      { httpsAgent, timeout: 5000, headers: { 'Content-Type': 'application/json' } }
    );
    console.log('[WEP] Sesión cerrada');
  } catch (e) {
    console.warn('[WEP] Error en logout:', e.message);
  } finally {
    this.session = null;
    this.sessionExpiry = null;
  }
}
}

module.exports = { WepSession, generateToken };
