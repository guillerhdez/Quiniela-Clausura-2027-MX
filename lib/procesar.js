'use strict';
// Ejecuta la cola adminAcciones (E3b). Recibe db y auth ya inicializados (firebase-admin) para poder probarlo con falsos.
// Logs públicos: solo se imprime id de acción (clave aleatoria), tipo y estado. Nunca uids, correos, nicks ni la key.
const A = require('./acciones');
const { ENDPOINT, REFERER_SITIO } = require('./sondeo-reset');

const leer = async (db, ruta) => (await db.ref(ruta).get()).val();
const esNoExiste = (e) => e && e.code === 'auth/user-not-found';

async function usuarioAuth(auth, uid) {
  try { return await auth.getUser(uid); } catch (e) { if (esNoExiste(e)) return null; throw e; }
}

async function accionEliminar(ctx, uid) {
  const { db, auth } = ctx;
  const [admins, usuario, authUser, solicitud] = await Promise.all([leer(db, 'admins/' + uid), leer(db, 'usuarios/' + uid), usuarioAuth(auth, uid), leer(db, 'solicitudesBorrado/' + uid)]);
  const nickDueno = usuario && typeof usuario.nick === 'string' && usuario.nick ? await leer(db, 'nicks/' + A.claveNick(usuario.nick)) : null;
  const plan = A.planEliminar({ uid, esAdmin: admins === true, usuario, nickDueno, existeEnAuth: !!authUser, solicitud });
  if (!plan.ok) return A.resultado('error', plan.detalle);
  if (ctx.dry) return A.resultado('ok', '--dry: se borrarían ' + Object.keys(plan.rutas).length + ' rutas' + (plan.borrarAuth ? ' y la cuenta de Authentication' : ''));
  // Primero la base (una sola actualización multi-ruta) y al final Authentication: si algo falla a medias, se puede repetir.
  await db.ref().update(plan.rutas);
  if (plan.borrarAuth) { try { await auth.deleteUser(uid); } catch (e) { if (!esNoExiste(e)) throw e; } }
  // La huella de la tabla no incluye usuarios: se invalida para que el siguiente ciclo (≤10 min) recalcule sin la fila eliminada.
  if ((await leer(db, 'tablaMeta')) !== null) await db.ref('tablaMeta').update({ huella: null });
  if (plan.soloRestos) return A.resultado('ok', 'La cuenta ya no existía; se limpiaron los restos de su solicitud');
  return A.resultado('ok', 'Usuario eliminado; la tabla se recalcula en unos 10 min');
}

async function accionReset(ctx, uid) {
  const authUser = await usuarioAuth(ctx.auth, uid);
  if (!authUser) return A.resultado('error', 'uid inexistente');
  if (!A.correoValido(authUser.email)) return A.resultado('error', 'La cuenta no tiene un correo válido');
  if (ctx.dry) return A.resultado('ok', '--dry: se enviaría el correo de restablecimiento');
  const r = await ctx.fetchFn(ENDPOINT + '?key=' + encodeURIComponent(ctx.key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: REFERER_SITIO, 'User-Agent': 'quiniela-clausura-acciones/1.0' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: authUser.email }),
    signal: AbortSignal.timeout(20000),
  });
  let cuerpo = null; try { cuerpo = await r.json(); } catch (e) { cuerpo = null; }
  return A.resultadoReset(r.status, cuerpo, [ctx.key, authUser.email]);
}

// ctx = { db, auth, fetchFn, key, ahora, dry, log }. Devuelve { procesadas, rechazadas, omitidas, hayErrores }.
async function ejecutar(ctx) {
  const log = ctx.log || (() => {});
  const cola = await leer(ctx.db, 'adminAcciones');
  const { procesar, rechazar, omitidas } = A.clasificarPendientes(cola, ctx.ahora);
  let errores = rechazar.length;
  const marcar = async (id, res) => { if (!ctx.dry) await ctx.db.ref('adminAcciones/' + id).update(res); };

  for (const r of rechazar) { await marcar(r.id, A.resultado('error', r.detalle)); log('Acción ' + r.id + ': error (' + r.detalle + ')'); }
  for (const a of procesar) {
    let res;
    try {
      if (a.tipo === 'reset' && !ctx.key) res = A.resultado('error', 'Falta FIREBASE_WEB_API_KEY en el servidor');
      else res = a.tipo === 'eliminar' ? await accionEliminar(ctx, a.uid) : await accionReset(ctx, a.uid);
    } catch (e) {
      // Solo el código del error (nunca el objeto completo: podría traer uid o correo).
      res = A.resultado('error', 'Fallo inesperado' + (e && e.code ? ' (' + String(e.code).slice(0, 60) + ')' : ''));
    }
    if (res.estado === 'error') errores++;
    await marcar(a.id, res);
    log('Acción ' + a.id + ' [' + a.tipo + ']: ' + res.estado + ' - ' + res.detalle);
  }
  if (omitidas) log('Quedan ' + omitidas + ' acciones para la siguiente corrida');
  if (!procesar.length && !rechazar.length) log('Sin acciones pendientes.');
  return { procesadas: procesar.length, rechazadas: rechazar.length, omitidas, hayErrores: errores > 0 };
}

module.exports = { ejecutar };
