'use strict';
// Lógica pura de la cola adminAcciones (E3b): qué acciones procesar, qué borrar al eliminar un usuario y cómo
// resumir el resultado. Sin red. Los logs de Actions son públicos: ningún detalle puede llevar uids, correos ni nicks.
const { clasificarRespuesta } = require('./sondeo-reset');

const TIPOS = ['eliminar', 'reset'];
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_EDAD_MS = 24 * 3600 * 1000;   // una acción pendiente más vieja que esto no se ejecuta (caduca)
const MAX_POR_CORRIDA = 20;
const MAX_DETALLE = 200;                 // límite de `detalle` en las reglas

const esObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const recortar = (t) => String(t == null ? '' : t).slice(0, MAX_DETALLE);
const claveNick = (nick) => String(nick).toLowerCase();

// Separa lo pendiente en: por procesar (válidas, ordenadas por ts), caducadas e inválidas. Solo mira estado === 'pendiente'.
// Devuelve { procesar:[{id,tipo,uid}], rechazar:[{id,detalle}], omitidas:n } (omitidas = pendientes que exceden el tope por corrida).
function clasificarPendientes(adminAcciones, ahora) {
  const procesar = [], rechazar = [];
  Object.keys(esObj(adminAcciones) ? adminAcciones : {}).forEach((id) => {
    const a = adminAcciones[id];
    if (!esObj(a) || a.estado !== 'pendiente') return;
    if (!TIPOS.includes(a.tipo) || typeof a.uid !== 'string' || !UID_RE.test(a.uid) || !Number.isFinite(a.ts)) {
      rechazar.push({ id, detalle: 'Acción mal formada' });
    } else if (ahora - a.ts > MAX_EDAD_MS) {
      rechazar.push({ id, detalle: 'Caducada: tenía más de 24 h pendiente' });
    } else {
      procesar.push({ id, tipo: a.tipo, uid: a.uid, ts: a.ts });
    }
  });
  procesar.sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1));
  const omitidas = Math.max(0, procesar.length - MAX_POR_CORRIDA);
  return { procesar: procesar.slice(0, MAX_POR_CORRIDA).map(({ id, tipo, uid }) => ({ id, tipo, uid })), rechazar, omitidas };
}

// Plan de «eliminar». Entradas ya leídas por el script:
//   esAdmin: admins/{uid} === true | usuario: usuarios/{uid} (objeto o null) | nickDueno: valor de nicks/{nick en minúsculas} | existeEnAuth: bool
// Devuelve { ok:false, detalle } o { ok:true, rutas } (rutas = multi-ruta con null) y `borrarAuth`.
function planEliminar({ uid, esAdmin, usuario, nickDueno, existeEnAuth, solicitud }) {
  if (esAdmin) return { ok: false, detalle: 'Es admin: no se elimina' };
  const rutas = {};
  ['usuarios', 'predicciones', 'referidos', 'pushSubs', 'tabla', 'historial', 'solicitudesBorrado'].forEach((n) => { rutas[n + '/' + uid] = null; });
  if (!existeEnAuth && !esObj(usuario)) {
    // Sin cuenta ni perfil: si quedó una solicitud de borrado (cuenta eliminada por otra vía) se limpian los restos; si no hay nada, es un uid inexistente.
    if (esObj(solicitud)) return { ok: true, rutas, borrarAuth: false, soloRestos: true };
    return { ok: false, detalle: 'uid inexistente' };
  }
  // El nick solo se libera si de verdad es de este uid (nunca el de otro).
  if (esObj(usuario) && typeof usuario.nick === 'string' && usuario.nick && nickDueno === uid) rutas['nicks/' + claveNick(usuario.nick)] = null;
  return { ok: true, rutas, borrarAuth: !!existeEnAuth };
}

// ¿El correo obtenido de Authentication sirve para el restablecimiento?
function correoValido(correo) { return typeof correo === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo); }

// Resultado de «reset» a partir de la respuesta de Google (reutiliza el clasificador del sondeo). No incluye el correo.
function resultadoReset(status, cuerpo, secretos) {
  const v = clasificarRespuesta(status, cuerpo, secretos);
  if (v.resultado === 'enviado') return { estado: 'ok', detalle: 'Correo de restablecimiento enviado' };
  if (v.resultado === 'limite') return { estado: 'error', detalle: 'Límite de intentos de Google: reintenta más tarde' };
  const extra = (v.razon || v.estado || (v.mensaje ? v.mensaje : '')).toString();
  return { estado: 'error', detalle: recortar('Google rechazó el envío (HTTP ' + v.status + (extra ? ': ' + extra : '') + ')') };
}

const resultado = (estado, detalle) => ({ estado, detalle: recortar(detalle) });

module.exports = {
  TIPOS, UID_RE, MAX_EDAD_MS, MAX_POR_CORRIDA, MAX_DETALLE,
  claveNick, clasificarPendientes, planEliminar, correoValido, resultadoReset, resultado, recortar,
};
