'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { clasificarRespuesta, censurar, REFERER_SITIO } = require('../lib/sondeo-reset');

const KEY = 'AIzaSyFAKEKEY1234567890';
const MAIL = 'cuenta+prueba@example.com';

test('200 sin error = enviado', () => {
  const v = clasificarRespuesta(200, { email: MAIL }, [KEY, MAIL]);
  assert.equal(v.resultado, 'enviado');
  assert.ok(!JSON.stringify(v).includes(MAIL));
});

test('403 por referer (razón estructurada) = bloqueado-referer', () => {
  const v = clasificarRespuesta(403, { error: { code: 403, message: 'Requests from referer <empty> are blocked.', status: 'PERMISSION_DENIED', details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } }, [KEY]);
  assert.equal(v.resultado, 'bloqueado-referer');
  assert.equal(v.razon, 'API_KEY_HTTP_REFERRER_BLOCKED');
});

test('403 por referer (solo texto) = bloqueado-referer', () => {
  const v = clasificarRespuesta(403, { error: { message: 'Requests from referer https://x/ are blocked.' } }, []);
  assert.equal(v.resultado, 'bloqueado-referer');
});

test('API no permitida o key inválida = bloqueado-api', () => {
  assert.equal(clasificarRespuesta(403, { error: { message: 'x', details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }] } }, []).resultado, 'bloqueado-api');
  assert.equal(clasificarRespuesta(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }, []).resultado, 'bloqueado-api');
});

test('límite de intentos', () => {
  assert.equal(clasificarRespuesta(400, { error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER' } }, []).resultado, 'limite');
  assert.equal(clasificarRespuesta(429, null, []).resultado, 'limite');
});

test('otro rechazo y respuesta sin cuerpo', () => {
  assert.equal(clasificarRespuesta(400, { error: { message: 'EMAIL_NOT_FOUND' } }, []).resultado, 'rechazado');
  assert.equal(clasificarRespuesta(500, null, []).resultado, 'rechazado');
  assert.equal(clasificarRespuesta(200, null, []).resultado, 'inesperado');
});

test('censurar quita key y correo del texto de Google', () => {
  const t = censurar('fallo con ' + KEY + ' y ' + MAIL, [KEY, MAIL]);
  assert.ok(!t.includes(KEY) && !t.includes(MAIL));
  assert.equal(censurar(null, [KEY]), '');
  assert.equal(censurar('ab', ['ab']), 'ab'); // secretos muy cortos se ignoran
});

test('el mensaje del veredicto nunca trae la key ni el correo', () => {
  const v = clasificarRespuesta(400, { error: { message: 'bad ' + KEY + ' ' + MAIL } }, [KEY, MAIL]);
  assert.ok(!JSON.stringify(v).includes(KEY) && !JSON.stringify(v).includes(MAIL));
});

test('fetch de Node envía el encabezado Referer (servidor local)', async () => {
  const visto = [];
  const srv = http.createServer((q, r) => { visto.push(q.headers.referer || null); r.end('{}'); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + srv.address().port + '/';
  await fetch(url, { headers: { Referer: REFERER_SITIO } });
  await fetch(url);
  srv.close();
  assert.deepEqual(visto, [REFERER_SITIO, null]);
});
