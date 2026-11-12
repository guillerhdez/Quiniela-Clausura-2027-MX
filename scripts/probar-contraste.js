'use strict';
// Contraste ESPN vs TheSportsDB para rondas completas de Liga MX. SOLO LEE; sin secrets ni escritura.
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const RONDAS = (process.env.RONDAS || '15,16').split(',').map((x) => x.trim()).filter(Boolean);
const TEMP = process.env.TEMP_SDB || '2026-2027';

async function get(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'quiniela-clausura-prueba/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* no JSON */ }
    return { http: r.status, j };
  } catch (e) { return { http: 0, j: null }; }
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
const STOP = new Set(['cd', 'fc', 'club', 'de', 'del', 'la', 'el', 'cf', 'ac']);
const tokens = (s) => norm(s).split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
// Mismo equipo si comparten al menos un token distintivo
const mismo = (a, b) => { const tb = new Set(tokens(b)); return tokens(a).some((t) => tb.has(t)); };
const dia = (iso) => iso.slice(0, 10).replace(/-/g, '');
const sumaDias = (yyyymmdd, n) => { const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8) + n)); return d.toISOString().slice(0, 10).replace(/-/g, ''); };

async function espnEventos(desde, hasta) {
  const out = [];
  for (let d = desde; d <= hasta; d = sumaDias(d, 1)) {
    const r = await get(ESPN + '?dates=' + d);
    if (r.http !== 200) { console.log('  ESPN', d, '-> HTTP', r.http); continue; }
    for (const v of (r.j.events || [])) {
      const c = (v.competitions && v.competitions[0] && v.competitions[0].competitors) || [];
      const l = c.find((x) => x.homeAway === 'home'), a = c.find((x) => x.homeAway === 'away');
      if (!l || !a) continue;
      out.push({ fecha: v.date, local: l.team.displayName, visita: a.team.displayName, gl: l.score, gv: a.score, terminado: !!(v.status && v.status.type && v.status.type.completed) });
    }
  }
  return out;
}

(async () => {
  let ok = 0, dif = 0, sin = 0; const sinEmparejar = new Set();
  for (const r of RONDAS) {
    const t = await get(TSDB + '/eventsround.php?id=4350&r=' + r + '&s=' + TEMP);
    const evs = (t.j && t.j.events) || [];
    console.log('Ronda', r, '-> TheSportsDB HTTP', t.http, '| partidos:', evs.length);
    if (!evs.length) continue;
    const fechas = evs.map((e) => e.dateEvent.replace(/-/g, '')).sort();
    const espn = await espnEventos(sumaDias(fechas[0], -1), sumaDias(fechas[fechas.length - 1], 1));
    console.log('  ESPN eventos en la ventana:', espn.length);
    for (const e of evs) {
      const m = espn.find((x) => mismo(x.local, e.strHomeTeam) && mismo(x.visita, e.strAwayTeam));
      const sdb = e.intHomeScore + '-' + e.intAwayScore;
      if (!m) { sin++; sinEmparejar.add(e.strHomeTeam); sinEmparejar.add(e.strAwayTeam); console.log('  SIN CONTRAPARTE', e.dateEvent, e.strHomeTeam, sdb, e.strAwayTeam); continue; }
      const es = m.gl + '-' + m.gv;
      if (es === sdb && m.terminado) { ok++; console.log('  OK          ', e.dateEvent, e.strHomeTeam, sdb, e.strAwayTeam, '| ESPN:', m.local, '/', m.visita); }
      else { dif++; console.log('  DISCREPANCIA', e.dateEvent, e.strHomeTeam, 'SDB', sdb, '| ESPN', es, 'terminado:', m.terminado); }
    }
  }
  console.log('Resumen -> coinciden:', ok, '| discrepancias:', dif, '| sin contraparte en ESPN:', sin);
  if (sinEmparejar.size) console.log('Nombres de TheSportsDB sin emparejar:', [...sinEmparejar].join(', '));
})().catch((x) => { console.error('Error:', x.message); process.exit(1); });
