'use strict';
// Lógica pura de los avisos push (Fase F). Sin red ni base: recibe datos y devuelve qué enviar.
// Reglas (aprobadas por Guillermo, 17-nov-2026):
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
};
