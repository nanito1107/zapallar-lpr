/**
 * test-wep.js — Diagnóstico WEP
 * Correr LOCALMENTE (fuera de Docker) para validar conectividad:
 *   node test-wep.js
 */
require('dotenv').config();
const { WepSession } = require('./wep-session');

const wep = new WepSession({
  baseUrl:    process.env.WEP_BASE_URL,
  userNonce:  process.env.WEP_USER_NONCE,
  userKey:    process.env.WEP_USER_KEY,
  username:   process.env.WEP_USERNAME,
  password:   process.env.WEP_PASSWORD,
  clientName: process.env.WEP_CLIENT_NAME || 'lpr-snapshot-agent',
});

async function main() {
  console.log('=== WEP Diagnostic ===\n');
  console.log('URL:       ', process.env.WEP_BASE_URL);
  console.log('Username:  ', process.env.WEP_USERNAME);
  console.log('ClientName:', process.env.WEP_CLIENT_NAME || 'lpr-snapshot-agent');
  console.log('');

  // 1. Login
  console.log('── 1. LOGIN ────────────────────────────');
  await wep.login();
  console.log('');

  // 2. Listar cámaras
  console.log('── 2. CAMERAS ──────────────────────────');
  const cameras = await wep.getCameras('LOW');
  cameras.forEach((cam, i) => {
    console.log(`  [${i+1}] id:    ${cam.id}`);
    console.log(`       name:  ${cam.name || cam.logicalName || '?'}`);
    console.log(`       state: ${cam.state || cam.connectionState || '?'}`);
  });
  console.log('');

  // 3. Snapshot live de la primera cámara
  if (cameras.length > 0) {
    const cam = cameras[0];
    console.log('── 3. SNAPSHOT (live) ──────────────────');
    console.log('  cameraId:', cam.id);
    try {
      const jpeg = await wep.getSnapshot(cam.id, 'live');
      console.log(`  ✅ JPEG recibido: ${(jpeg.length / 1024).toFixed(1)} KB`);
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
      if (err.response) console.log(`     Status: ${err.response.status}`);
    }
    console.log('');
  }

  // 4. Logout
  console.log('── 4. LOGOUT ───────────────────────────');
  await wep.logout();
  console.log('\n=== OK ===');
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  if (err.response) {
    console.error('   Status:', err.response.status);
    console.error('   Body:  ', JSON.stringify(err.response.data));
  }
  process.exit(1);
});
