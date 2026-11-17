'use strict';
// Procesa la cola adminAcciones/ (E3b): «eliminar» usuario y «reset» (correo de restablecimiento de contraseña).
// Uso: node scripts/procesar-acciones.js [--dry]
//   --dry  muestra qué haría, sin escribir, borrar ni enviar correos
// Entorno: FIREBASE_SERVICE_ACCOUNT (secret) y FIREBASE_WEB_API_KEY (secret, solo para «reset»).
// Los logs son públicos: solo id de acción, tipo y estado (nunca uids, correos, nicks ni claves).
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const { ejecutar } = require('../lib/procesar');

const DB_URL = process.env.FIREBASE_DB_URL || 'https://quiniela-clausura-2027-default-rtdb.firebaseio.com';
const DRY = process.argv.includes('--dry');

async function main() {
  const crudo = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!crudo) throw new Error('Falta el secret FIREBASE_SERVICE_ACCOUNT');
  let cuenta;
  try { cuenta = JSON.parse(crudo); } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido'); }
  const app = initializeApp({ credential: cert(cuenta), databaseURL: DB_URL });
  try {
    const r = await ejecutar({
      db: getDatabase(app), auth: getAuth(app), fetchFn: fetch,
      key: process.env.FIREBASE_WEB_API_KEY || '', ahora: Date.now(), dry: DRY, log: (t) => console.log(t),
    });
    if (DRY) console.log('--dry: no se escribió nada.');
    // Rojo si alguna acción terminó en error: GitHub avisa por correo y el historial del panel muestra el detalle.
    if (r.hayErrores) process.exitCode = 1;
  } finally {
    await deleteApp(app);
  }
}

main().catch((e) => {
  console.error('Error: ' + (e && e.code ? e.code + ' - ' : '') + (e && e.message ? String(e.message).slice(0, 200) : 'desconocido'));
  process.exit(1);
});
