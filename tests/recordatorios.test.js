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

// ---- Liguilla: un aviso por ida y uno por vuelta de cada ronda ----
const D = 24 * H;
const J = (kickoff, extra) => Object.assign({ local: 'Por definir', visitante: 'Por definir', kickoff }, extra);
function fixtureLiguilla() {
  const partidos = { r1: { jornada: 17, kickoff: K - 30 * D, local: 'A', visitante: 'B' } };
  const resultados = { r1: { gl: 1, gv: 0 } };
  // Cuartos de Final: ids 154..161 consecutivos (ida, vuelta por serie); idas el día K, vueltas 3 días después
  for (let s = 0; s < 4; s++) {
    partidos[154 + 2 * s] = J(K + s * H, { ronda: 'Cuartos de Final' });
    partidos[155 + 2 * s] = J(K + 3 * D + s * H, { ronda: 'Cuartos de Final' });
  }
  // Semifinal: 162..165; idas K+10 días, vueltas K+13 días
  for (let s = 0; s < 2; s++) {
    partidos[162 + 2 * s] = J(K + 10 * D + s * H, { ronda: 'Semifinal' });
    partidos[163 + 2 * s] = J(K + 13 * D + s * H, { ronda: 'Semifinal' });
  }
  // Final: 166 ida, 167 vuelta
  partidos[166] = J(K + 20 * D, { ronda: 'Final' });
  partidos[167] = J(K + 23 * D, { ronda: 'Final' });
  return { partidos, resultados };
}

test('etapasLiguilla: sin la fase regular completa no hay ninguna etapa', () => {
  const { partidos } = fixtureLiguilla();
  assert.deepStrictEqual(R.etapasLiguilla(partidos, {}), []);
});

test('etapasLiguilla: con la regular completa solo los Cuartos de Final, con ida y vuelta separadas', () => {
  const { partidos, resultados } = fixtureLiguilla();
  const e = R.etapasLiguilla(partidos, resultados);
  assert.deepStrictEqual(e.map((x) => x.marca), ['l_cuartos_ida', 'l_cuartos_vuelta']);
  assert.strictEqual(e[0].kickoff, K);               // primer partido de las idas
  assert.strictEqual(e[1].kickoff, K + 3 * D);       // primer partido de las vueltas
});

test('etapasLiguilla: la Semifinal exige todos los Cuartos de Final con resultado; la Final, toda la Semifinal', () => {
  const { partidos, resultados } = fixtureLiguilla();
  for (let id = 154; id <= 160; id++) resultados[id] = { gl: 1, gv: 1 };   // falta el 161
  assert.deepStrictEqual(R.etapasLiguilla(partidos, resultados).map((x) => x.clave), ['cuartos', 'cuartos']);
  resultados[161] = { gl: 0, gv: 0 };
  assert.deepStrictEqual(R.etapasLiguilla(partidos, resultados).map((x) => x.marca),
    ['l_cuartos_ida', 'l_cuartos_vuelta', 'l_semifinal_ida', 'l_semifinal_vuelta']);
  for (let id = 162; id <= 165; id++) resultados[id] = { gl: 2, gv: 1 };
  assert.strictEqual(R.etapasLiguilla(partidos, resultados).length, 6);
});

test('seriesDeRonda: la ida es el partido con kickoff más temprano aunque los ids vengan al revés', () => {
  const partidos = { 10: J(K + D, { ronda: 'Semifinal' }), 11: J(K, { ronda: 'Semifinal' }) };
  assert.deepStrictEqual(R.seriesDeRonda(partidos, 'semifinal'), [{ ida: '11', vuelta: '10' }]);
});

test('seriesDeRonda: si todos traen `serie` se agrupa por ese campo (idas primero, vueltas después)', () => {
  const partidos = {
    a: J(K, { ronda: 'Cuartos de Final', serie: 's1' }), b: J(K + H, { ronda: 'Cuartos de Final', serie: 's2' }),
    c: J(K + 3 * D, { ronda: 'Cuartos de Final', serie: 's1' }), d: J(K + 3 * D + H, { ronda: 'Cuartos de Final', serie: 's2' }),
  };
  assert.deepStrictEqual(R.seriesDeRonda(partidos, 'cuartos'), [{ ida: 'a', vuelta: 'c' }, { ida: 'b', vuelta: 'd' }]);
});

