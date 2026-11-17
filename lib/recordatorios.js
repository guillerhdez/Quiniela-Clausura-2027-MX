'use strict';
// Lógica pura de los avisos push (Fase F). Sin red ni base: recibe datos y devuelve qué enviar.
// Reglas (aprobadas por Guillermo, 17-nov-2026; la Liguilla se agregó el mismo día, ver más abajo):
//  - Un recordatorio por Jornada, a todos los usuarios con suscripción, MARGEN_AVISO_MS antes del primer
//    partido de la Jornada (el cierre de pronósticos es 30 min antes de cada partido, así que el aviso llega
//    cuando aún se puede pronosticar toda la Jornada). Se envía una sola vez (notificado/j{N}).
//  - Aviso al admin cuando hay algo nuevo o cambiado en pendientes / pendientesPartidos.
const MARGEN_AVISO_MS = 2 * 3600 * 1000;   // aviso 2 h antes del primer partido
const CIERRE_MS = 30 * 60 * 1000;          // los pronósticos cierran 30 min antes del kickoff
const CDMX_MS = -6 * 3600 * 1000;          // UTC-6 fijo, sin horario de verano

// Hora «HH:MM» de CDMX para un instante en ms UTC.
function horaCdmx(ms) {
  const d = new Date(Number(ms) + CDMX_MS);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

// Día de la semana y fecha corta de CDMX, p. ej. «sáb 21».
function diaCdmx(ms) {
  const d = new Date(Number(ms) + CDMX_MS);
  const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  return dias[d.getUTCDay()] + ' ' + d.getUTCDate();
}

// Primer kickoff de cada Jornada regular: { [jornada]: kickoffMs }. Ignora la Liguilla (sin `jornada`) y datos malos.
function primerosPorJornada(partidos) {
  const out = {};
  for (const p of Object.values(partidos || {})) {
    if (!p || !Number.isInteger(p.jornada) || p.jornada < 1) continue;
    if (!Number.isFinite(p.kickoff) || p.kickoff <= 0) continue;
    if (out[p.jornada] === undefined || p.kickoff < out[p.jornada]) out[p.jornada] = p.kickoff;
  }
  return out;
}

// Mensaje de recordatorio de una Jornada.
function mensajeJornada(jornada, primerKickoff) {
  const cierre = primerKickoff - CIERRE_MS;
  return {
    titulo: 'Jornada ' + jornada + ': ¡haz tus pronósticos!',
    cuerpo: 'El primer partido cierra el ' + diaCdmx(cierre) + ' a las ' + horaCdmx(cierre) + ' (hora CDMX).',
    url: './',
    tag: 'jornada-' + jornada,
  };
}

// Jornadas a avisar ahora: ya entró la ventana (kickoff − margen ≤ ahora), todavía no cierra el primer partido
// (ahora < kickoff − 30 min) y no se avisó antes. Una sola por corrida, la más próxima.
function jornadasPorAvisar(partidos, notificado, ahora, margen) {
  const m = Number.isFinite(margen) ? margen : MARGEN_AVISO_MS;
  const hechos = notificado || {};
  const lista = [];
  const prim = primerosPorJornada(partidos);
  for (const j of Object.keys(prim)) {
    const k = prim[j];
    if (hechos['j' + j]) continue;
    if (ahora >= k - m && ahora < k - CIERRE_MS) lista.push({ jornada: Number(j), kickoff: k });
  }
  lista.sort((a, b) => a.kickoff - b.kickoff);
  return lista.slice(0, 1);
}

// ---- Liguilla (rev. 17, aprobado por Guillermo el 17-nov-2026) ----
// Un aviso por cada ida y uno por cada vuelta de cada ronda, MARGEN_AVISO_MS antes del primer partido de esa etapa.
// Solo se avisa cuando la ronda anterior ya tiene todos sus resultados (así los equipos ya están definidos):
// Cuartos de Final exige la fase regular completa; Semifinal, los Cuartos; Final, la Semifinal.
const RONDAS = [
  { clave: 'cuartos', nombre: 'Cuartos de Final' },
  { clave: 'semifinal', nombre: 'Semifinal' },
  { clave: 'final', nombre: 'Final' },
];

function claveRonda(r) {
  if (typeof r !== 'string') return null;
  const t = r.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
  if (t === 'cuartos de final' || t === 'cuartos') return 'cuartos';
  if (t === 'semifinal') return 'semifinal';
  if (t === 'final') return 'final';
  return null;
}

const conKickoff = (p) => !!p && typeof p === 'object' && Number.isFinite(p.kickoff) && p.kickoff > 0;
const esRegular = (p) => conKickoff(p) && Number.isInteger(p.jornada) && p.jornada > 0;
const esLiguilla = (p) => conKickoff(p) && !esRegular(p) && claveRonda(p.ronda) !== null;
const hayResultado = (r) => !!r && Number.isInteger(r.gl) && Number.isInteger(r.gv);

function cmpId(a, b) {
  const na = Number(a), nb = Number(b);
  if (isFinite(na) && isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}

function regularCompleta(partidos, resultados) {
  const ids = Object.keys(partidos || {}).filter((id) => esRegular(partidos[id]));
  return ids.length > 0 && ids.every((id) => hayResultado((resultados || {})[id]));
}

// Ids de los partidos de una ronda, ordenados.
function idsDeRonda(partidos, clave) {
  return Object.keys(partidos || {}).filter((id) => esLiguilla(partidos[id]) && claveRonda(partidos[id].ronda) === clave).sort(cmpId);
}

function rondaCompleta(partidos, resultados, clave) {
  const ids = idsDeRonda(partidos, clave);
  return ids.length > 0 && ids.every((id) => hayResultado((resultados || {})[id]));
}

// Parejas {ida, vuelta} de una ronda: por el campo `serie` si TODOS los partidos lo traen; si no, ids consecutivos.
// En cada pareja la ida es el partido con kickoff más temprano.
function seriesDeRonda(partidos, clave) {
  const ids = idsDeRonda(partidos, clave);
  const pares = [];
  const todosConSerie = ids.length > 0 && ids.every((id) => typeof partidos[id].serie === 'string' && partidos[id].serie);
  if (todosConSerie) {
    const g = {};
    ids.forEach((id) => { (g[partidos[id].serie] = g[partidos[id].serie] || []).push(id); });
    Object.keys(g).sort().forEach((k) => { if (g[k].length === 2) pares.push(g[k]); });
  } else {
    for (let i = 0; i + 1 < ids.length; i += 2) pares.push([ids[i], ids[i + 1]]);
  }
  return pares.map((par) => {
    const [a, b] = par.slice().sort((x, y) => partidos[x].kickoff - partidos[y].kickoff || cmpId(x, y));
    return { ida: a, vuelta: b };
  });
}

// Etapas de Liguilla con aviso posible: [{ clave, nombre, etapa: 'ida'|'vuelta', kickoff, marca }].
// `kickoff` = primer partido de la etapa; `marca` = clave de `notificado` (p. ej. «l_semifinal_ida»).
function etapasLiguilla(partidos, resultados) {
  const out = [];
  RONDAS.forEach((r, i) => {
    const previaLista = i === 0 ? regularCompleta(partidos, resultados) : rondaCompleta(partidos, resultados, RONDAS[i - 1].clave);
    if (!previaLista) return;
    const series = seriesDeRonda(partidos, r.clave);
    if (!series.length) return;
    const minKick = (campo) => Math.min(...series.map((s) => partidos[s[campo]].kickoff));
    out.push({ clave: r.clave, nombre: r.nombre, etapa: 'ida', kickoff: minKick('ida'), marca: 'l_' + r.clave + '_ida' });
    out.push({ clave: r.clave, nombre: r.nombre, etapa: 'vuelta', kickoff: minKick('vuelta'), marca: 'l_' + r.clave + '_vuelta' });
  });
  return out;
}

function mensajeEtapa(nombre, etapa, primerKickoff, clave) {
  const cierre = primerKickoff - CIERRE_MS;
  return {
    titulo: nombre + ' · ' + (etapa === 'ida' ? 'Ida' : 'Vuelta') + ': ¡haz tus pronósticos!',
    cuerpo: 'El primer partido cierra el ' + diaCdmx(cierre) + ' a las ' + horaCdmx(cierre) + ' (hora CDMX).',
    url: './',
    tag: 'liguilla-' + clave + '-' + etapa,
  };
}

// Etapas a avisar ahora: ventana abierta (kickoff − margen ≤ ahora < kickoff − 30 min) y aún sin avisar.
function etapasPorAvisar(partidos, resultados, notificado, ahora, margen) {
  const m = Number.isFinite(margen) ? margen : MARGEN_AVISO_MS;
  const hechos = notificado || {};
  return etapasLiguilla(partidos, resultados)
    .filter((e) => !hechos[e.marca] && ahora >= e.kickoff - m && ahora < e.kickoff - CIERRE_MS)
    .sort((a, b) => a.kickoff - b.kickoff);
}

// El aviso de recordatorio de esta corrida (como mucho uno: el de kickoff más próximo), Jornada o Liguilla.
// Devuelve null o { marca, mensaje, kickoff, etiqueta }.
function proximoAviso(partidos, resultados, notificado, ahora, margen) {
  const lista = [];
  jornadasPorAvisar(partidos, notificado, ahora, margen).forEach((a) => lista.push({
    marca: 'j' + a.jornada, kickoff: a.kickoff, etiqueta: 'Jornada ' + a.jornada, mensaje: mensajeJornada(a.jornada, a.kickoff),
  }));
  etapasPorAvisar(partidos, resultados, notificado, ahora, margen).forEach((e) => lista.push({
    marca: e.marca, kickoff: e.kickoff, etiqueta: e.nombre + ' ' + e.etapa, mensaje: mensajeEtapa(e.nombre, e.etapa, e.kickoff, e.clave),
  }));
  lista.sort((a, b) => a.kickoff - b.kickoff);
  return lista[0] || null;
}

// Clave segura para Firebase (sin . $ # [ ] /) a partir de un id.
function claveSegura(id) {
  return String(id).replace(/[.$#\[\]\/]/g, '_').slice(0, 100);
}

// Huella corta y estable del contenido de un pendiente: si cambia, se vuelve a avisar.
function huellaPendiente(v) {
  const s = JSON.stringify(v == null ? null : v);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Pendientes nuevos o cambiados respecto de lo ya avisado (notificado/admin/{tipo}_{id} = huella).
// tipos: { resultados: pendientes, calendario: pendientesPartidos }
function pendientesPorAvisar(pendientes, pendientesPartidos, yaAvisado) {
  const hechos = yaAvisado || {};
  const nuevos = [];
  const vistos = {};
  const recorre = (nodo, tipo) => {
    for (const [id, v] of Object.entries(nodo || {})) {
      const clave = tipo + '_' + claveSegura(id);
      const h = huellaPendiente(v);
      vistos[clave] = h;
      if (hechos[clave] !== h) nuevos.push({ clave, tipo, huella: h });
    }
  };
  recorre(pendientes, 'res');
  recorre(pendientesPartidos, 'cal');
  return { nuevos, vistos };
}

function mensajeAdmin(nuevos) {
  const res = nuevos.filter((n) => n.tipo === 'res').length;
  const cal = nuevos.filter((n) => n.tipo === 'cal').length;
  const partes = [];
  if (res) partes.push(res + (res === 1 ? ' resultado' : ' resultados'));
  if (cal) partes.push(cal + (cal === 1 ? ' partido del calendario' : ' partidos del calendario'));
  return {
    titulo: 'Quiniela: pendientes por revisar',
    cuerpo: partes.join(' y ') + (partes.length ? ' por revisar en Admin.' : ''),
    url: './',
    tag: 'admin-pendientes',
  };
}

// ¿La suscripción guardada tiene la forma mínima que exige web-push?
function suscripcionValida(s) {
  return !!(s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length <= 1000
    && s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string');
}

// Códigos HTTP del servicio push que indican suscripción muerta (se borra de pushSubs).
function esSuscripcionMuerta(statusCode) {
  return statusCode === 404 || statusCode === 410;
}

module.exports = {
  MARGEN_AVISO_MS, CIERRE_MS, horaCdmx, diaCdmx, primerosPorJornada, mensajeJornada, jornadasPorAvisar,
  claveSegura, huellaPendiente, pendientesPorAvisar, mensajeAdmin, suscripcionValida, esSuscripcionMuerta,
  claveRonda, regularCompleta, rondaCompleta, seriesDeRonda, etapasLiguilla, mensajeEtapa, etapasPorAvisar, proximoAviso,
};
