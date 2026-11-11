'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/tabla');

const u = (...n) => Object.fromEntries(n.map((x) => [x, { nick: 'N_' + x, creado: 1 }]));
const P = (j, id) => [id, { local: 'A', visitante: 'B', kickoff: 1800000000000, fase: 'regular', jornada: j }];
const partidos = Object.fromEntries([P(1, 'p1'), P(1, 'p2'), P(2, 'p3'), P(2, 'p4')]);
const R = (gl, gv) => ({ gl, gv });

test('calcPts: exacto 3 con goles, resultado 1, fallo 0, datos inválidos null', () => {
  assert.deepEqual(T.calcPts(R(2, 1), R(2, 1)), { p: 3, g: 3 });
  assert.deepEqual(T.calcPts(R(0, 0), R(0, 0)), { p: 3, g: 0 });
  assert.deepEqual(T.calcPts(R(2, 1), R(3, 0)), { p: 1, g: 0 });
  assert.deepEqual(T.calcPts(R(1, 1), R(2, 2)), { p: 1, g: 0 });
  assert.deepEqual(T.calcPts(R(2, 1), R(0, 1)), { p: 0, g: 0 });
  assert.equal(T.calcPts(null, R(1, 1)), null);
  assert.equal(T.calcPts({ gl: '2', gv: 1 }, R(2, 1)), null);
  assert.equal(T.calcPts(R(1, 1), null), null);
});

test('jornadaDe: solo enteros positivos; Liguilla (ronda) queda fuera', () => {
  assert.equal(T.jornadaDe({ jornada: 3 }), 3);
  assert.equal(T.jornadaDe({ ronda: 'Cuartos de Final' }), null);
  assert.equal(T.jornadaDe({ jornada: 0 }), null);
  assert.equal(T.jornadaDe({ jornada: '2' }), null);
  assert.equal(T.jornadaDe(null), null);
});

test('referidosValidos: exige invitado con pronóstico, referente existente y sin autorreferencia', () => {
  const us = u('a', 'b', 'c', 'd', 'e');
  const preds = { b: { p1: R(1, 0) }, c: {}, d: { p1: { gl: 'x', gv: 1 } }, e: { p2: R(0, 0) } };
  const refs = { b: { por: 'a' }, c: { por: 'a' }, d: { por: 'a' }, e: { por: 'zzz' }, a: { por: 'a' }, x: { por: 'a' } };
  assert.deepEqual(T.referidosValidos(refs, us, preds), { a: 1 });
  refs.e = { por: 'a' };
  assert.deepEqual(T.referidosValidos(refs, us, preds), { a: 2 });
  assert.deepEqual(T.referidosValidos(null, us, preds), {});
});

test('ordenar: puntos, luego referidos, luego goles; empate total comparte pos; orden único por uid', () => {
  const o = T.ordenarYPosicionar([
    { uid: 'a', nick: 'A', pts: 10, ref: 0, goles: 9 },
    { uid: 'b', nick: 'B', pts: 10, ref: 2, goles: 1 },
    { uid: 'c', nick: 'C', pts: 10, ref: 1, goles: 5 },
    { uid: 'd', nick: 'D', pts: 12, ref: 0, goles: 0 },
    { uid: 'e', nick: 'E', pts: 10, ref: 1, goles: 5 },
    { uid: 'f', nick: 'F', pts: 3, ref: 0, goles: 0 }
  ]);
  const orden = Object.keys(o).sort((x, y) => o[x].orden - o[y].orden);
  assert.deepEqual(orden, ['d', 'b', 'c', 'e', 'a', 'f']);          // el que más invitados trajo gana el empate de puntos
  assert.deepEqual(orden.map((k) => o[k].pos), [1, 2, 3, 3, 5, 6]); // c y e empatan en todo → comparten 3.º
  assert.deepEqual(orden.map((k) => o[k].orden), [1, 2, 3, 4, 5, 6]);
});

test('tabla general: incluye a todos los usuarios con perfil, aun sin pronósticos', () => {
  const r = T.calcularTablas({
    usuarios: Object.assign(u('a', 'b', 'c'), { sinNick: {} }),
    partidos, resultados: { p1: R(2, 1), p2: R(0, 0) },
    predicciones: { a: { p1: R(2, 1), p2: R(1, 1) }, b: { p1: R(0, 0) } }, referidos: {}
  });
  assert.equal(Object.keys(r.tabla).length, 3);
  assert.equal(r.tabla.a.pts, 4);      // 3 (exacto) + 1 (empate)
  assert.equal(r.tabla.a.goles, 3);
  assert.equal(r.tabla.b.pts, 0);
  assert.equal(r.tabla.c.pts, 0);
  assert.equal(r.tabla.a.pos, 1);
  assert.equal(r.tabla.b.pos, 2);      // b y c empatan en 0/0/0
  assert.equal(r.tabla.c.pos, 2);
  assert.equal(r.tabla.sinNick, undefined);
});

