'use strict';
// Sondeo de solo lectura: ¿qué tan adelante listan partidos ESPN y TheSportsDB? Sin secrets ni escritura.
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/mex.1/scoreboard';
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const DESDE = process.env.DESDE || '20261114', HASTA = process.env.HASTA || '20270430';
const TEMP = process.env.TEMP_SDB || '2026-2027';
async function get(url) {
  try { const r = await fetch(url, { headers: { 'User-Agent': 'quiniela-clausura-prueba/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* no JSON */ } return { http: r.status, j }; } catch (e) { return { http: 0, j: null }; }
}
const sumaDias = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) + n)).toISOString().slice(0, 10).replace(/-/g, '');
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
(async () => {
  console.log('== ESPN día por día ' + DESDE + ' a ' + HASTA);
  const porMes = {}; let fallas = 0, ultimo = null;
  for (let d = DESDE; d <= HASTA; d = sumaDias(d, 1)) {
    const r = await get(ESPN + '?dates=' + d);
    if (r.http !== 200) { fallas++; console.log('  ' + d + ' -> HTTP ' + r.http); continue; }
    const ev = (r.j && r.j.events) || [];
    if (ev.length) {
      ultimo = d; porMes[d.slice(0, 6)] = (porMes[d.slice(0, 6)] || 0) + ev.length;
      console.log('  ' + d + ': ' + ev.length + ' | ' + ev.slice(0, 3).map((v) => { const c = v.competitions[0].competitors; const l = c.find((x) => x.homeAway === 'home'), a = c.find((x) => x.homeAway === 'away'); return l.team.displayName + '-' + a.team.displayName + ' ' + v.date; }).join(' ; '));
    }
    await espera(200);
  }
  console.log('ESPN resumen -> eventos por mes: ' + JSON.stringify(porMes) + ' | último día con eventos: ' + ultimo + ' | fallas HTTP: ' + fallas);

  console.log('== TheSportsDB próximos eventos de la liga (id 4350)');
  const n = await get(TSDB + '/eventsnextleague.php?id=4350');
  const ne = (n.j && n.j.events) || [];
  console.log('  HTTP ' + n.http + ' | eventos: ' + ne.length);
  ne.forEach((e) => console.log('  r' + e.intRound + ' ' + e.strTimestamp + ' ' + e.strHomeTeam + ' vs ' + e.strAwayTeam + ' [' + e.strSeason + ']'));
  console.log('== TheSportsDB rondas 31 a 45 (temporada ' + TEMP + ')');
  for (let r = 31; r <= 45; r++) {
    const x = await get(TSDB + '/eventsround.php?id=4350&r=' + r + '&s=' + TEMP);
    const ev = (x.j && x.j.events) || [];
    if (ev.length) console.log('  ronda ' + r + ': ' + ev.length + ' | ' + ev[0].strTimestamp + ' ' + ev[0].strHomeTeam + ' vs ' + ev[0].strAwayTeam);
    await espera(2200);
  }
  console.log('== TheSportsDB temporadas candidatas, ronda 1');
  for (const s of ['2027', '2026-2027', '2027-2028']) {
    const x = await get(TSDB + '/eventsround.php?id=4350&r=1&s=' + s);
    const ev = (x.j && x.j.events) || [];
    console.log('  s=' + s + ' -> HTTP ' + x.http + ' | eventos: ' + ev.length + (ev[0] ? ' | ' + ev[0].strTimestamp + ' ' + ev[0].strHomeTeam + ' vs ' + ev[0].strAwayTeam + ' [' + ev[0].strSeason + ']' : ''));
    await espera(2200);
  }
})().catch((x) => { console.error('Error:', x.message); process.exit(1); });
