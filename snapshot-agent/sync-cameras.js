/**
 * sync-cameras.js
 * Lee las cámaras de cada servidor WEP y las guarda en la tabla camera_map
 * Uso: node sync-cameras.js
 */
require('dotenv').config();
const axios  = require('axios');
const https  = require('https');
const mysql  = require('mysql2/promise');
const { WepSession } = require('./wep-session');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const dbConfig = {
  host:     process.env.DB_HOST     || 'mariadb-dev',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER     || 'middleware_user',
  password: process.env.DB_PASSWORD || 'devpass123',
  database: process.env.DB_NAME     || 'middle',
};

const WEP_CREDENTIALS = {
  userNonce:  process.env.WEP_USER_NONCE,
  userKey:    process.env.WEP_USER_KEY,
  username:   process.env.WEP_USERNAME,
  password:   process.env.WEP_PASSWORD,
  clientName: process.env.WEP_CLIENT_NAME || 'lpr-snapshot-agent',
};

// Servidores a sincronizar
const SERVERS = [
  { baseUrl: 'https://192.168.10.167:443',  label: 'ENVR2-PLUS'       },
  { baseUrl: 'https://172.29.235.224:8443', label: 'WIN-SQR5RUMVS1K'  },
];

async function ensureTable(conn) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS camera_map (
      cameraId    VARCHAR(120) NOT NULL PRIMARY KEY,
      name        VARCHAR(200) NULL,
      serverLabel VARCHAR(100) NULL,
      serverUrl   VARCHAR(200) NULL,
      ipAddress   VARCHAR(100) NULL,
      active      TINYINT(1)   DEFAULT 1,
      updatedAt   DATETIME     DEFAULT current_timestamp() ON UPDATE current_timestamp()
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log('[DB] Tabla camera_map lista');
}

async function syncServer(server, conn) {
  console.log(`\n── Sincronizando ${server.label} (${server.baseUrl}) ──`);

  const wep = new WepSession({ baseUrl: server.baseUrl, ...WEP_CREDENTIALS });
  await wep.login();
  const cameras = await wep.getCameras('LOW');

  console.log(`   ${cameras.length} cámaras encontradas`);

  let inserted = 0, updated = 0;
  for (const cam of cameras) {
    const [rows] = await conn.execute(
      'SELECT cameraId FROM camera_map WHERE cameraId = ?', [cam.id]
    );

    if (rows.length === 0) {
      await conn.execute(`
        INSERT INTO camera_map (cameraId, name, serverLabel, serverUrl, ipAddress)
        VALUES (?, ?, ?, ?, ?)
      `, [cam.id, cam.name || cam.logicalName || cam.id, server.label, server.baseUrl, cam.ipAddress || null]);
      inserted++;
    } else {
      await conn.execute(`
        UPDATE camera_map SET name=?, serverLabel=?, serverUrl=?, ipAddress=?, active=1
        WHERE cameraId=?
      `, [cam.name || cam.logicalName || cam.id, server.label, server.baseUrl, cam.ipAddress || null, cam.id]);
      updated++;
    }

    console.log(`   ${cam.id.substring(0, 25)}... → ${cam.name || '(sin nombre)'}`);
  }

  console.log(`   ✅ ${inserted} insertadas, ${updated} actualizadas`);
  await wep.logout();
}

async function main() {
  console.log('=== Camera Sync ===\n');

  const conn = await mysql.createConnection(dbConfig);
  await ensureTable(conn);

  for (const server of SERVERS) {
    try {
      await syncServer(server, conn);
    } catch (e) {
      console.error(`❌ Error en ${server.label}:`, e.message);
    }
  }

  // Mostrar resultado final
  const [rows] = await conn.execute(`
    SELECT cameraId, name, serverLabel, ipAddress
    FROM camera_map ORDER BY serverLabel, name
  `);

  console.log(`\n── Tabla camera_map (${rows.length} cámaras) ──`);
  rows.forEach(r => {
    console.log(`  [${r.serverLabel}] ${r.name} | ${r.ipAddress || '?'}`);
    console.log(`    ${r.cameraId.substring(0, 40)}...`);
  });

  await conn.end();
  console.log('\n=== Sync completado ===');
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