test('tabla por Jornada: solo si TODOS sus partidos tienen resultado y cuenta solo esa Jornada', () => {
  const base = { usuarios: u('a', 'b'), partidos, referidos: {}, predicciones: { a: { p1: R(1, 0), p3: R(1, 0) }, b: { p2: R(0, 0), p3: R(2, 2) } } };
  let r = T.calcularTablas(Object.assign({ resultados: { p1: R(1, 0) } }, base));
  assert.deepEqual(r.jornadasCompletas, []);
  assert.equal(r.jornada, 0);
  r = T.calcularTablas(Object.assign({ resultados: { p1: R(1, 0), p2: R(0, 0), p3: R(1, 0) } }, base));
  assert.deepEqual(r.jornadasCompletas, [1]);        // la 2 tiene p4 sin resultado
  assert.equal(r.jornada, 1);
  assert.equal(r.tablaJornada[1].a.pts, 3);          // solo p1 exacto; p3 (Jornada 2) no cuenta
  assert.equal(r.tablaJornada[1].b.pts, 3);          // p2 exacto
  assert.equal(r.tabla.a.pts, 6);                    // general: p1 + p3 exactos
  r = T.calcularTablas(Object.assign({ resultados: { p1: R(1, 0), p2: R(0, 0), p3: R(1, 0), p4: R(0, 0) } }, base));
  assert.deepEqual(r.jornadasCompletas, [1, 2]);
  assert.equal(r.jornada, 2);
});

test('la tabla de Jornada también desempata con referidos (total del jugador)', () => {
  const us = u('a', 'b', 'inv');
  const r = T.calcularTablas({
    usuarios: us, partidos: Object.fromEntries([P(1, 'p1')]), resultados: { p1: R(1, 0) },
    predicciones: { a: { p1: R(1, 0) }, b: { p1: R(1, 0) }, inv: { p1: R(0, 0) } }, referidos: { inv: { por: 'b' } }
  });
  assert.equal(r.tablaJornada[1].b.pos, 1);
  assert.equal(r.tablaJornada[1].a.pos, 2);
  assert.equal(r.tablaJornada[1].b.ref, 1);
});

test('partidos de Liguilla (ronda) no entran en tabla ni en Jornadas', () => {
  const ps = Object.assign({}, partidos, { l1: { local: 'A', visitante: 'B', kickoff: 1800000000000, fase: 'liguilla', ronda: 'Cuartos de Final' } });
  const r = T.calcularTablas({ usuarios: u('a'), partidos: ps, resultados: { p1: R(1, 0), p2: R(1, 0), p3: R(1, 0), p4: R(1, 0), l1: R(3, 0) }, predicciones: { a: { l1: R(3, 0) } }, referidos: {} });
  assert.equal(r.tabla.a.pts, 0);
  assert.deepEqual(r.jornadasCompletas, [1, 2]);
});

test('huella: estable al orden de claves; cambia con resultados o con la Jornada de un partido; ignora lo demás', () => {
  const h1 = T.huellaEntradas(partidos, { p1: R(1, 0), p2: R(0, 0) });
  const h2 = T.huellaEntradas(Object.fromEntries(Object.entries(partidos).reverse()), { p2: R(0, 0), p1: R(1, 0) });
  assert.equal(h1, h2);
  assert.notEqual(h1, T.huellaEntradas(partidos, { p1: R(1, 1), p2: R(0, 0) }));
  assert.notEqual(h1, T.huellaEntradas(partidos, { p1: R(1, 0) }));
  assert.notEqual(h1, T.huellaEntradas(Object.assign({}, partidos, { p4: { local: 'A', visitante: 'B', kickoff: 1800000000000, fase: 'regular', jornada: 3 } }), { p1: R(1, 0), p2: R(0, 0) }));
  const conKickoffDistinto = JSON.parse(JSON.stringify(partidos)); conKickoffDistinto.p1.kickoff += 3600000;
  assert.equal(h1, T.huellaEntradas(conKickoffDistinto, { p1: R(1, 0), p2: R(0, 0) })); // un cambio de horario no recalcula
});

test('planActualizacion: tabla+meta+Jornadas, versión +1 y borra Jornadas que dejaron de estar completas', () => {
  const calculo = { tabla: { a: {} }, tablaJornada: { 2: { a: {} } }, jornadasCompletas: [2], jornada: 2 };
  const c = T.planActualizacion(calculo, { version: 4, publicadas: [1, 2] }, 'h');
  assert.deepEqual(Object.keys(c).sort(), ['tabla', 'tablaJornada/1', 'tablaJornada/2', 'tablaMeta']);
  assert.equal(c['tablaJornada/1'], null);
  assert.deepEqual(c.tablaMeta, { jornada: 2, version: 5, huella: 'h', publicadas: [2] });
  const d = T.planActualizacion(calculo, { version: 1, publicadas: { 0: 2 } }, 'h');   // RTDB puede devolver objeto
  assert.equal(d['tablaJornada/1'], undefined);
  assert.equal(T.planActualizacion({ tabla: {}, tablaJornada: {}, jornadasCompletas: [], jornada: 0 }, null, 'h').tablaMeta.version, 1);
});

test('rendimiento: 5 000 usuarios y 153 partidos calculan en tiempo razonable', () => {
  const us = {}, preds = {}, ps = {}, res = {};
  for (let i = 1; i <= 153; i++) { ps['m' + i] = { local: 'A', visitante: 'B', kickoff: 1800000000000, fase: 'regular', jornada: Math.ceil(i / 9) }; res['m' + i] = R(i % 4, i % 3); }
  for (let i = 0; i < 5000; i++) { us['u' + i] = { nick: 'N' + i }; preds['u' + i] = Object.fromEntries(Object.keys(ps).map((k, x) => [k, R((i + x) % 4, (i * x) % 3)])); }
  const t0 = Date.now();
  const r = T.calcularTablas({ usuarios: us, partidos: ps, resultados: res, predicciones: preds, referidos: {} });
  assert.equal(Object.keys(r.tabla).length, 5000);
  assert.equal(r.jornadasCompletas.length, 17);
  assert.ok(Date.now() - t0 < 15000);
});
