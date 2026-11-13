'use strict';
// Lógica pura de la ingesta automática de resultados (sin red ni Firebase).
// Regla (opción A): un resultado se publica solo si TheSportsDB y ESPN coinciden en el marcador
// y ESPN marca el partido como terminado. Cualquier otra cosa → pendiente (nunca una sola fuente).

const MARGEN_FIN_MS = 125 * 60 * 1000;      // kickoff + 125 min: antes de eso no se consulta
const MARGEN_ALERTA_MS = 6 * 3600 * 1000;   // kickoff + 6 h sin resultado ni coincidencia → pendiente visible
const TOL_FECHA_MS = 24 * 3600 * 1000;      // ESPN: el partido debe caer a ±24 h del kickoff

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
const STOP = new Set(['cd', 'fc', 'club', 'de', 'del', 'la', 'el', 'cf', 'ac']);
const tokens = (s) => norm(s).split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
// Mismo equipo si comparten al menos un token distintivo.
function mismo(a, b) { const tb = new Set(tokens(b)); return tokens(a).some((t) => tb.has(t)); }

const esObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const entero = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : null; };
const PORDEFINIR = /por definir/i;

// Partidos de Jornada regular, ya pasado su margen, sin resultado y con equipos definidos.
function partidosPorIngerir(partidos, resultados, ahora) {
  const res = esObj(resultados) ? resultados : {};
  const out = [];
  if (!esObj(partidos)) return out;
  for (const id of Object.keys(partidos)) {
    const p = partidos[id];
    if (!esObj(p) || res[id] !== undefined && res[id] !== null) continue;   // un resultado existente (manual) nunca se pisa
    if (!Number.isInteger(p.jornada) || p.ronda) continue;                 // Liguilla: fuera de alcance por ahora
    if (!Number.isFinite(p.kickoff) || ahora < p.kickoff + MARGEN_FIN_MS) continue;
    if (!p.local || !p.visitante || PORDEFINIR.test(p.local) || PORDEFINIR.test(p.visitante)) continue;
    out.push({ id, ...p });
  }
  return out.sort((a, b) => a.kickoff - b.kickoff || (a.id < b.id ? -1 : 1));
}

// Evento de TheSportsDB: { strHomeTeam, strAwayTeam, intHomeScore, intAwayScore }
function buscarSdb(p, eventosSdb) {
  const e = (eventosSdb || []).find((x) => mismo(x.strHomeTeam, p.local) && mismo(x.strAwayTeam, p.visitante));
  if (!e) return null;
  const gl = entero(e.intHomeScore), gv = entero(e.intAwayScore);
  return { gl, gv, completo: gl !== null && gv !== null };
}
// Evento de ESPN normalizado: { fecha(ISO), local, visita, gl, gv, terminado }
function buscarEspn(p, eventosEspn) {
  const e = (eventosEspn || []).find((x) => mismo(x.local, p.local) && mismo(x.visita, p.visitante)
    && Math.abs(Date.parse(x.fecha) - p.kickoff) <= TOL_FECHA_MS);
  if (!e) return null;
  const gl = entero(e.gl), gv = entero(e.gv);
  return { gl, gv, completo: gl !== null && gv !== null, terminado: !!e.terminado };
}

// → { estado: 'publicar', gl, gv } | { estado: 'espera' } | { estado: 'pendiente', motivo, sdb, espn }
function decidir(p, eventosSdb, eventosEspn, ahora) {
  const s = buscarSdb(p, eventosSdb), e = buscarEspn(p, eventosEspn);
  const sdb = s && s.completo ? { gl: s.gl, gv: s.gv } : null;
  const espn = e && e.completo && e.terminado ? { gl: e.gl, gv: e.gv } : null;
  if (sdb && espn) {
    if (sdb.gl === espn.gl && sdb.gv === espn.gv) return { estado: 'publicar', gl: sdb.gl, gv: sdb.gv };
    return { estado: 'pendiente', motivo: 'discrepancia', sdb, espn };
  }
  // Una sola fuente (o ninguna): se espera; si pasa el margen de alerta, queda visible como pendiente.
  if (ahora >= p.kickoff + MARGEN_ALERTA_MS) {
    const motivo = !s && !e ? 'sin-contraparte' : sdb && !espn ? 'solo-thesportsdb' : espn && !sdb ? 'solo-espn' : 'sin-marcador-final';
    return { estado: 'pendiente', motivo, sdb, espn };
  }
  return { estado: 'espera' };
}

// Compara los pendientes que decide esta corrida contra los que ya existen en la base.
// Solo se escribe (y se avisa) si el pendiente es nuevo o cambió de motivo/marcadores; así no se reescribe `hora`
// ni se vuelve a avisar en cada corrida del cron mientras Guillermo no lo resuelva.
// decisiones: { pid: { motivo, sdb, espn } } → { escribir: { pid: {…, hora} }, nuevos: [pid] }
function planPendientes(existentes, decisiones, ahora) {
  const ex = esObj(existentes) ? existentes : {};
  const escribir = {}, nuevos = [];
  for (const pid of Object.keys(decisiones || {})) {
    const d = decisiones[pid], e = ex[pid];
    const igual = esObj(e) && e.motivo === d.motivo && JSON.stringify(e.sdb || null) === JSON.stringify(d.sdb || null) && JSON.stringify(e.espn || null) === JSON.stringify(d.espn || null);
    if (igual) continue;
    escribir[pid] = { motivo: d.motivo, sdb: d.sdb || null, espn: d.espn || null, hora: ahora };
    nuevos.push(pid);
  }
  return { escribir, nuevos };
}

module.exports = { planPendientes, MARGEN_FIN_MS, MARGEN_ALERTA_MS, norm, mismo, partidosPorIngerir, buscarSdb, buscarEspn, decidir };
