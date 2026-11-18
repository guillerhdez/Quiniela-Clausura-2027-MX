'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ejecutar } = require('../lib/procesar');

const AHORA = 1800000000000;
const KEY = 'AIzaSyFAKEKEY1234567890';

// Base falsa mínima: get / update por ruta y update multi-ruta en la raíz (null borra).
function baseFalsa(datos) {
  const d = JSON.parse(JSON.stringify(datos));
  const partes = (r) => (r ? r.split('/') : []);
  const leer = (r) => partes(r).reduce((o, k) => (o && typeof o === 'object' && k in o ? o[k] : null), d);
  const poner = (r, v) => {
    const ps = partes(r); let o = d;
    ps.slice(0, -1).forEach((k) => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    if (v === null) delete o[ps[ps.length - 1]]; else o[ps[ps.length - 1]] = v;
  };
  const ref = (ruta = '') => ({
    get: async () => ({ val: () => { const v = leer(ruta); return v === undefined ? null : v; } }),
    update: async (obj) => { Object.keys(obj).forEach((k) => poner(ruta ? ruta + '/' + k : k, obj[k])); },
  });
  return { ref, d };
}

function authFalso(usuarios) {
  const borrados = [];
  return {
    borrados,
    getUser: async (uid) => { if (!usuarios[uid]) { const e = new Error('no'); e.code = 'auth/user-not-found'; throw e; } return { uid, ...usuarios[uid] }; },
    deleteUser: async (uid) => { borrados.push(uid); delete usuarios[uid]; },
  };
}

const base = () => ({
  admins: { adm: true },
  usuarios: { u1: { nick: 'Juan_Perez' }, adm: { nick: 'Jefe' } },
  nicks: { juan_perez: 'u1', jefe: 'adm' },
  predicciones: { u1: { p1: { gl: 1, gv: 0 } } },
  referidos: { u1: { por: 'adm' } },
  solicitudesBorrado: { u1: { ts: AHORA - 5000 } },
  tabla: { u1: { nick: 'Juan_Perez' } },
  tablaMeta: { jornada: 3, version: 7, huella: 'abc' },
  adminAcciones: {
    a1: { tipo: 'eliminar', uid: 'u1', estado: 'pendiente', ts: AHORA - 2000 },
  },
});

const fetchOk = (log) => async (url, o) => { log.push({ url, headers: o.headers, body: o.body }); return { status: 200, json: async () => ({ email: 'x' }) }; };

test('eliminar: purga rutas, borra Auth, invalida huella y marca ok', async () => {
  const db = baseFalsa(base()), auth = authFalso({ u1: { email: 'a@b.com' }, adm: { email: 'j@b.com' } }), logs = [];
  const r = await ejecutar({ db, auth, fetchFn: async () => { throw new Error('no debe llamarse'); }, key: KEY, ahora: AHORA, log: (t) => logs.push(t) });
  assert.equal(r.procesadas, 1); assert.equal(r.hayErrores, false);
  assert.deepEqual(auth.borrados, ['u1']);
  for (const ruta of ['usuarios/u1', 'nicks/juan_perez', 'predicciones/u1', 'referidos/u1', 'solicitudesBorrado/u1', 'tabla/u1']) assert.equal((await db.ref(ruta).get()).val(), null, ruta);
  assert.equal((await db.ref('usuarios/adm').get()).val().nick, 'Jefe');
  assert.equal((await db.ref('tablaMeta/huella').get()).val(), null);
  assert.equal((await db.ref('tablaMeta/version').get()).val(), 7);
  assert.equal((await db.ref('adminAcciones/a1/estado').get()).val(), 'ok');
  assert.ok(!logs.join('\n').match(/u1|Juan|a@b\.com/));
});

test('eliminar a un admin se niega y no borra nada', async () => {
  const datos = base(); datos.adminAcciones = { a1: { tipo: 'eliminar', uid: 'adm', estado: 'pendiente', ts: AHORA - 10 } };
  const db = baseFalsa(datos), auth = authFalso({ adm: { email: 'j@b.com' } });
  const r = await ejecutar({ db, auth, fetchFn: null, key: KEY, ahora: AHORA });
  assert.equal(r.hayErrores, true);
  assert.deepEqual(auth.borrados, []);
  assert.equal((await db.ref('usuarios/adm/nick').get()).val(), 'Jefe');
  assert.equal((await db.ref('adminAcciones/a1/estado').get()).val(), 'error');
  assert.match((await db.ref('adminAcciones/a1/detalle').get()).val(), /admin/i);
});

test('eliminar uid inexistente y acción ya procesada no se repite', async () => {
  const datos = base();
  datos.adminAcciones = {
    a1: { tipo: 'eliminar', uid: 'fantasma', estado: 'pendiente', ts: AHORA - 10 },
    a2: { tipo: 'eliminar', uid: 'u1', estado: 'ok', ts: AHORA - 20, detalle: 'listo' },
  };
  const db = baseFalsa(datos), auth = authFalso({ u1: { email: 'a@b.com' } });
  const r = await ejecutar({ db, auth, fetchFn: null, key: KEY, ahora: AHORA });
  assert.equal(r.procesadas, 1);
  assert.deepEqual(auth.borrados, []);
  assert.equal((await db.ref('adminAcciones/a1/detalle').get()).val(), 'uid inexistente');
  assert.equal((await db.ref('usuarios/u1/nick').get()).val(), 'Juan_Perez');
});

test('eliminar: cuenta ya inexistente con solicitud huérfana: limpia los restos y queda ok', async () => {
  const datos = base();
  datos.solicitudesBorrado = Object.assign({}, datos.solicitudesBorrado, { fantasma: { ts: 1800000000000 } });
  datos.adminAcciones = { a1: { tipo: 'eliminar', uid: 'fantasma', estado: 'pendiente', ts: AHORA - 10 } };
  const db = baseFalsa(datos), auth = authFalso({ u1: { email: 'a@b.com' } });
  const r = await ejecutar({ db, auth, fetchFn: null, key: KEY, ahora: AHORA });
  assert.equal(r.procesadas, 1);
  assert.deepEqual(auth.borrados, []);
  assert.equal((await db.ref('adminAcciones/a1/estado').get()).val(), 'ok');
  assert.match((await db.ref('adminAcciones/a1/detalle').get()).val(), /restos/);
  assert.equal((await db.ref('solicitudesBorrado/fantasma').get()).val(), null);
  assert.equal((await db.ref('usuarios/u1/nick').get()).val(), 'Juan_Perez');
});

test('eliminar: si Auth ya no tiene la cuenta pero el perfil sí, igual se purga', async () => {
  const db = baseFalsa(base()), auth = authFalso({});
  const r = await ejecutar({ db, auth, fetchFn: null, key: KEY, ahora: AHORA });
  assert.equal(r.hayErrores, false);
  assert.equal((await db.ref('usuarios/u1').get()).val(), null);
});

test('reset: llama a Google con Referer, key y correo de Auth; no filtra el correo', async () => {
  const datos = base(); datos.adminAcciones = { r1: { tipo: 'reset', uid: 'u1', estado: 'pendiente', ts: AHORA - 10 } };
  const db = baseFalsa(datos), auth = authFalso({ u1: { email: 'a@b.com' } }), llamadas = [], logs = [];
  const r = await ejecutar({ db, auth, fetchFn: fetchOk(llamadas), key: KEY, ahora: AHORA, log: (t) => logs.push(t) });
  assert.equal(r.hayErrores, false);
  assert.equal(llamadas.length, 1);
  assert.match(llamadas[0].url, /accounts:sendOobCode\?key=/);
  assert.equal(llamadas[0].headers.Referer, 'https://clausura-mx-2027.netlify.app/');
  assert.deepEqual(JSON.parse(llamadas[0].body), { requestType: 'PASSWORD_RESET', email: 'a@b.com' });
  assert.equal((await db.ref('adminAcciones/r1/estado').get()).val(), 'ok');
  assert.ok(!logs.join('\n').includes('a@b.com') && !logs.join('\n').includes(KEY));
  assert.equal((await db.ref('usuarios/u1/nick').get()).val(), 'Juan_Perez'); // reset no borra nada
});

test('reset: rechazo de Google, uid inexistente y falta de key quedan en error', async () => {
  const datos = base();
  datos.adminAcciones = {
    r1: { tipo: 'reset', uid: 'u1', estado: 'pendiente', ts: AHORA - 30 },
    r2: { tipo: 'reset', uid: 'nadie', estado: 'pendiente', ts: AHORA - 20 },
  };
  const db = baseFalsa(datos), auth = authFalso({ u1: { email: 'a@b.com' } });
  const bloqueado = async () => ({ status: 403, json: async () => ({ error: { message: 'Requests from referer <empty> are blocked.', details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }) });
  const r = await ejecutar({ db, auth, fetchFn: bloqueado, key: KEY, ahora: AHORA });
  assert.equal(r.hayErrores, true);
  assert.equal((await db.ref('adminAcciones/r1/estado').get()).val(), 'error');
  assert.match((await db.ref('adminAcciones/r1/detalle').get()).val(), /Google rechazó/);
  assert.equal((await db.ref('adminAcciones/r2/detalle').get()).val(), 'uid inexistente');

  const db2 = baseFalsa({ ...base(), adminAcciones: { r1: { tipo: 'reset', uid: 'u1', estado: 'pendiente', ts: AHORA - 5 } } });
  await ejecutar({ db: db2, auth: authFalso({ u1: { email: 'a@b.com' } }), fetchFn: null, key: '', ahora: AHORA });
  assert.match((await db2.ref('adminAcciones/r1/detalle').get()).val(), /FIREBASE_WEB_API_KEY/);
});

test('un fallo inesperado de Auth solo expone el código y deja la acción en error', async () => {
  const db = baseFalsa(base());
  const auth = { getUser: async () => { const e = new Error('uid u1 correo a@b.com'); e.code = 'auth/internal-error'; throw e; }, deleteUser: async () => {} };
  const r = await ejecutar({ db, auth, fetchFn: null, key: KEY, ahora: AHORA });
  assert.equal(r.hayErrores, true);
  const det = (await db.ref('adminAcciones/a1/detalle').get()).val();
  assert.match(det, /auth\/internal-error/);
  assert.ok(!det.includes('a@b.com') && !det.includes('u1'));
  assert.equal((await db.ref('usuarios/u1').get()).val().nick, 'Juan_Perez');
});

test('dry: no escribe, no borra y no envía', async () => {
  const datos = base();
  datos.adminAcciones.r1 = { tipo: 'reset', uid: 'adm', estado: 'pendiente', ts: AHORA - 5 };
  const db = baseFalsa(datos), auth = authFalso({ u1: { email: 'a@b.com' }, adm: { email: 'j@b.com' } }), llamadas = [];
  await ejecutar({ db, auth, fetchFn: fetchOk(llamadas), key: KEY, ahora: AHORA, dry: true });
  assert.equal(llamadas.length, 0); assert.deepEqual(auth.borrados, []);
  assert.equal((await db.ref('adminAcciones/a1/estado').get()).val(), 'pendiente');
  assert.equal((await db.ref('usuarios/u1/nick').get()).val(), 'Juan_Perez');
});

test('cola vacía o inexistente: no hace nada', async () => {
  const datos = base(); delete datos.adminAcciones;
  const r = await ejecutar({ db: baseFalsa(datos), auth: authFalso({}), fetchFn: null, key: KEY, ahora: AHORA });
  assert.deepEqual(r, { procesadas: 0, rechazadas: 0, omitidas: 0, hayErrores: false });
});
