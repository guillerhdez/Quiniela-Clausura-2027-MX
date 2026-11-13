'use strict';
// Lógica pura de la sincronización automática del calendario (sin red ni Firebase).
// Regla (opción A, aprobada): un partido se carga solo si TheSportsDB y ESPN coinciden en los equipos y
// difieren ≤ 15 min en el horario; se carga con el horario MÁS TEMPRANO (el cierre de pronósticos nunca
// queda después del inicio real). Lo dudoso no se carga: va a pendientesPartidos. Un partido con resultado no se toca.

const TOL_HORARIO_MS = 15 * 60 * 1000;
const HORIZONTE_MS = 14 * 24 * 3600 * 1000;   // ESPN solo se consulta de ahora −1 día a ahora +14 días
const PASADO_MS = 36 * 3600 * 1000;           // partidos más viejos que esto no se sincronizan
const JORNADAS_REGULARES = 17;                // [VERIFICAR] con el calendario oficial del Clausura 2027

// Clubes con nombre de pantalla y alias de cada fuente. [VERIFICAR] los 18 del Clausura 2027 al publicarse el calendario.
const EQUIPOS = [
  { clave: 'juarez', nombre: 'Juárez', alias: ['juarez', 'fc juarez'] },
  { clave: 'queretaro', nombre: 'Querétaro', alias: ['queretaro', 'queretaro fc'] },
  { clave: 'atletico-san-luis', nombre: 'Atlético de San Luis', alias: ['atletico de san luis', 'atletico san luis', 'san luis'] },
  { clave: 'atlas', nombre: 'Atlas', alias: ['atlas', 'atlas fc'] },
  { clave: 'puebla', nombre: 'Puebla', alias: ['puebla', 'club puebla'] },
  { clave: 'pumas', nombre: 'Pumas UNAM', alias: ['pumas unam', 'pumas', 'unam'] },
  { clave: 'pachuca', nombre: 'Pachuca', alias: ['pachuca', 'cf pachuca'] },
  { clave: 'tigres', nombre: 'Tigres UANL', alias: ['tigres uanl', 'tigres', 'uanl'] },
  { clave: 'guadalajara', nombre: 'Guadalajara', alias: ['guadalajara', 'cd guadalajara', 'chivas', 'chivas guadalajara'] },
  { clave: 'atlante', nombre: 'Atlante', alias: ['atlante'] },
  { clave: 'monterrey', nombre: 'Monterrey', alias: ['monterrey', 'cf monterrey', 'rayados'] },
  { clave: 'tijuana', nombre: 'Tijuana', alias: ['tijuana', 'club tijuana', 'xolos', 'tijuana xolos'] },
  { clave: 'america', nombre: 'América', alias: ['america', 'club america'] },
  { clave: 'toluca', nombre: 'Toluca', alias: ['toluca', 'deportivo toluca'] },
  { clave: 'santos', nombre: 'Santos Laguna', alias: ['santos laguna', 'santos'] },
  { clave: 'necaxa', nombre: 'Necaxa', alias: ['necaxa', 'club necaxa'] },
  { clave: 'cruz-azul', nombre: 'Cruz Azul', alias: ['cruz azul'] },
  { clave: 'leon', nombre: 'León', alias: ['leon', 'club leon'] }
];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const slug = (s) => norm(s).replace(/ /g, '-') || 'x';
const esObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

const INDICE = {};
EQUIPOS.forEach((e) => { INDICE[norm(e.nombre)] = e; e.alias.forEach((a) => { INDICE[norm(a)] = e; }); });
function equipoDe(nombreFuente) { return INDICE[norm(nombreFuente)] || null; }

function idPartido(jornada, claveLocal, claveVisita) { return 'j' + jornada + '_' + claveLocal + '_' + claveVisita; }

// ---- Normalización de eventos crudos ----
// TheSportsDB: strTimestamp viene en UTC sin zona ("2026-11-21T03:00:00"); intRound = Jornada.
function normalizarSdb(e) {
  if (!esObj(e)) return null;
  const ts = String(e.strTimestamp || '');
  const kickoff = Date.parse(ts + (/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? '' : 'Z'));
  const jornada = Number(e.intRound);
  if (!Number.isFinite(kickoff) || !Number.isInteger(jornada) || jornada < 1) return null;
  return { jornada, local: String(e.strHomeTeam || ''), visitante: String(e.strAwayTeam || ''), kickoff, pospuesto: /^y/i.test(String(e.strPostponed || '')) };
}
// ESPN: v.date ISO con Z; local/visita de competitors.
function normalizarEspn(v) {
  const c = (v && v.competitions && v.competitions[0] && v.competitions[0].competitors) || [];
  const l = c.find((x) => x.homeAway === 'home'), a = c.find((x) => x.homeAway === 'away');
  const kickoff = Date.parse(v && v.date);
  if (!l || !a || !l.team || !a.team || !Number.isFinite(kickoff)) return null;
  return { local: String(l.team.displayName || ''), visitante: String(a.team.displayName || ''), kickoff };
}

