'use strict';
// Lógica pura del cálculo de tablas (sin red). Mismas reglas que el cliente y el Apertura:
// puntos 3 (exacto) / 1 (resultado) / 0; desempate: puntos → referidos válidos → goles atinados.
const crypto = require('crypto');

const PTS_EXACTO = 3;
const PTS_SIGNO = 1;
// [VERIFICAR] con el calendario del Clausura 2027: 18 equipos → 17 Jornadas (153 partidos), como en el Apertura 2026.
const JORNADAS_REGULARES = 17;
// La Final es de ida y vuelta (14 partidos de Liguilla: 8 + 4 + 2, como en el Apertura 2026).
const PARTIDOS_FINAL = 2;

const esObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const esMarcador = (m) => esObj(m) && Number.isInteger(m.gl) && Number.isInteger(m.gv);

function signo(a, b) { return a > b ? 'L' : a < b ? 'V' : 'E'; }

// g (goles atinados) = suma de goles del marcador solo cuando el pronóstico es exacto.
function calcPts(pred, real) {
  if (!esMarcador(pred) || !esMarcador(real)) return null;
  if (pred.gl === real.gl && pred.gv === real.gv) return { p: PTS_EXACTO, g: pred.gl + pred.gv };
  if (signo(pred.gl, pred.gv) === signo(real.gl, real.gv)) return { p: PTS_SIGNO, g: 0 };
  return { p: 0, g: 0 };
}

// Número de Jornada de la fase regular, o null (Liguilla y partidos mal formados no entran).
function jornadaDe(p) {
  return esObj(p) && Number.isInteger(p.jornada) && p.jornada > 0 ? p.jornada : null;
}

// Nombre de la ronda de Liguilla ("Cuartos de Final", "Semifinal", "Final"), o null.
// Un partido con `jornada` válida es de fase regular aunque traiga `ronda`.
function rondaDe(p) {
  if (!esObj(p) || jornadaDe(p) !== null) return null;
  return typeof p.ronda === 'string' && p.ronda.trim() ? p.ronda.trim() : null;
}

