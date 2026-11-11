// server.js — Middleware LPR Dev
const express = require('express');
const mysql   = require('mysql2/promise');

const app  = express();
const PORT = process.env.PORT || 3005;

// ─── DB Config — solo desde variables de entorno ──────────────────────────────
const dbConfig = {
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// ─── Validar variables de entorno ─────────────────────────────────────────────
['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].forEach(key => {
  if (!process.env[key]) {
    console.error(`[ERROR] Variable de entorno ${key} no definida`);
    process.exit(1);
  }
});

// ─── Raw body + JSON parser ───────────────────────────────────────────────────
const MAX_BODY = 10 * 1024 * 1024; // 10MB

app.use((req, res, next) => {
  let data = '';
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > MAX_BODY) {
      res.status(413).json({ error: 'Payload too large' });
      req.destroy();
      return;
    }
    data += chunk.toString();
  });
  req.on('end', () => { req.rawBody = data; next(); });
});


// ─── Log de errores ───────────────────────────────────────────────────────────
async function logError(endpoint, errorCode, errorMessage, rawBody = '') {
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    await conn.execute(
      `INSERT INTO error_log (endpoint, error_code, error_message, raw_body)
       VALUES (?, ?, ?, ?)`,
      [endpoint, errorCode, errorMessage?.substring(0, 2000), rawBody?.substring(0, 10000)]
    );
  } catch (e) {
    console.error('[error_log] No se pudo registrar:', e.message);
  } finally {
    if (conn) conn.end();
  }
}

// ─── Inserción webhook LPR ────────────────────────────────────────────────────
async function insertLprFound(rawData, res, endpoint) {
  let conn;
  let data;

  try {
    data = JSON.parse(rawData);
  } catch (e) {
    await logError(endpoint, 'JSON_PARSE_ERROR', e.message, rawData);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // HELLO = ping del ACC al crear el webhook, ignorar
  if (data.type === 'HELLO') {
    console.log('[lpr_found] HELLO recibido — ignorado');
    return res.status(200).json({ message: 'ok' });
  }

  if (!data.notifications || data.notifications.length === 0) {
    const msg = 'notifications array missing or empty';
    await logError(endpoint, 'VALIDATION_ERROR', msg, rawData);
    return res.status(400).json({ error: msg });
  }

  const notification = data.notifications[0];
  const event        = notification.event;

  try {
    conn = await mysql.createConnection(dbConfig);
    await conn.execute(`
      INSERT INTO lpr_found (
        siteId, type, time_date, notificationId,
        licensePlate, confidence,
        topLeftX, topLeftY, topRightX, topRightY,
        bottomLeftX, bottomLeftY, bottomRightX, bottomRightY,
        cameraId, thisId, linkedEventId, timestamp,
        originatingEventId, originatingServerName,
        location, eventType, latitude, longitude, originatingServerId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.siteId, data.type, data.time, notification.id,
      event.licensePlate, event.confidence,
      event.roi.topLeft.x,     event.roi.topLeft.y,
      event.roi.topRight.x,    event.roi.topRight.y,
      event.roi.bottomLeft.x,  event.roi.bottomLeft.y,
      event.roi.bottomRight.x, event.roi.bottomRight.y,
      event.cameraId, event.thisId, event.linkedEventId, event.timestamp,
      event.originatingEventId, event.originatingServerName,
      event.location, event.type,
      event.geolocation?.latitude  || null,
      event.geolocation?.longitude || null,
      event.originatingServerId,
    ]);

    console.log(`[lpr_found] ✅ Placa: ${event.licensePlate} | cám: ${event.cameraId?.substring(0,20)}...`);
    res.status(200).json({ message: 'ok' });

  } catch (e) {
    console.error('[lpr_found] Error DB:', e.message);
    await logError(endpoint, e.code || 'DB_ERROR', e.message, rawData);
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) conn.end();
  }
}

// ─── RUTAS — Webhook ACC ──────────────────────────────────────────────────────
app.post('/api/lpr_found', (req, res) => {
  console.log('── POST /api/lpr_found ──');
  insertLprFound(req.rawBody, res, '/api/lpr_found');
});

// ─── RUTAS — Snapshot Agent ───────────────────────────────────────────────────

app.get('/api/lpr/pending-snapshots', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    const [rows] = await conn.execute(`
      SELECT id, cameraId, timestamp,
             topLeftX, topLeftY, bottomRightX, bottomRightY
      FROM lpr_found
      WHERE snapshot_b64 IS NULL
        AND snapshot_status IS NULL
        AND cameraId IS NOT NULL
        AND cameraId != ''
      ORDER BY id DESC
      LIMIT ?
    `, [limit]);
    console.log(`[pending-snapshots] ${rows.length} pendientes`);
    res.json(rows);
  } catch (e) {
    console.error('[pending-snapshots] Error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) conn.end();
  }
});

app.post('/api/lpr/snapshot', async (req, res) => {
  const { id, snapshot_b64, snapshot_full_b64 } = JSON.parse(req.rawBody || '{}');

  if (!id) return res.status(400).json({ error: 'id requerido' });

  const isError = snapshot_b64 === 'ERROR';
  let conn;
  try {
    conn = await mysql.createConnection(dbConfig);
    await conn.execute(`
      UPDATE lpr_found
      SET snapshot_b64      = ?,
          snapshot_full_b64 = ?,
          snapshot_status   = ?
      WHERE id = ?
    `, [isError ? null : snapshot_b64, isError ? null : snapshot_full_b64, isError ? 'ERROR' : 'OK', id]);

    console.log(`[snapshot] ✅ id=${id} → ${isError ? 'ERROR' : 'OK'}`);
    res.json({ ok: true, id });
  } catch (e) {
    console.error('[snapshot] Error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    if (conn) conn.end();
  }
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Middleware escuchando en puerto ${PORT}`);
  console.log(`   DB: ${dbConfig.host}:${dbConfig.port} → ${dbConfig.database}`);
});
