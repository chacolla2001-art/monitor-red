# 📡 Monitor de red

Herramienta de línea de comandos que vigila la disponibilidad de servicios: **sitios y APIs (HTTP)**, **puertos (TCP)** y **resolución de nombres (DNS)**. Mide la latencia, reintenta antes de dar por caído un servicio, calcula la **disponibilidad (uptime)** a partir del historial y genera reportes en consola, Markdown y una **página HTML de estado**.

*Network and service availability monitor (HTTP, TCP, DNS) with latency, retries, uptime statistics and status reports. Exit code 1 when something is down, so it plugs into cron or CI.*

## Para qué sirve
Un área de TI necesita saber antes que los usuarios cuándo se cae el sistema, la base de datos o el DNS. Esta herramienta se puede programar cada 5 minutos (cron, Programador de tareas de Windows o GitHub Actions) y avisar o publicar una página de estado.

## Funciones
- Verificaciones **HTTP** (código esperado y texto que debe aparecer), **TCP** (puerto abierto) y **DNS** (resolución del nombre).
- **Tiempo límite** y **reintento** configurables; estado **arriba / lento / caído** según un umbral de latencia.
- Verificaciones **en paralelo** con un máximo de simultáneas.
- **Historial** en JSONL y estadísticas de disponibilidad y latencia promedio.
- Reportes: tabla en consola, `--json`, `--md` y `--html` (con el contenido escapado para evitar inyección).
- **Código de salida 1** si algo está caído: sirve para alertas en cron o CI.

## Tecnología
Node.js 24+ con TypeScript, sin dependencias externas (`fetch`, `node:net`, `node:dns`), pruebas con `node:test` contra servidores HTTP y TCP locales reales, y GitHub Actions.

## Cómo usarlo
```bash
node src/cli.ts ejemplo.json
node src/cli.ts ejemplo.json --html estado.html --md estado.md --historial historial.jsonl
npm test     # 12 pruebas
```
Configuración (`ejemplo.json`):
```json
[
  { "nombre": "Sitio web", "tipo": "http", "destino": "https://example.com", "contiene": "Example Domain", "umbralMs": 1500 },
  { "nombre": "Servidor DNS", "tipo": "tcp", "destino": "8.8.8.8", "puerto": 53 },
  { "nombre": "Resolución", "tipo": "dns", "destino": "github.com" }
]
```
Salida:
```
Estado     Nombre                 Tipo  Destino                 Latencia  Detalle
🟢 arriba  Sitio web de ejemplo   http  https://example.com     139 ms    HTTP 200
🟢 arriba  DNS de Google          tcp   8.8.8.8:53              38 ms     puerto 53 abierto
🟢 arriba  Resolucion de nombres  dns   github.com              12 ms     resuelve a 140.82.114.4
4 verificaciones: 4 arriba, 0 lentas, 0 caídas.
```

## Programarlo con GitHub Actions
El archivo `.github/workflows/monitor.yml` (desactivado por defecto: se activa quitando el comentario del `schedule`) corre el monitor cada 30 minutos y guarda la página de estado como artefacto.

## Estructura
```
src/monitor.ts   verificaciones, reintentos, concurrencia y estadísticas
src/reporte.ts   tabla, Markdown y HTML
src/cli.ts       argumentos de línea de comandos
test/            pruebas con servidores locales reales
```

## Mejoras posibles
Avisos por correo o Telegram, verificación de certificados TLS por vencer y un panel con gráficos de latencia.

---
Licencia MIT.
