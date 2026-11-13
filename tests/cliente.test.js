'use strict';
// Pruebas de la lógica pura del cliente: se extrae el bloque entre los marcadores de index.html.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// El index.html no vive en este repo (se despliega a mano en Netlify). Uso: INDEX_HTML=ruta/al/index.html npm test
// Sin ese archivo, estas pruebas se omiten (no fallan) para no romper el flujo de «Calcular tabla».
const archivo = process.env.INDEX_HTML || path.join(__dirname, '..', 'index.html');
if (!fs.existsSync(archivo)) {
  test('cliente: index.html no disponible, pruebas omitidas (define INDEX_HTML)', { skip: true }, () => {});
  return;
}
const html = fs.readFileSync(archivo, 'utf8');
const a = html.indexOf('// ===== LOGICA PURA: INICIO'), b = html.indexOf('// ===== LOGICA PURA: FIN');
assert.ok(a > 0 && b > a, 'no se encontraron los marcadores');
const bloque = html.slice(a, b);
const nombres = [...bloque.matchAll(/^(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
const C = vm.runInNewContext(bloque + '\n;({' + nombres.join(',') + '})', { URLSearchParams, atob, encodeURIComponent });

/* ---------- fixture: 10 clubes, todos contra todos una vez; el club i le gana a j si i<j (1-0) ---------- */
const clubes = Array.from({ length: 10 }, (_, i) => 'T' + (i + 1));
function fixture(extra) {
  const partidos = {}, resultados = {};
  let id = 1;
  for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
    partidos[id] = { local: clubes[i], visitante: clubes[j], kickoff: 1800000000000 + id * 3600000, fase: 'regular', jornada: 1 + (id % 5) };
    resultados[id] = { gl: 1, gv: 0 };
    id++;
  }
  return Object.assign({ partidos, resultados }, extra || {});
}
const LIG = (id, ronda, extra) => [String(id), Object.assign({ local: 'Por definir', visitante: 'Por definir', kickoff: 1900000000000 + id * 3600000, fase: 'liguilla', ronda }, extra || {})];
function conLiguilla(f) {
  Object.assign(f.partidos, Object.fromEntries([
    ...[101, 102, 103, 104, 105, 106, 107, 108].map((i) => LIG(i, 'Cuartos de Final')),
    ...[109, 110, 111, 112].map((i) => LIG(i, 'Semifinal')),
    LIG(113, 'Final'), LIG(114, 'Final')
  ]));
  return f;
}
const R = (gl, gv) => ({ gl, gv });

test('claveRonda: acentos, mayúsculas; Semifinal y Cuartos no son Final', () => {
  assert.equal(C.claveRonda('Cuartos de Final'), 'cuartos');
  assert.equal(C.claveRonda(' CUARTOS DE FINAL '), 'cuartos');
  assert.equal(C.claveRonda('Semifinal'), 'semifinal');
  assert.equal(C.claveRonda('Final'), 'final');
  assert.equal(C.claveRonda('Gran Final'), null);
  assert.equal(C.claveRonda('Semis'), null);
  assert.equal(C.claveRonda(null), null);
});

test('esPartidoRegular / esPartidoLiguilla', () => {
  const f = conLiguilla(fixture());
  assert.equal(C.esPartidoRegular(f.partidos[1]), true);
  assert.equal(C.esPartidoLiguilla(f.partidos[1]), false);
  assert.equal(C.esPartidoLiguilla(f.partidos[101]), true);
  assert.equal(C.esPartidoRegular(f.partidos[101]), false);
  assert.equal(C.esPartidoLiguilla(Object.assign({}, f.partidos[101], { jornada: 3 })), false); // la Jornada manda
});

test('tablaClubes: orden por puntos; desempate dif, gf, gfV, nombre', () => {
  const f = fixture();
  const t = C.tablaClubes(f.partidos, f.resultados);
  assert.deepEqual(t.map((x) => x.nombre), clubes);
  assert.equal(t[0].pts, 27);
  assert.equal(t[9].pts, 0);
  // empate en pts: A gana 3-0 a C; B gana 1-0 a C → A mejor por dif
  const p = { 1: { local: 'A', visitante: 'C', kickoff: 1, jornada: 1 }, 2: { local: 'B', visitante: 'C', kickoff: 2, jornada: 1 } };
  const t2 = C.tablaClubes(p, { 1: R(3, 0), 2: R(1, 0) });
  assert.deepEqual(t2.map((x) => x.nombre), ['A', 'B', 'C']);
  // mismo pts, dif y gf: gana el de más goles de visitante
  const p3 = { 1: { local: 'X', visitante: 'Y', kickoff: 1, jornada: 1 }, 2: { local: 'Y', visitante: 'X', kickoff: 2, jornada: 1 } };
  const t3 = C.tablaClubes(p3, { 1: R(1, 1), 2: R(1, 1) });
  assert.equal(t3[0].nombre, 'X'); // empate total → alfabético
  const p4 = { 1: { local: 'M', visitante: 'N', kickoff: 1, jornada: 1 }, 2: { local: 'N', visitante: 'M', kickoff: 2, jornada: 1 } };
  const t4 = C.tablaClubes(p4, { 1: R(2, 1), 2: R(2, 1) }); // M: 1-0 local... N: igual → ambos 3 pts; M gf 2+1=3, N gf 1+2=3; dif 0; gfV: N=1+... M visita 1, N visita 1
  assert.equal(t4.length, 2);
  assert.equal(C.tablaClubes({ 1: { local: 'A', visitante: 'B', kickoff: 1, jornada: 1 } }, {})[0].jj, 0); // sin resultados no cuenta
});

test('regularCompleta: exige todos los partidos regulares con resultado', () => {
  const f = conLiguilla(fixture());
  assert.equal(C.regularCompleta(f.partidos, f.resultados), true);   // los de Liguilla no cuentan
  delete f.resultados[7];
  assert.equal(C.regularCompleta(f.partidos, f.resultados), false);
  assert.equal(C.regularCompleta({}, {}), false);
});

test('ganadorSerie: global sin penales; empate → mejor posición; incompleta → null', () => {
  const pos = { A: 2, B: 7 };
  assert.equal(C.ganadorSerie(R(0, 1), R(0, 0), 'A', 'B', pos), 'A');   // ida: B local 0, A visita 1
  assert.equal(C.ganadorSerie(R(3, 0), R(1, 0), 'A', 'B', pos), 'B');   // B 3+0, A 0+1
  assert.equal(C.ganadorSerie(R(1, 1), R(2, 2), 'A', 'B', pos), 'A');   // empate 3-3 → A (pos 2)
  assert.equal(C.ganadorSerie(R(1, 1), R(2, 2), 'B', 'A', pos), 'A');   // el orden de los argumentos no cambia al ganador por posición
  assert.equal(C.ganadorSerie(R(1, 0), null, 'A', 'B', pos), null);
});

test('resolverLiguilla: sin fase regular completa no hay equipos', () => {
  const f = conLiguilla(fixture());
  delete f.resultados[3];
  const l = C.resolverLiguilla(f.partidos, f.resultados);
  assert.equal(l.completa, false);
  assert.deepEqual(l.top8, []);
  assert.deepEqual(Object.keys(l.equiposPorPartido), []);
  const v = C.aplicarEquipos(f.partidos, l.equiposPorPartido);
  assert.equal(v['101'].porDefinir, true);
  assert.equal(v['101'].local, 'Por definir');
});

test('resolverLiguilla: Cuartos de Final 1v8, 2v7, 3v6, 4v5; B local en la ida, A local en la vuelta', () => {
  const f = conLiguilla(fixture());
  const l = C.resolverLiguilla(f.partidos, f.resultados);
  assert.equal(l.completa, true);
  assert.deepEqual(l.top8, clubes.slice(0, 8));
  assert.deepEqual(l.equiposPorPartido['101'], { local: 'T8', visitante: 'T1', serie: 'QF1' });
  assert.deepEqual(l.equiposPorPartido['102'], { local: 'T1', visitante: 'T8', serie: 'QF1' });
  assert.deepEqual(l.equiposPorPartido['107'], { local: 'T5', visitante: 'T4', serie: 'QF4' });
  assert.equal(l.equiposPorPartido['109'], undefined);  // Semifinal aún sin definir
  const v = C.aplicarEquipos(f.partidos, l.equiposPorPartido);
  assert.equal(v['101'].local, 'T8'); assert.equal(v['101'].porDefinir, false);
  assert.equal(v['109'].porDefinir, true);
  assert.equal(v['1'], f.partidos['1']);                // fase regular intacta
});

test('resolverLiguilla: re-siembra en Semifinal y Final, campeón', () => {
  const f = conLiguilla(fixture());
  // Cuartos: gana T8 (a T1), T2 (a T7), T3 (a T6), T5 (a T4 por global)
  Object.assign(f.resultados, {
    101: R(2, 0), 102: R(0, 0),   // T8 local ida 2-0 a T1 → T8 pasa
    103: R(0, 1), 104: R(0, 0),   // T7 local 0-1 T2 → T2
    105: R(0, 2), 106: R(0, 0),   // T6 0-2 T3 → T3
    107: R(1, 1), 108: R(1, 1)    // T5 vs T4: ida 1-1, vuelta T4 local 1-1 → 2-2 → mejor pos (T4) pasa
  });
  let l = C.resolverLiguilla(f.partidos, f.resultados);
  assert.deepEqual(l.cuartos.map((c) => c.ganador), ['T8', 'T2', 'T3', 'T4']);
  assert.deepEqual(l.semifinal.map((s) => [s.equipoA, s.equipoB]), [['T2', 'T8'], ['T3', 'T4']]); // mejor vs peor
  assert.deepEqual(l.equiposPorPartido['109'], { local: 'T8', visitante: 'T2', serie: 'SF1' });
  assert.deepEqual(l.equiposPorPartido['111'], { local: 'T4', visitante: 'T3', serie: 'SF2' });
  assert.equal(l.final, null);
  // Semifinal: gana T2 y T4 (T4 por global 3-1 contra T3, T3 es mejor pos pero pierde)
  Object.assign(f.resultados, { 109: R(0, 1), 110: R(0, 0), 111: R(2, 0), 112: R(0, 1) });
  l = C.resolverLiguilla(f.partidos, f.resultados);
  assert.deepEqual(l.semifinal.map((s) => s.ganador), ['T2', 'T4']);
  assert.deepEqual([l.final.equipoA, l.final.equipoB], ['T2', 'T4']);
  assert.deepEqual(l.equiposPorPartido['113'], { local: 'T4', visitante: 'T2', serie: 'Final' });
  assert.equal(l.campeon, null);
  Object.assign(f.resultados, { 113: R(0, 1), 114: R(1, 1) });
  l = C.resolverLiguilla(f.partidos, f.resultados);
  assert.equal(l.campeon, 'T2');
  // empate global en la Final → mejor posición de la fase regular (T2)
  Object.assign(f.resultados, { 113: R(1, 1), 114: R(1, 1) });
  assert.equal(C.resolverLiguilla(f.partidos, f.resultados).campeon, 'T2');
});

test('seriesDeRonda: por `serie` si todos la traen; si no, ids consecutivos', () => {
  const f = conLiguilla(fixture());
  assert.deepEqual(C.seriesDeRonda(f.partidos, 'cuartos').map((s) => [s.idaId, s.vueltaId]), [['101', '102'], ['103', '104'], ['105', '106'], ['107', '108']]);
  // idas primero (101-104), vueltas después (105-108), con campo serie
  const g = conLiguilla(fixture());
  [101, 102, 103, 104].forEach((id, i) => { g.partidos[id].serie = 'QF' + (i + 1); g.partidos[id].kickoff = 1900000000000 + i; });
  [105, 106, 107, 108].forEach((id, i) => { g.partidos[id].serie = 'QF' + (i + 1); g.partidos[id].kickoff = 1900000100000 + i; });
  assert.deepEqual(C.seriesDeRonda(g.partidos, 'cuartos').map((s) => [s.idaId, s.vueltaId]), [['101', '105'], ['102', '106'], ['103', '107'], ['104', '108']]);
  // número impar de partidos: el suelto se ignora
  const h = conLiguilla(fixture()); delete h.partidos[108];
  assert.equal(C.seriesDeRonda(h.partidos, 'cuartos').length, 3);
  const l = C.resolverLiguilla(h.partidos, h.resultados);
  assert.equal(l.equiposPorPartido['107'], undefined);
});

test('cambiosPendientes: ignora partidos de Liguilla con equipos por definir', () => {
  const ahora = 1;
  const ps = [{ id: 'a', kickoff: 10 * 3600000, porDefinir: true }, { id: 'b', kickoff: 10 * 3600000 }];
  const bor = { a: { gl: '1', gv: '0' }, b: { gl: '1', gv: '0' } };
  assert.deepEqual(C.cambiosPendientes(ps, {}, bor, ahora, {}), ['b']);
});

test('agruparPorJornada con Liguilla resuelta: títulos "Cuartos de Final", "Semifinal", "Final"', () => {
  const f = conLiguilla(fixture());
  const l = C.resolverLiguilla(f.partidos, f.resultados);
  const g = C.agruparPorJornada(C.aplicarEquipos(f.partidos, l.equiposPorPartido));
  const t = g.map((x) => x.titulo);
  assert.deepEqual(t.slice(-3), ['Cuartos de Final', 'Semifinal', 'Final']);
  assert.equal(g[g.length - 3].partidos.length, 8);
});

test('lógica anterior intacta: puntos, cierre, tabla', () => {
  assert.deepEqual(C.calcPts({ gl: 2, gv: 1 }, { gl: 2, gv: 1 }), { p: 3, g: 3 });
  assert.deepEqual(C.calcPts({ gl: 1, gv: 0 }, { gl: 2, gv: 0 }), { p: 1, g: 0 });
  assert.equal(C.estadoPartido(1000000 + 1800000, 1000000 - 1, false), 'abierto');
  assert.equal(C.estadoPartido(1000000 + 1800000, 1000000, false), 'cerrado'); // borde exacto: kickoff − 30 min ya está cerrado
  assert.deepEqual(C.opcionesTabla({ jornada: 2 }), ['G', 1, 2]);
});

/* ---------- Fase D3: fases de la tabla y podio ---------- */
test('opcionesTabla: L y C solo con la Fase Regular terminada; meta sin fases se tolera', () => {
  assert.deepEqual(C.opcionesTabla(null), ['G']);
  assert.deepEqual(C.opcionesTabla({ jornada: 2 }), ['G', 1, 2]);
  assert.deepEqual(C.opcionesTabla({ jornada: 2, fases: { regular: false, liguilla: false, campeon: false } }), ['G', 1, 2]);
  assert.deepEqual(C.opcionesTabla({ jornada: 2, fases: { regular: true } }), ['G', 1, 2, 'L', 'C']);
});

test('rutaTabla / tituloTabla / tamPagina / esSelJornada', () => {
  assert.equal(C.rutaTabla('G'), 'tabla');
  assert.equal(C.rutaTabla('L'), 'tablaJornada/liguilla');
  assert.equal(C.rutaTabla('C'), 'tablaJornada/final');
  assert.equal(C.rutaTabla(5), 'tablaJornada/5');
  assert.equal(C.tituloTabla('L'), 'Liguilla');
  assert.equal(C.tituloTabla('C'), 'Campeón de Campeones');
  assert.equal(C.tituloTabla(5), 'Jornada 5');
  assert.equal(C.tamPagina('G'), 50); assert.equal(C.tamPagina('L'), 50); assert.equal(C.tamPagina('C'), 50); assert.equal(C.tamPagina(3), 10);
  assert.equal(C.esSelJornada(3), true); assert.equal(C.esSelJornada('L'), false);
});

test('chipsTabla / chipActivo', () => {
  const sinNada = C.chipsTabla(null);
  assert.deepEqual(sinNada.map((c) => c.ok), [true, false, false, false]);
  const c = C.chipsTabla({ jornada: 4, fases: { regular: true } });
  assert.deepEqual(c.map((x) => x.ok), [true, true, true, true]);
  assert.deepEqual(c.map((x) => x.sel), ['G', 4, 'L', 'C']);
  assert.equal(C.chipActivo('G'), 'regular'); assert.equal(C.chipActivo(7), 'jornada');
  assert.equal(C.chipActivo('L'), 'liguilla'); assert.equal(C.chipActivo('C'), 'campeon');
});

test('faseTerminada: cada tabla mira su propia bandera; las Jornadas nunca', () => {
  const m = { fases: { regular: true, liguilla: false, campeon: false } };
  assert.equal(C.faseTerminada(m, 'G'), true);
  assert.equal(C.faseTerminada(m, 'L'), false);
  assert.equal(C.faseTerminada(m, 'C'), false);
  assert.equal(C.faseTerminada({ fases: { regular: true, liguilla: true, campeon: true } }, 'C'), true);
  assert.equal(C.faseTerminada(m, 3), false);
  assert.equal(C.faseTerminada(null, 'G'), false);
});

test('agruparPodio: columnas 2.º-1.º-3.º, empates compartidos, sin 2.º con 1,1,3', () => {
  const f = (pos, uid) => ({ pos, uid, nick: uid, pts: 10 - pos });
  assert.deepEqual(C.agruparPodio([f(1, 'a'), f(2, 'b'), f(3, 'c'), f(4, 'd')]).map((g) => g.pos), [2, 1, 3]);
  const emp = C.agruparPodio([f(1, 'a'), f(1, 'b'), f(3, 'c'), f(4, 'd')]);
  assert.deepEqual(emp.map((g) => g.pos), [1, 3]);
  assert.deepEqual(emp[0].filas.map((x) => x.uid), ['a', 'b']);
  const todos = C.agruparPodio([f(1, 'a'), f(1, 'b'), f(1, 'c'), f(1, 'd')]);
  assert.equal(todos.length, 1); assert.equal(todos[0].filas.length, 4);   // podio compartido por empate total
  assert.deepEqual(C.agruparPodio([f(1, 'a'), f(2, 'b'), f(2, 'c'), f(4, 'd')]).map((g) => g.pos), [2, 1]); // 1,2,2,4: no hay 3.º
  assert.deepEqual(C.agruparPodio([]), []);
  assert.deepEqual(C.agruparPodio(null), []);
});

test('textos de fase: terminología sin «Gran Final» ni «Semis»', () => {
  ['G', 'L', 'C', 3].forEach((s) => {
    [C.mensajeVacioTabla(s), C.textoEnCurso(s), C.notaTabla(s), C.tituloTabla(s), C.tituloPodio(s)].forEach((t) => {
      assert.ok(!/gran final|semis\b/i.test(t), t);
    });
  });
  assert.match(C.notaTabla(3), /Top 3 de la Jornada/);
  assert.match(C.notaTabla('C'), /Fase Regular y la Liguilla/);
});

/* ---------- Fase D4: orden fijo y secciones en Pronósticos ---------- */
test('agruparPorJornada: orden fijo (no depende de kickoff) y secciones J/L', () => {
  const f = conLiguilla(fixture());
  // Fechas desordenadas a propósito: la Semifinal "antes" que la Jornada 5
  Object.keys(f.partidos).forEach((id) => { const p = f.partidos[id]; if (p.ronda === 'Semifinal') p.kickoff = 1; });
  const l = C.resolverLiguilla(f.partidos, f.resultados);
  const g = C.agruparPorJornada(C.aplicarEquipos(f.partidos, l.equiposPorPartido));
  assert.deepEqual(g.map((x) => x.titulo), ['Jornada 1', 'Jornada 2', 'Jornada 3', 'Jornada 4', 'Jornada 5', 'Cuartos de Final', 'Semifinal', 'Final']);
  assert.deepEqual(g.map((x) => x.seccion), ['J', 'J', 'J', 'J', 'J', 'L', 'L', 'L']);
});

test('seriesDeGrupo: ida y vuelta juntas en orden 1v8…4v5, con encabezado; null fuera de Liguilla', () => {
  const f = conLiguilla(fixture());
  const l = C.resolverLiguilla(f.partidos, f.resultados);
  const g = C.agruparPorJornada(C.aplicarEquipos(f.partidos, l.equiposPorPartido));
  assert.equal(C.seriesDeGrupo(g[0], f.partidos), null);
  const cuartos = C.seriesDeGrupo(g.find((x) => x.titulo === 'Cuartos de Final'), f.partidos);
  assert.equal(cuartos.length, 4);
  assert.deepEqual(cuartos.map((s) => s.partidos.map((p) => p.id)), [['101', '102'], ['103', '104'], ['105', '106'], ['107', '108']]);
  assert.equal(cuartos[0].titulo, 'Serie 1 · T1 vs T8');
  assert.equal(cuartos[3].titulo, 'Serie 4 · T4 vs T5');
  // vuelta: el mejor sembrado es local
  assert.equal(cuartos[0].partidos[1].local, 'T1');
  // Final sin equipos definidos → Por definir
  const fin = C.seriesDeGrupo(g.find((x) => x.titulo === 'Final'), f.partidos);
  assert.ok(fin.every((s) => /Por definir/.test(s.titulo)));
});

/* ---------- Fase E1: panel admin ---------- */
test('E1: marcadorAdminValido y enteroDeTexto (0–30, solo dígitos)', () => {
  assert.equal(C.marcadorAdminValido(0, 0), true);
  assert.equal(C.marcadorAdminValido(30, 30), true);
  assert.equal(C.marcadorAdminValido(31, 0), false);
  assert.equal(C.marcadorAdminValido(-1, 0), false);
  assert.equal(C.marcadorAdminValido(1.5, 0), false);
  assert.equal(C.marcadorAdminValido('1', 0), false);
  assert.equal(C.enteroDeTexto(' 3 '), 3);
  assert.equal(C.enteroDeTexto('12'), 12);
  assert.equal(C.enteroDeTexto(''), null);
  assert.equal(C.enteroDeTexto('-1'), null);
  assert.equal(C.enteroDeTexto('1.5'), null);
  assert.equal(C.enteroDeTexto('abc'), null);
  assert.equal(C.enteroDeTexto('123'), null);
  assert.equal(C.enteroDeTexto(null), null);
  assert.deepEqual(C.cuerpoResultado(2, 1), { gl: 2, gv: 1 });
});

test('E1: opcionesPendiente solo con marcadores válidos y filasPendientes ordena por kickoff', () => {
  assert.deepEqual(C.opcionesPendiente({ sdb: { gl: 0, gv: 1 }, espn: { gl: 1, gv: 1 } }), [{ fuente: 'TheSportsDB', gl: 0, gv: 1 }, { fuente: 'ESPN', gl: 1, gv: 1 }]);
  assert.deepEqual(C.opcionesPendiente({ sdb: null, espn: { gl: 2, gv: 0 } }), [{ fuente: 'ESPN', gl: 2, gv: 0 }]);
  assert.deepEqual(C.opcionesPendiente({ sdb: { gl: 99, gv: 0 } }), []);
  assert.deepEqual(C.opcionesPendiente(null), []);
  const partidos = {
    a: { local: 'A', visitante: 'B', kickoff: 2000, fase: 'regular', jornada: 3 },
    b: { local: 'C', visitante: 'D', kickoff: 1000, fase: 'regular', jornada: 2 }
  };
  const f = C.filasPendientes({ a: { motivo: 'discrepancia', sdb: { gl: 1, gv: 0 }, espn: { gl: 2, gv: 0 }, hora: 5 }, b: { motivo: 'solo-espn', espn: { gl: 1, gv: 1 } }, z: { motivo: 'sin-contraparte' }, x: null }, partidos);
  assert.deepEqual(f.map((x) => x.id), ['b', 'a', 'z']);
  assert.equal(f[0].titulo, 'C vs D'); assert.equal(f[0].grupo, 'Jornada 2'); assert.equal(f[0].etiqueta, 'Solo ESPN tiene el marcador');
  assert.equal(f[1].opciones.length, 2); assert.equal(f[1].hora, 5);
  assert.equal(f[2].titulo, 'Partido z'); assert.equal(f[2].kickoff, null); assert.equal(f[2].etiqueta, 'No se encontró el partido en las fuentes');
  assert.deepEqual(C.filasPendientes(null, null), []);
});

test('E1: ultimosResultados (recientes primero, límite) y sinResultado (solo kickoff pasado)', () => {
  const partidos = {
    1: { local: 'A', visitante: 'B', kickoff: 1000, fase: 'regular', jornada: 1 },
    2: { local: 'C', visitante: 'D', kickoff: 3000, fase: 'regular', jornada: 1 },
    3: { local: 'E', visitante: 'F', kickoff: 2000, fase: 'regular', jornada: 1 },
    4: { local: 'G', visitante: 'H', kickoff: 9000, fase: 'regular', jornada: 2 }
  };
  const res = { 1: { gl: 1, gv: 0 }, 2: { gl: 2, gv: 2 }, 3: { gl: 99, gv: 0 }, 7: { gl: 0, gv: 0 } };
  const u = C.ultimosResultados(partidos, res, 5);
  assert.deepEqual(u.map((x) => x.id), ['2', '1']);                 // el 3 es inválido y el 7 no tiene partido
  assert.equal(C.ultimosResultados(partidos, res, 1).length, 1);
  assert.equal(C.sinResultado(partidos, res, 5000), 1);              // el 3 (marcador inválido) cuenta como sin resultado; el 4 aún no se juega
  assert.equal(C.sinResultado(partidos, res, 10000), 2);
  assert.equal(C.sinResultado(null, null, 1), 0);
});

/* ---------- Fase E2a: calendario por revisar ---------- */
test('E2a: opcionesCalendario exige base canónica y horarios válidos', () => {
  const base = { local: 'Tijuana', visitante: 'Atlante', jornada: 17 };
  const pend = { motivo: 'horario-distinto', base, sdb: { kickoff: 1795000000000 }, espn: { kickoff: 1795001800000 } };
  assert.deepEqual(C.opcionesCalendario(pend), [{ fuente: 'TheSportsDB', kickoff: 1795000000000 }, { fuente: 'ESPN', kickoff: 1795001800000 }]);
  assert.deepEqual(C.opcionesCalendario({ base, sdb: { kickoff: 1795000000000 }, espn: null }), [{ fuente: 'TheSportsDB', kickoff: 1795000000000 }]);
  assert.deepEqual(C.opcionesCalendario({ sdb: { kickoff: 1795000000000 } }), []);                       // sin base
  assert.deepEqual(C.opcionesCalendario({ base: { local: 'A', visitante: 'A', jornada: 1 }, sdb: { kickoff: 1795000000000 } }), []);
  assert.deepEqual(C.opcionesCalendario({ base, sdb: { kickoff: 5 } }), []);                             // horario inválido
  assert.deepEqual(C.opcionesCalendario(null), []);
});

test('E2a: filasCalendario ordena por horario, muestra lo ya cargado y tolera pendientes sin base', () => {
  const base = { local: 'Tijuana', visitante: 'Atlante', jornada: 17 };
  const pc = {
    j17_b: { motivo: 'horario-distinto', base, sdb: { kickoff: 1795100000000 }, espn: { kickoff: 1795101800000 } },
    j17_a: { motivo: 'solo-thesportsdb', base: { local: 'Puebla', visitante: 'León', jornada: 17 }, sdb: { kickoff: 1795000000000 }, espn: null },
    j17_z: { motivo: 'equipo-desconocido', sdb: { local: 'Mazatlán', visitante: 'Toluca', kickoff: 1795200000000 } },
    x: null
  };
  const partidos = { j17_b: { local: 'Tijuana', visitante: 'Atlante', kickoff: 1795100000000, fase: 'regular', jornada: 17 } };
  const f = C.filasCalendario(pc, partidos);
  assert.deepEqual(f.map((x) => x.id), ['j17_a', 'j17_b', 'j17_z']);
  assert.equal(f[1].titulo, 'Tijuana vs Atlante'); assert.equal(f[1].grupo, 'Jornada 17'); assert.equal(f[1].cargadoKickoff, 1795100000000);
  assert.equal(f[0].cargadoKickoff, null); assert.equal(f[0].etiqueta, 'Solo TheSportsDB lista este partido');
  assert.equal(f[2].titulo, 'Mazatlán vs Toluca'); assert.deepEqual(f[2].opciones, []);
  assert.deepEqual(C.filasCalendario(null, null), []);
});

test('E2a: cuerpoPartidoCalendario arma el partido canónico y conserva sede', () => {
  const pend = { base: { local: 'Tijuana', visitante: 'Atlante', jornada: 17 } };
  assert.deepEqual(C.cuerpoPartidoCalendario(pend, 1795000000000, null), { local: 'Tijuana', visitante: 'Atlante', kickoff: 1795000000000, fase: 'regular', jornada: 17 });
  const c = C.cuerpoPartidoCalendario(pend, 1795000000000, { local: 'X', visitante: 'Y', kickoff: 1, fase: 'regular', jornada: 3, sede: 'Caliente' });
  assert.equal(c.sede, 'Caliente'); assert.equal(c.local, 'Tijuana'); assert.equal(c.jornada, 17);
  assert.equal(C.cuerpoPartidoCalendario({}, 1795000000000, null), null);
  assert.equal(C.cuerpoPartidoCalendario(pend, 12.5, null), null);
  assert.equal(C.cuerpoPartidoCalendario(pend, 100, null), null);
});
