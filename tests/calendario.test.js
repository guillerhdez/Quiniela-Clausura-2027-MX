'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/calendario');

// Datos reales de la Jornada 17 (sondeo del 13-nov-2026): [local SDB, visitante SDB, ts SDB, ESPN local, ESPN visita, ESPN fecha]
const J17 = [
  ['Tijuana', 'Atlante', '2026-11-21T03:00:00', 'Tijuana', 'Atlante', '2026-11-21T03:00Z'],
  ['Puebla', 'Atletico de San Luis', '2026-11-21T01:00:00', 'Puebla', 'Atlético de San Luis', '2026-11-21T01:00Z'],
  ['Juárez', 'Atlas', '2026-11-21T03:00:00', 'FC Juárez', 'Atlas', '2026-11-21T03:00Z'],
  ['Santos Laguna', 'León', '2026-11-21T23:00:00', 'Santos', 'León', '2026-11-21T23:00Z'],
  ['Pachuca', 'Toluca', '2026-11-21T23:00:00', 'Pachuca', 'Toluca', '2026-11-21T22:50Z'],
  ['Pumas UNAM', 'Monterrey', '2026-11-22T01:00:00', 'Pumas UNAM', 'Monterrey', '2026-11-22T01:00Z'],
  ['Tigres UANL', 'América', '2026-11-22T03:00:00', 'Tigres UANL', 'América', '2026-11-22T03:00Z'],
  ['CD Guadalajara', 'Cruz Azul', '2026-11-22T23:07:00', 'Guadalajara', 'Cruz Azul', '2026-11-22T23:07Z'],
  ['Querétaro', 'Necaxa', '2026-11-23T01:00:00', 'Querétaro', 'Necaxa', '2026-11-23T01:00Z']
];
const sdb = (rondas = 17) => J17.map((r) => C.normalizarSdb({ intRound: String(rondas), strHomeTeam: r[0], strAwayTeam: r[1], strTimestamp: r[2], strPostponed: 'no' }));
const espn = () => J17.map((r) => C.normalizarEspn({ date: r[5], competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: r[3] } }, { homeAway: 'away', team: { displayName: r[4] } }] }] }));
const AHORA = Date.parse('2026-11-13T17:00:00Z');

test('equipoDe: alias de ambas fuentes resuelven al mismo club; desconocidos → null', () => {
  assert.equal(C.equipoDe('FC Juárez').nombre, 'Juárez');
  assert.equal(C.equipoDe('Atletico de San Luis').clave, C.equipoDe('Atlético de San Luis').clave);
  assert.equal(C.equipoDe('CD Guadalajara'), C.equipoDe('Guadalajara'));
  assert.equal(C.equipoDe('Santos'), C.equipoDe('Santos Laguna'));
  assert.equal(C.equipoDe('Mazatlán'), null);
  assert.equal(C.EQUIPOS.length, 18);
});

test('normalizarSdb / normalizarEspn: UTC, inválidos → null', () => {
  assert.equal(C.normalizarSdb({ intRound: '17', strHomeTeam: 'A', strAwayTeam: 'B', strTimestamp: '2026-11-21T03:00:00' }).kickoff, Date.parse('2026-11-21T03:00:00Z'));
  assert.equal(C.normalizarSdb({ intRound: '17', strHomeTeam: 'A', strAwayTeam: 'B', strTimestamp: null }), null);
  assert.equal(C.normalizarSdb({ intRound: 'x', strTimestamp: '2026-11-21T03:00:00' }), null);
  assert.equal(C.normalizarSdb({ intRound: '7', strTimestamp: '2026-11-21T03:00:00', strPostponed: 'yes' }).pospuesto, true);
  assert.equal(C.normalizarEspn({ date: 'x', competitions: [] }), null);
  assert.equal(C.normalizarEspn(null), null);
});

test('Jornada 17 real: carga los 9, con ids estables y el horario más temprano (Pachuca-Toluca 22:50Z)', () => {
  const r = C.decidirCalendario(sdb(), espn(), {}, {}, { ahora: AHORA });
  assert.equal(Object.keys(r.cargar).length, 9);
  assert.deepEqual(r.pendientes, {});
  assert.deepEqual(r.cargar.j17_tijuana_atlante, { local: 'Tijuana', visitante: 'Atlante', kickoff: Date.parse('2026-11-21T03:00:00Z'), fase: 'regular', jornada: 17 });
  assert.equal(r.cargar.j17_pachuca_toluca.kickoff, Date.parse('2026-11-21T22:50:00Z'));
  assert.deepEqual(Object.keys(r.cargar).sort(), ['j17_guadalajara_cruz-azul', 'j17_juarez_atlas', 'j17_pachuca_toluca', 'j17_puebla_atletico-san-luis', 'j17_pumas_monterrey', 'j17_queretaro_necaxa', 'j17_santos_leon', 'j17_tigres_america', 'j17_tijuana_atlante']);
});

test('horario distinto > 15 min → pendiente "horario-distinto" con ambos valores, sin cargar', () => {
  const e = espn(); e[0].kickoff += 30 * 60000;
  const r = C.decidirCalendario(sdb(), e, {}, {}, { ahora: AHORA });
  assert.equal(r.cargar.j17_tijuana_atlante, undefined);
  assert.equal(r.pendientes.j17_tijuana_atlante.motivo, 'horario-distinto');
  assert.equal(r.pendientes.j17_tijuana_atlante.espn.kickoff - r.pendientes.j17_tijuana_atlante.sdb.kickoff, 30 * 60000);
  assert.equal(Object.keys(r.cargar).length, 8);
});

