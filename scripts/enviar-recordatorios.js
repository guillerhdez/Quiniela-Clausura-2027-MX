'use strict';
// Avisos push (Fase F): recordatorio por Jornada (y por ida/vuelta de la Liguilla) a los usuarios y aviso de pendientes al admin.
// Uso: node scripts/enviar-recordatorios.js [--dry]
//   --dry  muestra qué enviaría, sin enviar ni escribir
// Entorno: FIREBASE_SERVICE_ACCOUNT, VAPID_PUBLIC, VAPID_PRIVATE (secrets). VAPID_SUBJECT es opcional.
// Los logs son públicos: solo conteos (nunca uids, endpoints, nicks ni claves).
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const webpush = require('web-push');
const R = require('../lib/recordatorios');

const DB_URL = process.env.FIREBASE_DB_URL || 'https://quiniela-clausura-2027-default-rtdb.firebaseio.com';
const DRY = process.argv.includes('--dry');
const LOTE = 20;

async function enviarA(subs, mensaje, dry) {
  // subs: { uid: suscripcion }. Devuelve { enviados, fallidos, muertas: [uid] }
  const entradas = Object.entries(subs).filter(([, s]) => R.suscripcionValida(s));
  const r = { enviados: 0, fallidos: 0, muertas: [], validas: entradas.length };
  if (dry) return r;
  const cuerpo = JSON.stringify(mensaje);
  for (let i = 0; i < entradas.length; i += LOTE) {
    const lote = entradas.slice(i, i + LOTE);
    const res = await Promise.allSettled(lote.map(([, s]) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, cuerpo, { TTL: 6 * 3600, urgency: 'normal' })));
    res.forEach((x, k) => {
      if (x.status === 'fulfilled') r.enviados++;
      else if (R.esSuscripcionMuerta(x.reason && x.reason.statusCode)) r.muertas.push(lote[k][0]);
      else r.fallidos++;
    });
  }
  return r;
}

async function main() {
  const crudo = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!crudo) throw new Error('Falta el secret FIREBASE_SERVICE_ACCOUNT');
  const pub = process.env.VAPID_PUBLIC, priv = process.env.VAPID_PRIVATE;
  if (!pub || !priv) throw new Error('Faltan los secrets VAPID_PUBLIC y VAPID_PRIVATE');
  let cuenta;
  try { cuenta = JSON.parse(crudo); } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido'); }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://clausura-mx-2027.netlify.app', pub, priv);

  const app = initializeApp({ credential: cert(cuenta), databaseURL: DB_URL });
  try {
    const db = getDatabase(app);
    const leer = async (ruta) => (await db.ref(ruta).get()).val();
    const [partidos, resultados, notificado, subs, admins, pend, pendCal, solicBorrado] = await Promise.all([
      leer('partidos'), leer('resultados'), leer('notificado'), leer('pushSubs'), leer('admins'), leer('pendientes'), leer('pendientesPartidos'), leer('solicitudesBorrado'),
    ]);
    const ahora = Date.now();
    const subsTodas = subs || {};
    const actualizaciones = {};
    let hayFallos = false;
    const muertas = new Set();
    console.log('Suscripciones: ' + Object.keys(subsTodas).length);

    // 1) Recordatorio de Jornada o de Liguilla (ida / vuelta): como mucho uno por corrida, el más próximo
    const aviso = R.proximoAviso(partidos, resultados, notificado, ahora);
    if (!aviso) console.log('Recordatorio: nada por avisar.');
    else {
      const r = await enviarA(subsTodas, aviso.mensaje, DRY);
      console.log('Recordatorio ' + aviso.etiqueta + ': suscripciones válidas ' + r.validas + ', enviados ' + r.enviados + ', fallidos ' + r.fallidos + (DRY ? ' (dry)' : ''));
      r.muertas.forEach((u) => muertas.add(u));
      if (r.fallidos) hayFallos = true;
      // Se marca como avisado solo si llegó a alguien: sin suscriptores o con todo fallido se reintenta en la siguiente corrida.
      if (!DRY && r.enviados > 0) actualizaciones['notificado/' + aviso.marca] = ahora;
    }

    // 2) Aviso al admin por pendientes nuevos o cambiados (resultados, calendario y solicitudes de eliminación de cuenta)
    const previo = (notificado && notificado.admin) || {};
    const { nuevos, vistos } = R.pendientesPorAvisar(pend, pendCal, previo, solicBorrado);
    const subsAdmin = {};
    for (const uid of Object.keys(admins || {})) if (admins[uid] === true && subsTodas[uid]) subsAdmin[uid] = subsTodas[uid];
    if (nuevos.length) {
      const r = await enviarA(subsAdmin, R.mensajeAdmin(nuevos), DRY);
      console.log('Aviso al admin: ' + nuevos.length + ' pendiente(s) nuevo(s); enviados ' + r.enviados + ', fallidos ' + r.fallidos + (DRY ? ' (dry)' : ''));
      r.muertas.forEach((u) => muertas.add(u));
      if (r.fallidos) hayFallos = true;
      if (!DRY && r.enviados > 0) actualizaciones['notificado/admin'] = Object.keys(vistos).length ? vistos : null;
    } else if (Object.keys(previo).length !== Object.keys(vistos).length && !DRY) {
      // Se resolvieron pendientes: se limpia lo ya avisado para que un pendiente futuro con el mismo id avise de nuevo.
      actualizaciones['notificado/admin'] = Object.keys(vistos).length ? vistos : null;
    } else {
      console.log('Aviso al admin: sin pendientes nuevos.');
    }

    // 3) Suscripciones muertas (404/410) se borran
    for (const u of muertas) actualizaciones['pushSubs/' + u] = null;
    if (muertas.size) console.log('Suscripciones muertas ' + (DRY ? 'detectadas' : 'borradas') + ': ' + muertas.size);

    if (DRY) console.log('--dry: no se envió ni escribió nada.');
    else if (Object.keys(actualizaciones).length) await db.ref().update(actualizaciones);
    if (hayFallos) process.exitCode = 1;
  } finally {
    await deleteApp(app);
  }
}

main().catch((e) => {
  console.error('Error: ' + (e && e.code ? e.code + ' - ' : '') + (e && e.message ? String(e.message).slice(0, 200) : 'desconocido'));
  process.exit(1);
});
