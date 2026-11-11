'use strict';
// Lógica pura del cálculo de tablas (sin red). Mismas reglas que el cliente y el Apertura:
// puntos 3 (exacto) / 1 (resultado) / 0; desempate: puntos → referidos válidos → goles atinados.
const crypto = require('crypto');

const PTS_EXACTO = 3;
const PTS_SIGNO = 1;

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

// Calcula `tabla` (fase regular) y `tablaJornada/{j}` solo de Jornadas con TODOS sus partidos con resultado.
function calcularTablas({ usuarios, partidos, resultados, predicciones, referidos }) {
  const uids = Object.keys(usuarios || {}).filter((u) => esObj(usuarios[u]) && typeof usuarios[u].nick === 'string');
  const refs = referidosValidos(referidos, usuarios, predicciones);

  const porJornada = {};
  Object.keys(partidos || {}).forEach((pid) => {
    const j = jornadaDe(partidos[pid]);
    if (j !== null) (porJornada[j] = porJornada[j] || []).push(pid);
  });
  const completas = Object.keys(porJornada).map(Number).sort((a, b) => a - b)
    .filter((j) => porJornada[j].every((pid) => esMarcador((resultados || {})[pid])));

  const todosPid = [].concat(...Object.keys(porJornada).map((j) => porJornada[j]));
  const fila = (uid, pids) => Object.assign({ uid, nick: usuarios[uid].nick, ref: refs[uid] || 0 }, sumar(uid, pids, predicciones, resultados));

  const tabla = ordenarYPosicionar(uids.map((u) => fila(u, todosPid)));
  const tablaJornada = {};
  completas.forEach((j) => { tablaJornada[j] = ordenarYPosicionar(uids.map((u) => fila(u, porJornada[j]))); });
  return { tabla, tablaJornada, jornadasCompletas: completas, jornada: completas.length ? completas[completas.length - 1] : 0 };
}

// Huella de lo que decide el cálculo barato: resultados y la pertenencia de cada partido a su Jornada.
// No incluye pronósticos, usuarios ni referidos (pesan mucho): por diseño se reflejan en el siguiente cambio de resultados.
function huellaEntradas(partidos, resultados) {
  const p = Object.keys(partidos || {}).sort().map((id) => [id, jornadaDe(partidos[id])]);
  const r = Object.keys(resultados || {}).sort().map((id) => [id, esMarcador(resultados[id]) ? resultados[id].gl : null, esMarcador(resultados[id]) ? resultados[id].gv : null]);
  return crypto.createHash('sha256').update(JSON.stringify([p, r])).digest('hex');
}

// Cambios para una sola actualización multi-ruta: tabla + tablaMeta + Jornadas (y borra las que ya no estén completas).
function planActualizacion(calculo, metaPrevia, huella) {
  const pub = esObj(metaPrevia) ? metaPrevia.publicadas : null; // RTDB devuelve arrays como array u objeto
  const previas = pub && typeof pub === 'object' ? Object.values(pub).filter(Number.isInteger) : [];
  const version = (esObj(metaPrevia) && Number.isInteger(metaPrevia.version) ? metaPrevia.version : 0) + 1;
  const cambios = {};
  cambios['tabla'] = calculo.tabla;
  calculo.jornadasCompletas.forEach((j) => { cambios['tablaJornada/' + j] = calculo.tablaJornada[j]; });
  previas.filter((j) => !calculo.jornadasCompletas.includes(j)).forEach((j) => { cambios['tablaJornada/' + j] = null; });
  cambios['tablaMeta'] = { jornada: calculo.jornada, version, huella, publicadas: calculo.jornadasCompletas };
  return cambios;
}

module.exports = { calcPts, signo, jornadaDe, referidosValidos, ordenarYPosicionar, calcularTablas, huellaEntradas, planActualizacion, PTS_EXACTO, PTS_SIGNO };
