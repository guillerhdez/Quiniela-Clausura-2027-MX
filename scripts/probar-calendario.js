'use strict';
// Sondeo de solo lectura: ¿coinciden TheSportsDB y ESPN en equipos y horario de partidos FUTUROS? Sin secrets ni escritura.
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const RONDAS = (process.env.RONDAS || '17').split(',').map((x) => x.trim()).filter(Boolean);
const TEMP = process.env.TEMP_SDB || '2026-2027';
async function get(url) {
  try { const r = await fetch(url, { headers: { 'User-Agent': 'quiniela-clausura-prueba/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* no JSON */ } return { http: r.status, j }; } catch (e) { return { http: 0, j: null }; }
}
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
const STOP = new Set(['cd', 'fc', 'club', 'de', 'del', 'la', 'el', 'cf', 'ac']);
const tokens = (s) => norm(s).split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
const mismo = (a, b) => { const tb = new Set(tokens(b)); return tokens(a).some((t) => tb.has(t)); };
const sumaDias = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + n)).toISOString().slice(0, 10).replace(/-/g, '');
const cdmx = (ms) => new Date(ms - 6 * 3600000).toISOString().replace('T', ' ').slice(0, 16);
async function espnEventos(desde, hasta) {
  const out = [];
  for (let d = desde; d <= hasta; d = sumaDias(d, 1)) {
    const r = await get(ESPN + '?dates=' + d);
    console.log('  ESPN ' + d + ' -> HTTP ' + r.http + ' | eventos: ' + ((r.j && r.j.events) || []).length);
    for (const v of ((r.j && r.j.events) || [])) {
      const c = (v.competitions && v.competitions[0] && v.competitions[0].competitors) || [];
      const l = c.find((x) => x.homeAway === 'home'), a = c.find((x) => x.homeAway === 'away');
      if (l && a) out.push({ ms: Date.parse(v.date), raw: v.date, local: l.team.displayName, visita: a.team.displayName, estado: v.status && v.status.type && v.status.type.name });
    }
  }
  return out;
}
(async () => {
  let ok = 0, dif = 0, sin = 0;
  for (const r of RONDAS) {
    const t = await get(TSDB + '/eventsround.php?id=4350&r=' + r + '&s=' + TEMP);
    const evs = (t.j && t.j.events) || [];
    console.log('Ronda ' + r + ' -> TheSportsDB HTTP ' + t.http + ' | partidos: ' + evs.length);
    if (!evs.length) continue;
    const fechas = evs.map((e) => e.dateEvent.replace(/-/g, '')).sort();
    const espn = await espnEventos(sumaDias(fechas[0], -1), sumaDias(fechas[fechas.length - 1], 1));
    for (const e of evs) {
      const ms = Date.parse(e.strTimestamp + (/[zZ]|[+-]\d\d:?\d\d$/.test(e.strTimestamp || '') ? '' : 'Z'));
      const m = espn.find((x) => mismo(x.local, e.strHomeTeam) && mismo(x.visita, e.strAwayTeam));
      const base = e.strHomeTeam + ' vs ' + e.strAwayTeam + ' | SDB ts=' + e.strTimestamp + ' (' + cdmx(ms) + ' CDMX) local=' + e.dateEventLocal + ' ' + e.strTimeLocal + ' estado=' + e.strStatus + ' pospuesto=' + e.strPostponed;
      if (!m) { sin++; console.log('  SIN CONTRAPARTE ' + base); continue; }
      const dmin = Math.round((m.ms - ms) / 60000);
      if (Math.abs(dmin) <= 5) ok++; else dif++;
      console.log('  ' + (Math.abs(dmin) <= 5 ? 'OK         ' : 'DIF HORARIO') + ' ' + base + ' | ESPN ' + m.raw + ' (' + cdmx(m.ms) + ' CDMX) dif=' + dmin + ' min estado=' + m.estado);
    }
  }
  console.log('Resumen -> mismo horario (±5 min): ' + ok + ' | horario distinto: ' + dif + ' | sin contraparte en ESPN: ' + sin);
})().catch((x) => { console.error('Error:', x.message); process.exit(1); });
