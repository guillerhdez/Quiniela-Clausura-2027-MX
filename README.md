# Quiniela Clausura 2027 MX — scripts de servidor

Scripts que corren en GitHub Actions para la Quiniela Clausura 2027 (Liga MX). El cliente web vive en Netlify; este repo **no contiene claves ni datos de usuarios**.

## Calcular tabla
`scripts/calcular-tabla.js` lee resultados confirmados y pronósticos, y publica `tabla`, `tablaJornada/{j}` y `tablaMeta` en Firebase Realtime Database.

- Desempate (tabla general y de cada Jornada): puntos → referidos válidos → goles atinados.
- Referido válido: el invitado ya guardó al menos un pronóstico.
- Una Jornada se publica solo cuando todos sus partidos tienen resultado.
- Primero compara una huella de los resultados con `tablaMeta`; si no cambió, termina sin leer los pronósticos.

Local: `npm ci && npm test`. Ejecución: workflow **Calcular tabla** (`workflow_dispatch`, con opciones `dry` y `forzar`). Requiere el secret `FIREBASE_SERVICE_ACCOUNT` del repositorio.

Los logs de Actions son públicos: el script solo imprime conteos.

Proyecto independiente, sin afiliación con la Liga MX ni con los clubes.