function normRonda(s) {
  return String(s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Solo "Final" (sin acentos ni mayúsculas): "Cuartos de Final" y "Semifinal" NO cuentan.
function esRondaFinal(ronda) { return typeof ronda === 'string' && normRonda(ronda) === 'final'; }

// Referidos válidos por referente: el invitado y el referente existen, no es autorreferido
// y el invitado ya tiene al menos un pronóstico guardado (mitigación aprobada).
function referidosValidos(referidos, usuarios, predicciones) {
  const cuenta = {};
  Object.keys(referidos || {}).forEach((invitado) => {
    const r = referidos[invitado];
    const por = esObj(r) ? r.por : null;
    if (typeof por !== 'string' || por === invitado) return;
    if (!esObj((usuarios || {})[por]) || !esObj((usuarios || {})[invitado])) return;
    const preds = (predicciones || {})[invitado];
    if (!esObj(preds) || !Object.keys(preds).some((pid) => esMarcador(preds[pid]))) return;
    cuenta[por] = (cuenta[por] || 0) + 1;
  });
  return cuenta;
}

// Ordena por puntos, referidos y goles; `orden` es único y estable (desempata por uid);
// `pos` es la posición visible: los empatados en los tres criterios la comparten (1,1,3).
function ordenarYPosicionar(filas) {
  const lista = filas.slice().sort((a, b) =>
    b.pts - a.pts || b.ref - a.ref || b.goles - a.goles || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
  const out = {};
  lista.forEach((f, i) => {
    const ant = lista[i - 1];
    const pos = ant && ant.pts === f.pts && ant.ref === f.ref && ant.goles === f.goles ? out[ant.uid].pos : i + 1;
    out[f.uid] = { nick: f.nick, orden: i + 1, pos, pts: f.pts, ref: f.ref, goles: f.goles };
  });
  return out;
}

function sumar(uid, partidos, predicciones, resultados) {
  let pts = 0, goles = 0;
  const preds = (predicciones || {})[uid];
  if (!esObj(preds)) return { pts, goles };
  partidos.forEach((pid) => {
    const x = calcPts(preds[pid], (resultados || {})[pid]);
    if (x) { pts += x.p; goles += x.g; }
  });
  return { pts, goles };
}

// Calcula, en una pasada:
//  - `tabla` (fase regular) y `tablaJornada/{j}` solo de Jornadas con TODOS sus partidos con resultado;
//  - `tablaLiguilla` (solo partidos de Liguilla), en cuanto hay al menos un resultado de Liguilla;
//  - `tablaFinal` (Campeón de Campeones = fase regular + Liguilla), cuando la fase regular terminó y hay resultados de Liguilla;
//  - `fases`: qué fases terminaron (regular = Jornadas 1..N completas; liguilla = Final completa; campeon = ambas).
// Las tres tablas usan puntos → referidos → goles. Los referidos son el total de referidos válidos del jugador.
function calcularTablas({ usuarios, partidos, resultados, predicciones, referidos }, opciones) {
  const op = Object.assign({ jornadasRegulares: JORNADAS_REGULARES, partidosFinal: PARTIDOS_FINAL }, opciones || {});
  const uids = Object.keys(usuarios || {}).filter((u) => esObj(usuarios[u]) && typeof usuarios[u].nick === 'string');
  const refs = referidosValidos(referidos, usuarios, predicciones);
  const tieneRes = (pid) => esMarcador((resultados || {})[pid]);

  const porJornada = {};
  const pidsLiguilla = [];
  const pidsFinal = [];
  Object.keys(partidos || {}).forEach((pid) => {
    const j = jornadaDe(partidos[pid]);
    if (j !== null) { (porJornada[j] = porJornada[j] || []).push(pid); return; }
    const r = rondaDe(partidos[pid]);
    if (r !== null) { pidsLiguilla.push(pid); if (esRondaFinal(r)) pidsFinal.push(pid); }
  });
  const completas = Object.keys(porJornada).map(Number).sort((a, b) => a - b)
    .filter((j) => porJornada[j].every(tieneRes));

  const todosPid = [].concat(...Object.keys(porJornada).map((j) => porJornada[j]));
  const fila = (uid, pids) => Object.assign({ uid, nick: usuarios[uid].nick, ref: refs[uid] || 0 }, sumar(uid, pids, predicciones, resultados));

  const tabla = ordenarYPosicionar(uids.map((u) => fila(u, todosPid)));
  const tablaJornada = {};
  completas.forEach((j) => { tablaJornada[j] = ordenarYPosicionar(uids.map((u) => fila(u, porJornada[j]))); });

  const regular = op.jornadasRegulares > 0
    && Array.from({ length: op.jornadasRegulares }, (_, i) => i + 1).every((j) => completas.includes(j));
  const liguilla = pidsFinal.length >= op.partidosFinal && pidsFinal.every(tieneRes);
  const hayResLiguilla = pidsLiguilla.some(tieneRes);

  const tablaLiguilla = hayResLiguilla ? ordenarYPosicionar(uids.map((u) => fila(u, pidsLiguilla))) : null;
  const tablaFinal = regular && hayResLiguilla
    ? ordenarYPosicionar(uids.map((u) => fila(u, todosPid.concat(pidsLiguilla)))) : null;

  return {
    tabla, tablaJornada, tablaLiguilla, tablaFinal,
    jornadasCompletas: completas,
    jornada: completas.length ? completas[completas.length - 1] : 0,
    fases: { regular, liguilla, campeon: regular && liguilla }
  };
}

// Huella de lo que decide el cálculo barato: resultados y la pertenencia de cada partido a su Jornada o ronda.
// No incluye pronósticos, usuarios ni referidos (pesan mucho): por diseño se reflejan en el siguiente cambio de resultados.
function huellaEntradas(partidos, resultados) {
  const p = Object.keys(partidos || {}).sort().map((id) => [id, jornadaDe(partidos[id]), rondaDe(partidos[id])]);
  const r = Object.keys(resultados || {}).sort().map((id) => [id, esMarcador(resultados[id]) ? resultados[id].gl : null, esMarcador(resultados[id]) ? resultados[id].gv : null]);
  return crypto.createHash('sha256').update(JSON.stringify([p, r])).digest('hex');
}

// Cambios para una sola actualización multi-ruta: tabla + tablaMeta + Jornadas (y borra las que ya no estén completas)
// + tablaJornada/liguilla y tablaJornada/final (null borra la ruta si ya no corresponde publicarla).
// Las claves 'liguilla' y 'final' caen bajo la regla existente `tablaJornada/$j` (no requieren cambiar las reglas).
function planActualizacion(calculo, metaPrevia, huella) {
  const pub = esObj(metaPrevia) ? metaPrevia.publicadas : null; // RTDB devuelve arrays como array u objeto
  const previas = pub && typeof pub === 'object' ? Object.values(pub).filter(Number.isInteger) : [];
  const version = (esObj(metaPrevia) && Number.isInteger(metaPrevia.version) ? metaPrevia.version : 0) + 1;
  const cambios = {};
  cambios['tabla'] = calculo.tabla;
  calculo.jornadasCompletas.forEach((j) => { cambios['tablaJornada/' + j] = calculo.tablaJornada[j]; });
  previas.filter((j) => !calculo.jornadasCompletas.includes(j)).forEach((j) => { cambios['tablaJornada/' + j] = null; });
  cambios['tablaJornada/liguilla'] = calculo.tablaLiguilla || null;
  cambios['tablaJornada/final'] = calculo.tablaFinal || null;
  cambios['tablaMeta'] = {
    jornada: calculo.jornada, version, huella, publicadas: calculo.jornadasCompletas,
    fases: calculo.fases || { regular: false, liguilla: false, campeon: false }
  };
  return cambios;
}

module.exports = {
  calcPts, signo, jornadaDe, rondaDe, esRondaFinal, referidosValidos, ordenarYPosicionar,
  calcularTablas, huellaEntradas, planActualizacion,
  PTS_EXACTO, PTS_SIGNO, JORNADAS_REGULARES, PARTIDOS_FINAL
};
