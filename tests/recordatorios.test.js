'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../lib/recordatorios');

const H = 3600 * 1000;
// 21-nov-2026 18:00 CDMX = 22 de noviembre 00:00 UTC
const K = Date.UTC(2026, 10, 22, 0, 0, 0);

test('horaCdmx y diaCdmx usan UTC-6 fijo', () => {
  assert.strictEqual(R.horaCdmx(K), '18:00');
  assert.strictEqual(R.diaCdmx(K), 'sáb 21');
  assert.strictEqual(R.horaCdmx(K - 30 * 60 * 1000), '17:30');
});

test('primerosPorJornada toma el kickoff más temprano y ignora Liguilla y datos malos', () => {
  const p = {
    a: { jornada: 17, kickoff: K + 5 * H }, b: { jornada: 17, kickoff: K }, c: { jornada: 16, kickoff: K - 7 * 24 * H },
    liguilla: { ronda: 'Final', kickoff: K + 99 * H }, mal: { jornada: 'x', kickoff: K }, sinK: { jornada: 3 }, nulo: null,
  };
  assert.deepStrictEqual(R.primerosPorJornada(p), { 17: K, 16: K - 7 * 24 * H });
  assert.deepStrictEqual(R.primerosPorJornada(null), {});
});

test('jornadasPorAvisar: antes de la ventana no, dentro sí, tras el cierre no', () => {
  const p = { a: { jornada: 17, kickoff: K } };
  assert.strictEqual(R.jornadasPorAvisar(p, {}, K - 2 * H - 1).length, 0);
  assert.strictEqual(R.jornadasPorAvisar(p, {}, K - 2 * H).length, 1);
  assert.strictEqual(R.jornadasPorAvisar(p, {}, K - 31 * 60 * 1000).length, 1);
  assert.strictEqual(R.jornadasPorAvisar(p, {}, K - 30 * 60 * 1000).length, 0); // ya cerró el primer partido
  assert.strictEqual(R.jornadasPorAvisar(p, {}, K + H).length, 0);
});

test('jornadasPorAvisar: no repite si ya se avisó y devuelve solo la más próxima', () => {
  const p = { a: { jornada: 17, kickoff: K }, b: { jornada: 18, kickoff: K + 1 * H } };
  const ahora = K - 45 * 60 * 1000;
  assert.deepStrictEqual(R.jornadasPorAvisar(p, {}, ahora), [{ jornada: 17, kickoff: K }]);
  assert.deepStrictEqual(R.jornadasPorAvisar(p, { j17: true }, ahora), [{ jornada: 18, kickoff: K + H }]);
});

test('mensajeJornada indica el cierre real (kickoff − 30 min) en hora CDMX', () => {
  const m = R.mensajeJornada(17, K);
  assert.match(m.titulo, /Jornada 17/);
  assert.match(m.cuerpo, /sáb 21 a las 17:30/);
  assert.strictEqual(m.tag, 'jornada-17');
});

test('claveSegura elimina caracteres prohibidos en claves de Firebase', () => {
  assert.strictEqual(R.claveSegura('j17.a/b#c$d[e]'), 'j17_a_b_c_d_e_');
  assert.ok(R.claveSegura('x'.repeat(300)).length <= 100);
});

test('pendientesPorAvisar: nuevo avisa, igual no, cambiado vuelve a avisar', () => {
  const pend = { p1: { motivo: 'discrepancia' } };
  const cal = { c1: { motivo: 'horario-distinto' } };
  const a = R.pendientesPorAvisar(pend, cal, {});
  assert.strictEqual(a.nuevos.length, 2);
  const b = R.pendientesPorAvisar(pend, cal, a.vistos);
  assert.strictEqual(b.nuevos.length, 0);
  const c = R.pendientesPorAvisar({ p1: { motivo: 'solo-espn' } }, cal, a.vistos);
  assert.strictEqual(c.nuevos.length, 1);
  assert.strictEqual(c.nuevos[0].tipo, 'res');
});

test('pendientesPorAvisar con nodos vacíos o nulos', () => {
  assert.deepStrictEqual(R.pendientesPorAvisar(null, undefined, null), { nuevos: [], vistos: {} });
});

test('mensajeAdmin cuenta cada tipo en singular y plural', () => {
  const m = R.mensajeAdmin([{ tipo: 'res' }, { tipo: 'cal' }, { tipo: 'cal' }]);
  assert.match(m.cuerpo, /1 resultado y 2 partidos del calendario/);
});

test('suscripcionValida exige endpoint https y claves', () => {
  const ok = { endpoint: 'https://push.example/abc', keys: { p256dh: 'a', auth: 'b' } };
  assert.ok(R.suscripcionValida(ok));
  assert.ok(!R.suscripcionValida({ ...ok, endpoint: 'http://x' }));
  assert.ok(!R.suscripcionValida({ endpoint: ok.endpoint }));
  assert.ok(!R.suscripcionValida(null));
});

test('esSuscripcionMuerta solo para 404 y 410', () => {
  assert.ok(R.esSuscripcionMuerta(410) && R.esSuscripcionMuerta(404));
  assert.ok(!R.esSuscripcionMuerta(500) && !R.esSuscripcionMuerta(429) && !R.esSuscripcionMuerta(201));
});
