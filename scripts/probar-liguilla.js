'use strict';
// Sondeo de solo lectura: cómo numera/nombra TheSportsDB las rondas posteriores a la fase regular. Sin secrets ni escritura.
const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
const DESDE = Number(process.env.DESDE || 17), HASTA = Number(process.env.HASTA || 30);
const TEMP = process.env.TEMP_SDB || '2026-2027';
async function get(url) {
  try { const r = await fetch(url, { headers: { 'User-Agent': 'quiniela-clausura-prueba/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* no JSON */ } return { http: r.status, j }; } catch (e) { return { http: 0, j: null }; }
}
(async () => {
  let campos = false;
  for (let r = DESDE; r <= HASTA; r++) {
    const x = await get(TSDB + '/eventsround.php?id=4350&r=' + r + '&s=' + TEMP);
    const ev = (x.j && x.j.events) || [];
    console.log('Ronda ' + r + ' -> HTTP ' + x.http + ' | eventos: ' + ev.length);
    if (!ev.length) continue;
    if (!campos) { console.log('  Campos del evento: ' + Object.keys(ev[0]).join(', ')); campos = true; }
    const fechas = ev.map((e) => e.dateEvent).sort();
    console.log('  Fechas: ' + fechas[0] + ' a ' + fechas[fechas.length - 1] + ' | strRound/strStage distintos: ' + [...new Set(ev.map((e) => (e.strRound || '') + '/' + (e.strStage || '')))].join(', '));
    for (const e of ev.slice(0, 4)) console.log('  ' + e.dateEvent + ' ' + e.strHomeTeam + ' ' + e.intHomeScore + '-' + e.intAwayScore + ' ' + e.strAwayTeam + ' [' + (e.strStatus || '') + ']');
    await new Promise((ok) => setTimeout(ok, 2500));
  }
})().catch((e) => { console.error('Error:', e.message); process.exit(1); });
