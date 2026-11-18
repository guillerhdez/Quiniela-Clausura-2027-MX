'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../lib/acciones');

const AHORA = 1800000000000;
const acc = (o = {}) => ({ tipo: 'reset', uid: 'u1', estado: 'pendiente', ts: AHORA - 1000, ...o });

test('clasificarPendientes: solo pendientes, ordenadas por ts', () => {
  const r = A.clasificarPendientes({
    b: acc({ ts: AHORA - 500 }), a: acc({ tipo: 'eliminar', ts: AHORA - 900 }),
    ya: acc({ estado: 'ok' }), mal: acc({ estado: 'error' }),
  }, AHORA);
  assert.deepEqual(r.procesar.map((x) => x.id), ['a', 'b']);
  assert.equal(r.rechazar.length, 0);
});

test('clasificarPendientes: mal formadas y caducadas se rechazan con detalle', () => {
  const r = A.clasificarPendientes({
    t: acc({ tipo: 'otra' }), u: acc({ uid: '../x' }), s: acc({ uid: undefined }), n: acc({ ts: 'hoy' }),
    v: acc({ ts: AHORA - A.MAX_EDAD_MS - 1 }), ok: acc(), raro: 5,
  }, AHORA);
  assert.deepEqual(r.procesar.map((x) => x.id), ['ok']);
  assert.deepEqual(r.rechazar.map((x) => x.id).sort(), ['n', 's', 't', 'u', 'v']);
  assert.match(r.rechazar.find((x) => x.id === 'v').detalle, /Caducada/);
});

test('clasificarPendientes: entrada nula o tope por corrida', () => {
  assert.deepEqual(A.clasificarPendientes(null, AHORA), { procesar: [], rechazar: [], omitidas: 0 });
  const muchas = {};
  for (let i = 0; i < 25; i++) muchas['k' + String(i).padStart(2, '0')] = acc({ ts: AHORA - 5000 + i });
  const r = A.clasificarPendientes(muchas, AHORA);
  assert.equal(r.procesar.length, A.MAX_POR_CORRIDA);
  assert.equal(r.omitidas, 5);
});

test('planEliminar: un admin nunca se elimina', () => {
  const p = A.planEliminar({ uid: 'u1', esAdmin: true, usuario: { nick: 'Yo' }, nickDueno: 'u1', existeEnAuth: true });
  assert.equal(p.ok, false);
  assert.match(p.detalle, /admin/i);
});

test('planEliminar: uid inexistente en Auth y sin perfil', () => {
  const p = A.planEliminar({ uid: 'u1', esAdmin: false, usuario: null, nickDueno: null, existeEnAuth: false });
  assert.deepEqual(p, { ok: false, detalle: 'uid inexistente' });
});

test('planEliminar: purga todas las rutas del uid y libera su nick', () => {
  const p = A.planEliminar({ uid: 'u1', esAdmin: false, usuario: { nick: 'Juan_Perez' }, nickDueno: 'u1', existeEnAuth: true });
  assert.equal(p.ok, true);
  assert.equal(p.borrarAuth, true);
  assert.deepEqual(Object.keys(p.rutas).sort(), [
    'historial/u1', 'nicks/juan_perez', 'predicciones/u1', 'pushSubs/u1', 'referidos/u1', 'solicitudesBorrado/u1', 'tabla/u1', 'usuarios/u1',
  ]);
  assert.ok(Object.values(p.rutas).every((v) => v === null));
});

test('planEliminar: no libera un nick que pertenece a otro uid', () => {
  const p = A.planEliminar({ uid: 'u1', esAdmin: false, usuario: { nick: 'Juan' }, nickDueno: 'u2', existeEnAuth: true });
  assert.ok(!('nicks/juan' in p.rutas));
});

test('planEliminar: perfil sin Auth (huérfano) y Auth sin perfil', () => {
  const sinAuth = A.planEliminar({ uid: 'u1', esAdmin: false, usuario: { nick: 'A1b' }, nickDueno: 'u1', existeEnAuth: false });
  assert.equal(sinAuth.ok, true); assert.equal(sinAuth.borrarAuth, false);
  const sinPerfil = A.planEliminar({ uid: 'u1', esAdmin: false, usuario: null, nickDueno: null, existeEnAuth: true });
  assert.equal(sinPerfil.ok, true); assert.equal(sinPerfil.borrarAuth, true);
  assert.ok(!Object.keys(sinPerfil.rutas).some((k) => k.startsWith('nicks/')));
});

test('correoValido', () => {
  assert.ok(A.correoValido('a+b@example.com'));
  assert.ok(!A.correoValido('') && !A.correoValido(null) && !A.correoValido('sin-arroba'));
});

test('resultadoReset: ok, límite y rechazo sin filtrar correo ni key', () => {
  const KEY = 'AIzaSyFAKEKEY1234567890', MAIL = 'x@example.com';
  assert.deepEqual(A.resultadoReset(200, { email: MAIL }, [KEY, MAIL]), { estado: 'ok', detalle: 'Correo de restablecimiento enviado' });
  assert.equal(A.resultadoReset(400, { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } }, []).estado, 'error');
  const r = A.resultadoReset(400, { error: { message: 'EMAIL_NOT_FOUND ' + MAIL + ' ' + KEY } }, [KEY, MAIL]);
  assert.equal(r.estado, 'error');
  assert.ok(!r.detalle.includes(MAIL) && !r.detalle.includes(KEY));
  assert.ok(r.detalle.length <= A.MAX_DETALLE);
});

test('resultado: recorta el detalle al límite de las reglas', () => {
  assert.equal(A.resultado('error', 'x'.repeat(500)).detalle.length, A.MAX_DETALLE);
  assert.deepEqual(A.resultado('ok', null), { estado: 'ok', detalle: '' });
});
