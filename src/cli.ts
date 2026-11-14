#!/usr/bin/env node
// Línea de comandos: monitor-red <config.json> [--json] [--md archivo] [--html archivo] [--historial archivo] [--reintentos n]
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { estadisticas, validarConfig, verificarTodas, type Resultado } from './monitor.ts'
import { html, markdown, resumen, tabla } from './reporte.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    md: { type: 'string' },
    html: { type: 'string' },
    historial: { type: 'string' },
    reintentos: { type: 'string', default: '1' },
    ayuda: { type: 'boolean', short: 'h', default: false },
  },
})

if (values.ayuda || positionals.length === 0) {
  console.log(`Uso: monitor-red <config.json> [opciones]
  --json               imprime los resultados en JSON
  --md <archivo>       escribe un reporte Markdown
  --html <archivo>     escribe una página HTML de estado
  --historial <archivo> agrega esta corrida al historial (JSONL) y calcula disponibilidad
  --reintentos <n>     reintentos antes de marcar caído (por defecto 1)
Sale con código 1 si algún servicio está caído (útil en cron o CI).`)
  process.exit(positionals.length === 0 && !values.ayuda ? 2 : 0)
}

let lista
try {
  lista = validarConfig(JSON.parse(readFileSync(positionals[0], 'utf8')))
} catch (e) {
  console.error(`Configuración inválida: ${(e as Error).message}`)
  process.exit(2)
}

const resultados = await verificarTodas(lista, 8, Number(values.reintentos) || 0)

let stats: ReturnType<typeof estadisticas> = []
if (values.historial) {
  appendFileSync(values.historial, JSON.stringify(resultados) + '\n')
  const corridas = readFileSync(values.historial, 'utf8')
    .split('\n')
    .filter(Boolean)
    .slice(-500)
    .map((l) => JSON.parse(l) as Resultado[])
  stats = estadisticas(corridas)
}
if (values.md) writeFileSync(values.md, markdown(resultados, stats))
if (values.html) writeFileSync(values.html, html(resultados, stats))

if (values.json) console.log(JSON.stringify({ resultados, estadisticas: stats }, null, 2))
else {
  console.log(tabla(resultados))
  console.log(`\n${resumen(resultados)}`)
  if (values.historial && existsSync(values.historial)) {
    for (const s of stats) console.log(`  ${s.nombre}: ${s.disponibilidad}% disponible en ${s.muestras} revisiones`)
  }
}
process.exit(resultados.some((r) => r.estado === 'caido') ? 1 : 0)
