require('dotenv').config();
const axios     = require('axios');
const cron      = require('node-cron');
const { WepSession } = require('./wep-session');
const { cropRoi }    = require('./image-crop');

// ─── Config ───────────────────────────────────────────────────────────────────
const WEP_BASE_URL   = process.env.WEP_BASE_URL;
const WEP_USER_NONCE = process.env.WEP_USER_NONCE;
const WEP_USER_KEY   = process.env.WEP_USER_KEY;
const VPS_MIDDLEWARE = process.env.VPS_MIDDLEWARE;
const POLL_INTERVAL_S = parseInt(process.env.POLL_INTERVAL_S || '5');
const BATCH_SIZE      = parseInt(process.env.BATCH_SIZE      || '5');

// ─── State ────────────────────────────────────────────────────────────────────
const wep = new WepSession({
  baseUrl:    WEP_BASE_URL,
  userNonce:  WEP_USER_NONCE,
  userKey:    WEP_USER_KEY,
  username:   process.env.WEP_USERNAME,
  password:   process.env.WEP_PASSWORD,
  clientName: process.env.WEP_CLIENT_NAME || 'lpr-snapshot-agent',
});
let isRunning = false;

// ─── Fetch pending records ────────────────────────────────────────────────────
async function fetchPending() {
  const res = await axios.get(`${VPS_MIDDLEWARE}/api/lpr/pending-snapshots`, {
    params: { limit: BATCH_SIZE },
    timeout: 8000,
  });
  return res.data;
}

// ─── Send both snapshots to middleware ───────────────────────────────────────
async function sendSnapshot(id, snapshot_b64, snapshot_full_b64) {
  await axios.post(`${VPS_MIDDLEWARE}/api/lpr/snapshot`, {
    id,
    snapshot_b64,
    snapshot_full_b64,
  }, {
	  timeout: 10000,
	  maxBodyLength: 10 * 1024 * 1024,    // ← agregar esto
      maxContentLength: 10 * 1024 * 1024, // ← y esto
    });
}

// ─── Process one record ───────────────────────────────────────────────────────
async function processRecord(record) {
  const { id, cameraId, timestamp, topLeftX, topLeftY, bottomRightX, bottomRightY } = record;

  console.log(`[AGENT] Procesando id=${id} cámara ${cameraId.substring(0, 20)}...`);

  try {
    // 1. Obtener JPEG del frame exacto
    const jpegBuffer = await wep.getSnapshot(cameraId, timestamp);
    console.log(`[AGENT] JPEG obtenido (${(jpegBuffer.length / 1024).toFixed(1)} KB)`);

    // 2. Imagen completa en base64
    const snapshot_full_b64 = jpegBuffer.toString('base64');

    // 3. Crop con ROI de la placa
    const roi = { topLeftX, topLeftY, bottomRightX, bottomRightY };
    const snapshot_b64 = await cropRoi(jpegBuffer, roi);
    console.log(`[AGENT] Crop OK (${(snapshot_b64.length / 1024).toFixed(1)} KB base64)`);

    // 4. Enviar ambos al middleware
    await sendSnapshot(id, snapshot_b64, snapshot_full_b64);
    console.log(`[AGENT] ✅ id=${id} snapshot guardado`);

  } catch (err) {
    // Fallback: intentar con live snapshot
    if (err.response?.status === 404 || err.response?.status === 400) {
      console.warn(`[AGENT] Timestamp sin grabación, intentando live para id=${id}`);
      try {
        const jpegBuffer = await wep.getSnapshot(cameraId, 'live');
        const snapshot_full_b64 = jpegBuffer.toString('base64');
        const roi = { topLeftX, topLeftY, bottomRightX, bottomRightY };
        const snapshot_b64 = await cropRoi(jpegBuffer, roi);
        await sendSnapshot(id, snapshot_b64, snapshot_full_b64);
        console.log(`[AGENT] ✅ id=${id} live snapshot guardado (fallback)`);
      } catch (fallbackErr) {
        console.error(`[AGENT] ❌ id=${id} fallback falló:`, fallbackErr.message);
        await sendSnapshot(id, 'ERROR', null);
      }
    } else {
      console.error(`[AGENT] ❌ id=${id} error:`, err.message);
    }
  }
}

// ─── Poll loop ────────────────────────────────────────────────────────────────
async function poll() {
  if (isRunning) return;
  isRunning = true;
  try {
    const pending = await fetchPending();
    if (pending.length === 0) return;
    console.log(`[AGENT] ${pending.length} registros pendientes`);
    for (const record of pending) {
      await processRecord(record);
    }
  } catch (err) {
    console.error('[AGENT] Error en poll:', err.message);
  } finally {
    isRunning = false;
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  console.log('🚀 LPR Snapshot Agent iniciando...');
  console.log(`   WEP:        ${WEP_BASE_URL}`);
  console.log(`   VPS:        ${VPS_MIDDLEWARE}`);
  console.log(`   Intervalo:  ${POLL_INTERVAL_S}s`);
  console.log(`   Batch size: ${BATCH_SIZE}`);

  await wep.login();
  await poll();
  cron.schedule(`*/${POLL_INTERVAL_S} * * * * *`, poll);
}

start().catch(err => {
  console.error('[AGENT] Error fatal en startup:', err);
  process.exit(1);
});