const claveRaw = (j, l, v) => 'j' + j + '_' + slug(l) + '_' + slug(v);

// sdb: [normalizarSdb], espn: [normalizarEspn], existentes: partidos de la base, resultados: resultados de la base.
// → { cargar: {id: partido}, pendientes: {id: {motivo, sdb, espn, base?}}, cambios: [id], sinCambio, ignorados }
// `base` = {local, visitante, jornada} canónicos: permite cargar el partido desde el panel con la hora de la fuente elegida.
function decidirCalendario(sdb, espn, existentes, resultados, opciones) {
  const o = opciones || {};
  const ahora = o.ahora, horizonte = o.horizonteMs || HORIZONTE_MS, maxJ = o.jornadasRegulares || JORNADAS_REGULARES;
  const ex = esObj(existentes) ? existentes : {}, res = esObj(resultados) ? resultados : {};
  const out = { cargar: {}, pendientes: {}, cambios: [], sinCambio: 0, ignorados: 0 };
  const vistos = {};
  const ev = (arr) => (Array.isArray(arr) ? arr : []);

  for (const s of ev(sdb)) {
    if (!s || s.pospuesto || s.jornada > maxJ || s.kickoff < ahora - PASADO_MS || s.kickoff > ahora + horizonte) { out.ignorados++; continue; }
    const el = equipoDe(s.local), ev2 = equipoDe(s.visitante);
    const info = { local: s.local, visitante: s.visitante, kickoff: s.kickoff };
    if (!el || !ev2 || el.clave === ev2.clave) {
      out.pendientes[claveRaw(s.jornada, s.local, s.visitante)] = { motivo: !el || !ev2 ? 'equipo-desconocido' : 'equipos-iguales', sdb: info, espn: null };
      continue;
    }
    const id = idPartido(s.jornada, el.clave, ev2.clave);
    if (vistos[id]) { out.pendientes[id] = { motivo: 'duplicado', sdb: info, espn: null }; delete out.cargar[id]; continue; }
    vistos[id] = true;
    if (res[id] !== undefined && res[id] !== null) { out.ignorados++; continue; }   // con resultado: no se toca

    const candidatos = ev(espn).filter((x) => x && equipoDe(x.local) === el && equipoDe(x.visitante) === ev2);
    const base = { local: el.nombre, visitante: ev2.nombre, jornada: s.jornada };
    // Ya cargado (p. ej. resuelto a mano desde el panel) con el horario de alguna fuente: no se vuelve a marcar.
    const previoCargado = ex[id];
    const resuelto = (k) => esObj(previoCargado) && previoCargado.kickoff === k;
    if (candidatos.length === 0 && resuelto(s.kickoff)) { out.sinCambio++; continue; }
    if (candidatos.length === 0) { out.pendientes[id] = { motivo: 'solo-thesportsdb', sdb: info, espn: null, base }; continue; }
    const e = candidatos.slice().sort((a, b) => Math.abs(a.kickoff - s.kickoff) - Math.abs(b.kickoff - s.kickoff))[0];
    const infoE = { local: e.local, visitante: e.visitante, kickoff: e.kickoff };
    if (Math.abs(e.kickoff - s.kickoff) > TOL_HORARIO_MS && (resuelto(s.kickoff) || resuelto(e.kickoff))) { out.sinCambio++; continue; }
    if (Math.abs(e.kickoff - s.kickoff) > TOL_HORARIO_MS) { out.pendientes[id] = { motivo: 'horario-distinto', sdb: info, espn: infoE, base }; continue; }

    const nuevo = { local: el.nombre, visitante: ev2.nombre, kickoff: Math.min(s.kickoff, e.kickoff), fase: 'regular', jornada: s.jornada };
    const previo = ex[id];
    const igual = esObj(previo) && previo.local === nuevo.local && previo.visitante === nuevo.visitante && previo.kickoff === nuevo.kickoff
      && previo.fase === nuevo.fase && previo.jornada === nuevo.jornada;
    if (igual) { out.sinCambio++; continue; }
    out.cargar[id] = esObj(previo) ? Object.assign({}, previo, nuevo) : nuevo;   // conserva campos extra (p. ej. sede)
    if (esObj(previo)) out.cambios.push(id);
  }
  return out;
}

module.exports = { TOL_HORARIO_MS, HORIZONTE_MS, PASADO_MS, JORNADAS_REGULARES, EQUIPOS, norm, equipoDe, idPartido, normalizarSdb, normalizarEspn, decidirCalendario };