test('claveRonda acepta acentos, mayúsculas y la forma corta; ignora otros textos', () => {
  assert.strictEqual(R.claveRonda('  CUARTOS de   final '), 'cuartos');
  assert.strictEqual(R.claveRonda('Semifinal'), 'semifinal');
  assert.strictEqual(R.claveRonda('Final'), 'final');
  assert.strictEqual(R.claveRonda('Gran Final'), null);
  assert.strictEqual(R.claveRonda(5), null);
});

test('etapasPorAvisar: ventana de 2 h a 30 min antes, sin repetir lo ya marcado', () => {
  const { partidos, resultados } = fixtureLiguilla();
  assert.strictEqual(R.etapasPorAvisar(partidos, resultados, {}, K - 2 * H - 1).length, 0);
  assert.deepStrictEqual(R.etapasPorAvisar(partidos, resultados, {}, K - 2 * H).map((x) => x.marca), ['l_cuartos_ida']);
  assert.strictEqual(R.etapasPorAvisar(partidos, resultados, {}, K - 30 * 60 * 1000).length, 0);       // ya cerró
  assert.strictEqual(R.etapasPorAvisar(partidos, resultados, { l_cuartos_ida: 1 }, K - H).length, 0);   // ya avisado
  // la vuelta tiene su propia ventana
  assert.deepStrictEqual(R.etapasPorAvisar(partidos, resultados, { l_cuartos_ida: 1 }, K + 3 * D - H).map((x) => x.marca), ['l_cuartos_vuelta']);
});

test('etapasPorAvisar: la Liguilla no avisa si la ronda anterior está incompleta', () => {
  const { partidos, resultados } = fixtureLiguilla();               // Cuartos sin resultados
  assert.strictEqual(R.etapasPorAvisar(partidos, resultados, {}, K + 10 * D - H).length, 0);   // ventana de la ida de Semifinal
});

test('mensajeEtapa: título con ronda y etapa, y hora de cierre en CDMX', () => {
  const m = R.mensajeEtapa('Semifinal', 'vuelta', K, 'semifinal');
  assert.strictEqual(m.titulo, 'Semifinal · Vuelta: ¡haz tus pronósticos!');
  assert.strictEqual(m.cuerpo, 'El primer partido cierra el sáb 21 a las 17:30 (hora CDMX).');
  assert.strictEqual(m.tag, 'liguilla-semifinal-vuelta');
});

test('proximoAviso: un solo aviso, el de kickoff más próximo, entre Jornada y Liguilla', () => {
  const { partidos, resultados } = fixtureLiguilla();
  partidos.r2 = { jornada: 18, kickoff: K + H, local: 'A', visitante: 'B' };      // Jornada regular más tardía que los Cuartos
  resultados.r2 = { gl: 0, gv: 0 };                                                // la fase regular debe seguir completa
  const a = R.proximoAviso(partidos, resultados, {}, K - 45 * 60 * 1000);
  assert.strictEqual(a.marca, 'l_cuartos_ida');
  assert.strictEqual(a.kickoff, K);
  const b = R.proximoAviso(partidos, resultados, { l_cuartos_ida: 1 }, K - 45 * 60 * 1000);
  assert.strictEqual(b.marca, 'j18');
  assert.strictEqual(R.proximoAviso(partidos, resultados, { l_cuartos_ida: 1, j18: 1 }, K - 45 * 60 * 1000), null);
});

test('la fase regular no se rompe: una Jornada sola sigue avisando con su marca j{N}', () => {
  const p = { a: { jornada: 17, kickoff: K, local: 'A', visitante: 'B' } };
  const a = R.proximoAviso(p, {}, {}, K - H);
  assert.strictEqual(a.marca, 'j17');
  assert.strictEqual(a.mensaje.titulo, 'Jornada 17: ¡haz tus pronósticos!');
});
