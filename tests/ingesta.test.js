'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/ingesta');

const K = 1800000000000, H = 3600000;
const P = (id, o = {}) => ({ [id]: { local: 'Atlético de San Luis', visitante: 'Atlas', kickoff: K, fase: 'regular', jornada: 15, ...o } });
const sdb = (h, a, gl, gv) => ({ strHomeTeam: h, strAwayTeam: a, intHomeScore: gl, intAwayScore: gv });
const esp = (l, v, gl, gv, terminado = true, fecha = new Date(K).toISOString()) => ({ fecha, local: l, visita: v, gl, gv, terminado });

test('mismo: alias frecuentes entre fuentes', () => {
  assert.ok(I.mismo('CD Guadalajara', 'Guadalajara'));
  assert.ok(I.mismo('Santos Laguna', 'Santos'));
  assert.ok(I.mismo('Juárez', 'FC Juárez'));
  assert.ok(I.mismo('Pumas UNAM', 'UNAM'));
  assert.ok(!I.mismo('Atlas', 'Atlante'));
  assert.ok(!I.mismo('Atlético de San Luis', 'Atlas'));
  assert.ok(!I.mismo('Cruz Azul', 'León'));
});

test('partidosPorIngerir: respeta margen, resultados existentes, Liguilla y equipos por definir', () => {
  const partidos = { ...P('a'), ...P('b'), ...P('c', { jornada: undefined, ronda: 'Semifinal' }), ...P('d', { local: 'Por definir' }), ...P('e', { kickoff: K + 5 * H }) };
  const ahora = K + 3 * H;
  assert.deepEqual(I.partidosPorIngerir(partidos, {}, ahora).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(I.partidosPorIngerir(partidos, { a: { gl: 1, gv: 0 } }, ahora).map((x) => x.id), ['b']);
  assert.deepEqual(I.partidosPorIngerir(partidos, {}, K + 100 * 60000), []);       // antes de kickoff + 125 min
  assert.deepEqual(I.partidosPorIngerir(null, null, ahora), []);
});

test('decidir: coinciden y ESPN terminado → publicar', () => {
  const p = P('a').a;
  const r = I.decidir(p, [sdb('Atletico San Luis', 'Atlas', '0', '1')], [esp('Atlético de San Luis', 'Atlas', '0', '1')], K + 3 * H);
  assert.deepEqual(r, { estado: 'publicar', gl: 0, gv: 1 });
});

test('decidir: marcadores distintos → pendiente por discrepancia con ambos valores', () => {
  const p = P('a').a;
  const r = I.decidir(p, [sdb('Atletico San Luis', 'Atlas', 0, 1)], [esp('Atlético de San Luis', 'Atlas', 1, 1)], K + 3 * H);
  assert.equal(r.estado, 'pendiente'); assert.equal(r.motivo, 'discrepancia');
  assert.deepEqual(r.sdb, { gl: 0, gv: 1 }); assert.deepEqual(r.espn, { gl: 1, gv: 1 });
});

test('decidir: ESPN sin terminar o una sola fuente → espera; tras 6 h → pendiente con motivo', () => {
  const p = P('a').a;
  const vivo = [esp('Atlético de San Luis', 'Atlas', 0, 1, false)];
  const conSdb = [sdb('Atletico San Luis', 'Atlas', 0, 1)];
  assert.equal(I.decidir(p, conSdb, vivo, K + 3 * H).estado, 'espera');
  assert.equal(I.decidir(p, conSdb, [], K + 3 * H).estado, 'espera');
  assert.equal(I.decidir(p, conSdb, [], K + 7 * H).motivo, 'solo-thesportsdb');
  assert.equal(I.decidir(p, [], [esp('Atlético de San Luis', 'Atlas', 0, 1)], K + 7 * H).motivo, 'solo-espn');
  assert.equal(I.decidir(p, [], [], K + 7 * H).motivo, 'sin-contraparte');
  assert.equal(I.decidir(p, conSdb, vivo, K + 7 * H).motivo, 'solo-thesportsdb');
});

test('decidir: TheSportsDB sin marcador (null/vacío) no cuenta; ESPN de otra fecha no empareja', () => {
  const p = P('a').a;
  assert.equal(I.decidir(p, [sdb('Atletico San Luis', 'Atlas', null, null)], [esp('Atlético de San Luis', 'Atlas', 0, 1)], K + 3 * H).estado, 'espera');
  const lejano = esp('Atlético de San Luis', 'Atlas', 0, 1, true, new Date(K + 7 * 24 * H).toISOString());
  assert.equal(I.decidir(p, [sdb('Atletico San Luis', 'Atlas', 0, 1)], [lejano], K + 3 * H).estado, 'espera');
});

test('decidir: local y visitante invertidos no empareja (evita cruzar marcadores)', () => {
  const p = P('a').a;
  const r = I.decidir(p, [sdb('Atlas', 'Atletico San Luis', 3, 0)], [esp('Atlas', 'Atlético de San Luis', 3, 0)], K + 3 * H);
  assert.equal(r.estado, 'espera');
});

test('planPendientes: nuevo avisa; igual no se reescribe ni avisa; cambio de motivo o marcador vuelve a avisar', () => {
  const dec = { a: { motivo: 'discrepancia', sdb: { gl: 0, gv: 1 }, espn: { gl: 1, gv: 1 } } };
  const p1 = I.planPendientes(null, dec, 111);
  assert.deepEqual(p1.nuevos, ['a']);
  assert.deepEqual(p1.escribir.a, { motivo: 'discrepancia', sdb: { gl: 0, gv: 1 }, espn: { gl: 1, gv: 1 }, hora: 111 });
  const p2 = I.planPendientes({ a: p1.escribir.a }, dec, 222);
  assert.deepEqual(p2.nuevos, []); assert.deepEqual(p2.escribir, {});
  const p3 = I.planPendientes({ a: p1.escribir.a }, { a: { motivo: 'discrepancia', sdb: { gl: 0, gv: 1 }, espn: { gl: 2, gv: 1 } } }, 333);
  assert.deepEqual(p3.nuevos, ['a']); assert.equal(p3.escribir.a.hora, 333);
  const p4 = I.planPendientes({ a: p1.escribir.a }, { a: { motivo: 'solo-espn', sdb: null, espn: { gl: 1, gv: 1 } } }, 444);
  assert.deepEqual(p4.nuevos, ['a']);
  assert.deepEqual(I.planPendientes({}, {}, 1), { escribir: {}, nuevos: [] });
});
