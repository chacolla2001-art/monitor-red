// Pruebas con servidores locales reales (HTTP y TCP) creados en puertos libres.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { createServer as createTcp, type Server as TcpServer, type AddressInfo } from 'node:net'
import { estadisticas, validarConfig, verificar, verificarTodas, type Resultado } from '../src/monitor.ts'
import { html, markdown, tabla } from '../src/reporte.ts'

let http: Server
let tcp: TcpServer
let base = ''
let puertoTcp = 0
let puertoCerrado = 0

before(async () => {
  http = createServer((req, res) => {
    if (req.url === '/lento') return setTimeout(() => res.end('ok'), 150)
    if (req.url === '/error') return res.writeHead(503).end('caído')
    res.end('<h1>Sistema en línea</h1>')
  }).listen(0)
  tcp = createTcp((s) => s.end()).listen(0)
  await Promise.all([new Promise((r) => http.once('listening', r)), new Promise((r) => tcp.once('listening', r))])
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
  puertoTcp = (tcp.address() as AddressInfo).port
  // Un puerto que estuvo abierto y se cerró: la conexión será rechazada.
  const tmp = createTcp().listen(0)
  await new Promise((r) => tmp.once('listening', r))
  puertoCerrado = (tmp.address() as AddressInfo).port
  await new Promise((r) => tmp.close(r))
})
after(() => {
  http.close()
  tcp.close()
})

test('http arriba con el texto esperado', async () => {
  const r = await verificar({ nombre: 'web', tipo: 'http', destino: `${base}/`, contiene: 'en línea' })
  assert.equal(r.estado, 'arriba')
  assert.match(r.detalle, /HTTP 200/)
  assert.ok(r.latenciaMs! >= 0)
})

test('http con código de error se marca caído tras reintentar', async () => {
  const r = await verificar({ nombre: 'api', tipo: 'http', destino: `${base}/error` }, 1)
  assert.equal(r.estado, 'caido')
  assert.equal(r.detalle, 'HTTP 503')
  assert.equal(r.intentos, 2)
})

test('http acepta códigos personalizados', async () => {
  const r = await verificar({ nombre: 'mant', tipo: 'http', destino: `${base}/error`, codigos: [503] })
  assert.equal(r.estado, 'arriba')
})

test('http falla si falta el texto esperado', async () => {
  const r = await verificar({ nombre: 'web', tipo: 'http', destino: `${base}/`, contiene: 'texto que no está' }, 0)
  assert.equal(r.estado, 'caido')
  assert.match(r.detalle, /no aparece/)
})

test('respuesta lenta se marca como degradada según el umbral', async () => {
  const r = await verificar({ nombre: 'lenta', tipo: 'http', destino: `${base}/lento`, umbralMs: 50 })
  assert.equal(r.estado, 'lento')
})

test('tiempo de espera agotado', async () => {
  const r = await verificar({ nombre: 'lenta', tipo: 'http', destino: `${base}/lento`, timeoutMs: 30 }, 0)
  assert.equal(r.estado, 'caido')
  assert.equal(r.detalle, 'tiempo de espera agotado')
})

test('tcp: puerto abierto y puerto cerrado', async () => {
  assert.equal((await verificar({ nombre: 'db', tipo: 'tcp', destino: '127.0.0.1', puerto: puertoTcp })).estado, 'arriba')
  const cerrado = await verificar({ nombre: 'db', tipo: 'tcp', destino: '127.0.0.1', puerto: puertoCerrado }, 0)
  assert.equal(cerrado.estado, 'caido')
  assert.equal(cerrado.detalle, 'ECONNREFUSED')
})

test('dns: resuelve localhost y falla con un dominio inexistente', async () => {
  assert.equal((await verificar({ nombre: 'dns', tipo: 'dns', destino: 'localhost' })).estado, 'arriba')
  const r = await verificar({ nombre: 'dns', tipo: 'dns', destino: 'no-existe.invalid' }, 0)
  assert.equal(r.estado, 'caido')
})

test('valida la configuración con mensajes claros', () => {
  assert.throws(() => validarConfig([]), /al menos una/)
  assert.throws(() => validarConfig([{ nombre: 'x', tipo: 'ftp', destino: 'a' }]), /http, tcp o dns/)
  assert.throws(() => validarConfig([{ nombre: 'x', tipo: 'tcp', destino: 'a' }]), /puerto/)
  assert.throws(() => validarConfig([{ nombre: 'x', tipo: 'http', destino: 'ejemplo.com' }]), /http:\/\//)
  assert.equal(validarConfig([{ nombre: 'x', tipo: 'dns', destino: 'localhost' }]).length, 1)
})

test('corre varias en paralelo y conserva el orden', async () => {
  const rs = await verificarTodas(
    [
      { nombre: 'a', tipo: 'http', destino: `${base}/lento` },
      { nombre: 'b', tipo: 'tcp', destino: '127.0.0.1', puerto: puertoTcp },
      { nombre: 'c', tipo: 'dns', destino: 'localhost' },
    ],
    3,
  )
  assert.deepEqual(rs.map((r) => r.nombre), ['a', 'b', 'c'])
})

test('estadísticas de disponibilidad a partir del historial', () => {
  const r = (estado: Resultado['estado'], latenciaMs: number | null): Resultado => ({ nombre: 'web', tipo: 'http', destino: 'x', estado, latenciaMs, detalle: '', intentos: 1, fecha: '' })
  const [s] = estadisticas([[r('arriba', 100)], [r('caido', null)], [r('lento', 300)], [r('arriba', 200)]])
  assert.equal(s.disponibilidad, 75)
  assert.equal(s.latenciaPromedioMs, 200)
})

test('genera reportes de consola, Markdown y HTML (escapando el contenido)', () => {
  const rs: Resultado[] = [{ nombre: '<script>', tipo: 'http', destino: 'https://x', estado: 'caido', latenciaMs: null, detalle: 'HTTP 500', intentos: 2, fecha: '' }]
  assert.match(tabla(rs), /caido/)
  assert.match(markdown(rs), /\| 🔴 \|/)
  const pagina = html(rs)
  assert.ok(!pagina.includes('<script>'))
  assert.ok(pagina.includes('&lt;script&gt;'))
})