test('sin contraparte en ESPN → "solo-thesportsdb"; equipo desconocido → pendiente; mismo equipo en ambos lados → pendiente', () => {
  const r = C.decidirCalendario(sdb(), espn().slice(1), {}, {}, { ahora: AHORA });
  assert.equal(r.pendientes.j17_tijuana_atlante.motivo, 'solo-thesportsdb');
  const s = sdb(); s[1].local = 'Mazatlán'; s[2].visitante = 'Juárez';
  const r2 = C.decidirCalendario(s, espn(), {}, {}, { ahora: AHORA });
  assert.equal(r2.pendientes['j17_mazatlan_atletico-de-san-luis'].motivo, 'equipo-desconocido');
  assert.equal(r2.pendientes['j17_juarez_juarez'].motivo, 'equipos-iguales');
  assert.equal(Object.keys(r2.cargar).length, 7);
});

test('fuera de ventana (más allá del horizonte, pasado, pospuesto, ronda > 17) se ignora sin pendiente', () => {
  const lejos = C.decidirCalendario(sdb(), espn(), {}, {}, { ahora: Date.parse('2026-10-01T00:00:00Z') });
  assert.equal(Object.keys(lejos.cargar).length, 0); assert.equal(lejos.ignorados, 9); assert.deepEqual(lejos.pendientes, {});
  const pasado = C.decidirCalendario(sdb(), espn(), {}, {}, { ahora: Date.parse('2026-12-10T00:00:00Z') });
  assert.equal(Object.keys(pasado.cargar).length, 0); assert.equal(pasado.ignorados, 9);
  const s = sdb(); s[0].pospuesto = true;
  assert.equal(Object.keys(C.decidirCalendario(s, espn(), {}, {}, { ahora: AHORA }).cargar).length, 8);
  assert.equal(Object.keys(C.decidirCalendario(sdb(18), espn(), {}, {}, { ahora: AHORA }).cargar).length, 0);
});

test('existentes: con resultado no se toca; igual → sinCambio; distinto → actualiza y conserva campos extra', () => {
  const primero = C.decidirCalendario(sdb(), espn(), {}, {}, { ahora: AHORA }).cargar;
  const igual = C.decidirCalendario(sdb(), espn(), primero, {}, { ahora: AHORA });
  assert.equal(Object.keys(igual.cargar).length, 0); assert.equal(igual.sinCambio, 9);
  const ex = JSON.parse(JSON.stringify(primero)); ex.j17_tijuana_atlante.kickoff -= 3600000; ex.j17_tijuana_atlante.sede = 'Caliente';
  const act = C.decidirCalendario(sdb(), espn(), ex, {}, { ahora: AHORA });
  assert.deepEqual(act.cambios, ['j17_tijuana_atlante']);
  assert.equal(act.cargar.j17_tijuana_atlante.kickoff, Date.parse('2026-11-21T03:00:00Z'));
  assert.equal(act.cargar.j17_tijuana_atlante.sede, 'Caliente');
  const conRes = C.decidirCalendario(sdb(), espn(), ex, { j17_tijuana_atlante: { gl: 1, gv: 0 } }, { ahora: AHORA });
  assert.equal(conRes.cargar.j17_tijuana_atlante, undefined);
  assert.equal(ex.j17_tijuana_atlante.kickoff, primero.j17_tijuana_atlante.kickoff - 3600000);
});

test('duplicado en TheSportsDB → pendiente y no se carga; entradas inválidas no rompen', () => {
  const s = sdb(); s.push(Object.assign({}, s[0]));
  const r = C.decidirCalendario(s, espn(), {}, {}, { ahora: AHORA });
  assert.equal(r.pendientes.j17_tijuana_atlante.motivo, 'duplicado');
  assert.equal(r.cargar.j17_tijuana_atlante, undefined);
  assert.doesNotThrow(() => C.decidirCalendario(null, undefined, null, null, { ahora: AHORA }));
  assert.doesNotThrow(() => C.decidirCalendario([null, 5], [null], {}, {}, { ahora: AHORA }));
});

test('pendientes resolubles traen `base` canónica (equipos y Jornada); los irresolubles no', () => {
  const e = espn(); e[0].kickoff += 30 * 60000;
  const r = C.decidirCalendario(sdb(), e, {}, {}, { ahora: AHORA });
  assert.deepEqual(r.pendientes.j17_tijuana_atlante.base, { local: 'Tijuana', visitante: 'Atlante', jornada: 17 });
  const r2 = C.decidirCalendario(sdb(), espn().slice(1), {}, {}, { ahora: AHORA });
  assert.deepEqual(r2.pendientes.j17_tijuana_atlante.base, { local: 'Tijuana', visitante: 'Atlante', jornada: 17 });
  const s = sdb(); s[1].local = 'Mazatlán';
  assert.equal(C.decidirCalendario(s, espn(), {}, {}, { ahora: AHORA }).pendientes['j17_mazatlan_atletico-de-san-luis'].base, undefined);
});
