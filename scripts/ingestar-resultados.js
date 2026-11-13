'use strict';
// Ingesta automática de resultados (Jornadas regulares). Opción A: publica solo si TheSportsDB y ESPN coinciden.
// Uso: node scripts/ingestar-resultados.js [--dry]
//   --dry  consulta y decide, pero no escribe en Firebase
// Escribe: resultados/{pid} = {gl, gv}  (solo si la fuente doble coincide y no existía resultado)
//          pendientes/{pid} = {motivo, sdb, espn, hora}  (discrepancias y casos sin resolver tras 6 h)
// Los logs son públicos: solo ids de partido, equipos y marcadores (datos públicos); nunca uids ni claves.
const { initializeApp, cert, deleteApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { partidosPorIngerir, decidir, planPendientes } = require('../lib/ingesta');

const DB_URL = process.env.FIREBASE_DB_URL || 'https://quiniela-clausura-2027-default-rtdb.firebaseio.com';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';   // clave pública gratuita; [VERIFICAR] términos de uso
const TEMP_SDB = process.env.TEMP_SDB || '2026-2027';          // [VERIFICAR] formato de temporada del Clausura 2027
const DRY = process.argv.includes('--dry');

async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'quiniela-clausura-ingesta/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 200) return await r.json();
      if (r.status < 500 && r.status !== 429) return null;
    } catch (e) { /* reintenta */ }
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
  }
  return null;
}
const yyyymmdd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

async function espnDia(dia, cache) {
  if (cache[dia]) return cache[dia];
  const j = await get(ESPN + '?dates=' + dia);
  const out = [];
  for (const v of ((j && j.events) || [])) {
    const c = (v.competitions && v.competitions[0] && v.competitions[0].competitors) || [];
    const l = c.find((x) => x.homeAway === 'home'), a = c.find((x) => x.homeAway === 'away');
    if (!l || !a) continue;
    out.push({ fecha: v.date, local: l.team.displayName, visita: a.team.displayName, gl: l.score, gv: a.score, terminado: !!(v.status && v.status.type && v.status.type.completed) });
  }
  return (cache[dia] = out);
}

async function main() {
  const crudo = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!crudo) throw new Error('Falta el secret FIREBASE_SERVICE_ACCOUNT');
  let cuenta; try { cuenta = JSON.parse(crudo); } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido'); }
  const app = initializeApp({ credential: cert(cuenta), databaseURL: DB_URL });
  try {
    const db = getDatabase(app);
    const [partidos, resultados, pendientesActuales] = await Promise.all(['partidos', 'resultados', 'pendientes'].map((r) => db.ref(r).get().then((s) => s.val())));
    const ahora = Date.now();
    const lista = partidosPorIngerir(partidos, resultados, ahora);
    console.log('Partidos por ingerir: ' + lista.length);
    if (!lista.length) return;

    // Una consulta a TheSportsDB por Jornada y una a ESPN por día (kickoff −1, 0, +1 por zonas horarias).
    const sdbPorJornada = {}, espnCache = {};
    for (const j of [...new Set(lista.map((p) => p.jornada))]) {
      const r = await get(TSDB + '/eventsround.php?id=4350&r=' + j + '&s=' + TEMP_SDB);
      sdbPorJornada[j] = (r && r.events) || [];
    }
    const cambios = {}, decisiones = {}; let n = { publicar: 0, espera: 0, pendiente: 0 };
    for (const p of lista) {
      const dias = [p.kickoff - 864e5, p.kickoff, p.kickoff + 864e5].map(yyyymmdd);
      const espn = []; for (const d of [...new Set(dias)]) espn.push(...await espnDia(d, espnCache));
      const r = decidir(p, sdbPorJornada[p.jornada], espn, ahora);
      n[r.estado]++;
      const etiqueta = p.id + ' J' + p.jornada + ' ' + p.local + ' vs ' + p.visitante;
      if (r.estado === 'publicar') { cambios['resultados/' + p.id] = { gl: r.gl, gv: r.gv }; cambios['pendientes/' + p.id] = null; console.log('PUBLICAR  ' + etiqueta + ' ' + r.gl + '-' + r.gv); }
      else if (r.estado === 'pendiente') { decisiones[p.id] = { motivo: r.motivo, sdb: r.sdb, espn: r.espn }; console.log('PENDIENTE ' + etiqueta + ' [' + r.motivo + '] SDB ' + JSON.stringify(r.sdb) + ' ESPN ' + JSON.stringify(r.espn)); }
      else console.log('ESPERA    ' + etiqueta);
    }
    console.log('Resumen -> publicar: ' + n.publicar + ' | espera: ' + n.espera + ' | pendientes: ' + n.pendiente);
    const plan = planPendientes(pendientesActuales, decisiones, ahora);
    for (const pid of Object.keys(plan.escribir)) cambios['pendientes/' + pid] = plan.escribir[pid];
    if (DRY) { console.log('--dry: no se escribió nada. Pendientes nuevos o cambiados: ' + plan.nuevos.length); return; }
    if (Object.keys(cambios).length) { await db.ref().update(cambios); console.log('Escritura multi-ruta aplicada: ' + Object.keys(cambios).length + ' rutas.'); }
    // Aviso: la corrida termina en rojo solo si hay pendientes nuevos o cambiados; GitHub manda correo de las corridas fallidas.
    if (plan.nuevos.length) { console.error('AVISO: ' + plan.nuevos.length + ' pendiente(s) nuevo(s) por revisar en la pestaña Admin: ' + plan.nuevos.join(', ')); process.exitCode = 1; }
  } finally { await deleteApp(app); }
}
main().catch((e) => { console.error('Error: ' + (e && e.code ? e.code + ' - ' : '') + (e && e.message ? String(e.message).slice(0, 200) : 'desconocido')); process.exit(1); });
