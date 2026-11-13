'use strict';
// Sincronización automática del calendario (Jornadas regulares). Opción A: carga solo lo que TheSportsDB y ESPN confirman.
// Uso: node scripts/sincronizar-calendario.js [--dry]
//   --dry  consulta y decide, pero no escribe en Firebase
// Escribe: partidos/{id} (completo, solo si es nuevo o cambió) y pendientesPartidos/{id} = {motivo, sdb, espn, hora}.
// Nunca toca un partido con resultado. Los logs son públicos: solo equipos, horarios y ids de partido (datos públicos).
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { normalizarSdb, normalizarEspn, decidirCalendario, HORIZONTE_MS, JORNADAS_REGULARES } = require('../lib/calendario');
const { planPendientes } = require('../lib/ingesta');

const DB_URL = process.env.FIREBASE_DB_URL || 'https://quiniela-clausura-2027-default-rtdb.firebaseio.com';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';   // clave pública gratuita; [VERIFICAR] términos de uso
const TEMP_SDB = process.env.TEMP_SDB || '2026-2027';          // [VERIFICAR] nombre de la temporada del Clausura 2027
const DRY = process.argv.includes('--dry');
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'quiniela-clausura-calendario/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 200) return await r.json();
      if (r.status < 500 && r.status !== 429) return null;
    } catch (e) { /* reintenta */ }
    await espera(3000 * (i + 1));   // 429/5xx: pausas crecientes
  }
  return null;
}
const yyyymmdd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

async function main() {
  const crudo = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!crudo) throw new Error('Falta el secret FIREBASE_SERVICE_ACCOUNT');
  let cuenta; try { cuenta = JSON.parse(crudo); } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido'); }
  const ahora = Date.now();

  // 1) Fuentes (antes de abrir Firebase: si no hay datos, no se escribe nada).
  const sdb = []; let pendientesRondas = [];
  for (let r = 1; r <= JORNADAS_REGULARES; r++) pendientesRondas.push(r);
  // Hasta 3 pasadas: las rondas que dan 429 se reintentan tras una pausa larga (la clave pública es compartida).
  for (let pasada = 1; pasada <= 3 && pendientesRondas.length; pasada++) {
    if (pasada > 1) { console.log('Pasada ' + pasada + ': reintentando rondas ' + pendientesRondas.join(', ') + ' tras pausa'); await espera(30000 * (pasada - 1)); }
    const falladas = [];
    for (const r of pendientesRondas) {
      const j = await get(TSDB + '/eventsround.php?id=4350&r=' + r + '&s=' + TEMP_SDB);
      if (j === null) falladas.push(r);
      for (const e of ((j && j.events) || [])) { const n = normalizarSdb(e); if (n) sdb.push(n); }
      await espera(3500);
    }
    pendientesRondas = falladas;
  }
  const fallosSdb = pendientesRondas.length;
  if (fallosSdb) console.log('Rondas sin respuesta tras 3 pasadas: ' + pendientesRondas.join(', '));
  const espn = []; let fallosEspn = 0;
  for (let d = ahora - 864e5; d <= ahora + HORIZONTE_MS + 864e5; d += 864e5) {
    const j = await get(ESPN + '?dates=' + yyyymmdd(d));
    if (j === null) { fallosEspn++; console.log('ESPN ' + yyyymmdd(d) + ': sin respuesta'); }
    for (const v of ((j && j.events) || [])) { const n = normalizarEspn(v); if (n) espn.push(n); }
    await espera(250);
  }
  console.log('TheSportsDB: ' + sdb.length + ' partidos (' + fallosSdb + ' rondas sin respuesta) | ESPN: ' + espn.length + ' partidos (' + fallosEspn + ' días sin respuesta)');
  if (fallosSdb === JORNADAS_REGULARES || fallosEspn > 8) { console.log('Fuentes no disponibles: no se escribe nada en esta corrida.'); return; }

  // 2) Decisión
  const app = initializeApp({ credential: cert(cuenta), databaseURL: DB_URL });
  try {
    const db = getDatabase(app);
    const [partidos, resultados, pendActuales] = await Promise.all(['partidos', 'resultados', 'pendientesPartidos'].map((r) => db.ref(r).get().then((s) => s.val())));
    const r = decidirCalendario(sdb, espn, partidos, resultados, { ahora });
    const plan = planPendientes(pendActuales, r.pendientes, ahora);
    const cambios = {};
    for (const id of Object.keys(r.cargar)) cambios['partidos/' + id] = r.cargar[id];
    for (const id of Object.keys(plan.escribir)) cambios['pendientesPartidos/' + id] = plan.escribir[id];
    // Pendientes que ya se resolvieron (el partido quedó cargado): se limpian.
    for (const id of Object.keys(pendActuales || {})) if (!r.pendientes[id] && (r.cargar[id] || (partidos || {})[id])) cambios['pendientesPartidos/' + id] = null;

    for (const id of Object.keys(r.cargar)) { const p = r.cargar[id]; console.log((r.cambios.includes(id) ? 'ACTUALIZAR ' : 'CARGAR     ') + id + ' J' + p.jornada + ' ' + p.local + ' vs ' + p.visitante + ' ' + new Date(p.kickoff).toISOString()); }
    for (const id of Object.keys(r.pendientes)) console.log('PENDIENTE  ' + id + ' [' + r.pendientes[id].motivo + '] SDB ' + JSON.stringify(r.pendientes[id].sdb) + ' ESPN ' + JSON.stringify(r.pendientes[id].espn));
    console.log('Resumen -> cargar: ' + Object.keys(r.cargar).length + ' (de ellos actualizan: ' + r.cambios.length + ') | sin cambio: ' + r.sinCambio + ' | ignorados: ' + r.ignorados + ' | pendientes: ' + Object.keys(r.pendientes).length + ' (nuevos o cambiados: ' + plan.nuevos.length + ')');
    if (DRY) { console.log('--dry: no se escribió nada.'); return; }
    if (Object.keys(cambios).length) { await db.ref().update(cambios); console.log('Escritura multi-ruta aplicada: ' + Object.keys(cambios).length + ' rutas.'); }
    if (plan.nuevos.length) { console.error('AVISO: ' + plan.nuevos.length + ' partido(s) del calendario por revisar en la pestaña Admin: ' + plan.nuevos.join(', ')); process.exitCode = 1; }
  } finally { await deleteApp(app); }
}
main().catch((e) => { console.error('Error: ' + (e && e.code ? e.code + ' - ' : '') + (e && e.message ? String(e.message).slice(0, 200) : 'desconocido')); process.exit(1); });
