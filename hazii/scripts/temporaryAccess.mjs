// User-approved Cloudflare preview. No service/autostart is installed.
// temporary:stop closes only the helper and tunnel created by this script.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, writeFile, open, mkdir, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createTemporaryGateway, secretMatches } from '../api/temporaryGateway.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const runtime = resolve(root, 'tmp/temporary-access')
const statePath = resolve(runtime, 'state.json')
const tunnelExecutable = resolve(root, 'tmp/tools/cloudflared-2026.10.0.exe')
const expectedHash = '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c'
const gatewayPort = 4180
const controlPort = 4181
const mode = process.argv[2] || 'start'
const readState = () => readFile(statePath, 'utf8').then(JSON.parse).catch(() => null)

// A provisioned URL is not proof that requests reach our server. Check the
// anonymous gate only; never send the access code in a diagnostic request.
async function checkPublicAccess(url) {
  if (!url) return 'Адрес ещё не создан.'
  try {
    const response = await fetch(`${url}/_sino/access`, { redirect: 'error', signal: AbortSignal.timeout(8000) })
    const body = await response.text()
    return response.ok && body.includes('<title>Sino — временный доступ</title>')
      ? 'Форма доступа отвечает через интернет. Для полной проверки запустите checkTemporaryAccess.mjs.'
      : `Доступ через интернет НЕ подтверждён (HTTP ${response.status}).`
  } catch { return 'Доступ через интернет НЕ подтверждён: соединение недоступно.' }
}

async function controlRequest(action, state) {
  return fetch(`http://127.0.0.1:${controlPort}/${action}`, { method: 'POST', headers: { authorization: `Bearer ${state.controlSecret}` }, signal: AbortSignal.timeout(2000) })
}

async function runSupervisor() {
  const state = { pid: process.pid, status: 'starting', url: null, accessCode: randomBytes(18).toString('base64url'), controlSecret: randomBytes(32).toString('hex'), startedAt: new Date().toISOString() }
  let gateway
  let control
  let tunnel
  let stopping = false
  let ownsState = false
  let publicOrigin = null
  const saveState = () => writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 })
  async function shutdown() {
    if (stopping) return
    stopping = true
    tunnel?.kill()
    gateway?.close()
    control?.close()
    state.status = 'stopped'; state.accessCode = null; state.controlSecret = null
    if (ownsState) await saveState()
    setTimeout(() => process.exit(0), 300).unref()
  }
  try {
    const api = await fetch('http://127.0.0.1:3001/health', { signal: AbortSignal.timeout(4000) })
    if (!api.ok) throw new Error('Local API/PostgreSQL is not ready')
    await access(resolve(root, 'dist/index.html'))
    const actualHash = createHash('sha256').update(await readFile(tunnelExecutable)).digest('hex')
    if (actualHash !== expectedHash) throw new Error('Cloudflare executable SHA-256 mismatch')
    control = createServer((request, response) => {
      if (request.method !== 'POST' || !secretMatches(request.headers.authorization || '', `Bearer ${state.controlSecret}`)) { response.writeHead(403).end(); return }
      if (request.url === '/status') { response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: state.status })); return }
      if (request.url === '/stop') { response.writeHead(200).end('Stopping'); void shutdown(); return }
      response.writeHead(404).end()
    })
    await new Promise((resolve, reject) => { control.once('error', reject); control.listen(controlPort, '127.0.0.1', resolve) })
    ownsState = true
    const app = createTemporaryGateway({ distDirectory: resolve(root, 'dist'), accessCode: state.accessCode, getPublicOrigin: () => publicOrigin })
    gateway = await new Promise((resolve, reject) => { const server = app.listen(gatewayPort, '127.0.0.1', () => resolve(server)); server.once('error', reject) })
    await saveState()
    // Optional diagnostics stay within Cloudflare and never alter Windows
    // networking. Neither protocol nor region guarantees external reachability.
    const protocol = process.env.SINO_TUNNEL_PROTOCOL || 'auto'
    const region = process.env.SINO_TUNNEL_REGION || ''
    if (!['auto', 'quic', 'http2'].includes(protocol) || !['', 'us'].includes(region)) throw new Error('Unsupported Cloudflare protocol/region')
    const tunnelArguments = ['tunnel', '--protocol', protocol, '--edge-ip-version', '4', ...(region ? ['--region', region] : []), '--url', `http://127.0.0.1:${gatewayPort}`]
    tunnel = spawn(tunnelExecutable, tunnelArguments, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    state.tunnelPid = tunnel.pid
    let logBuffer = ''
    let saveQueue = Promise.resolve()
    function receiveLog(data) {
      const text = String(data)
      process.stdout.write(text)
      logBuffer = (logBuffer + text).slice(-12000)
      const url = logBuffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/u)?.[0]
      if (url && !state.url) {
        publicOrigin = url; state.url = url; state.status = 'url-created'
        saveQueue = saveQueue.then(saveState)
      }
    }
    tunnel.stdout.on('data', receiveLog)
    tunnel.stderr.on('data', receiveLog)
    tunnel.once('error', (error) => { console.error(error.message); void shutdown() })
    tunnel.once('exit', () => { if (!stopping) void shutdown() })
    process.on('SIGINT', () => void shutdown())
    process.on('SIGTERM', () => void shutdown())
  } catch (error) {
    console.error(error.message)
    await shutdown()
  }
}

async function start() {
  const previous = await readState()
  if (previous?.controlSecret) {
    const running = await controlRequest('status', previous).catch(() => null)
    if (running?.ok) { console.log(`Туннель уже запущен: ${previous.url || 'адрес создаётся'}\n${await checkPublicAccess(previous.url)}`); return }
  }
  const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: root, windowsHide: true, stdio: 'inherit' })
  if (build.status !== 0) throw new Error('Сборка сайта не завершилась успешно.')
  await mkdir(runtime, { recursive: true })
  await access(tunnelExecutable)
  const log = await open(resolve(runtime, 'tunnel.log'), 'a', 0o600)
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] })
  child.unref()
  await log.close()
  for (let attempt = 0; attempt < 90; attempt++) {
    await delay(500)
    const state = await readState()
    if (state?.pid !== child.pid) continue
    if (state.status === 'stopped') throw new Error('Ссылка не запустилась. Подробности: tmp/temporary-access/tunnel.log')
    if (state.url) { console.log(`Создан адрес: ${state.url}\n${await checkPublicAccess(state.url)}\nКод доступа хранится только локально: tmp/temporary-access/state.json\nОстановить: npm run temporary:stop`); return }
  }
  console.log('Сервис ещё запускается. Проверьте npm run temporary:status и tmp/temporary-access/tunnel.log')
}

if (mode === 'serve') await runSupervisor()
else if (mode === 'start') await start()
else if (mode === 'status' || mode === 'stop') {
  const state = await readState()
  if (!state?.controlSecret) console.log('Временная ссылка не запущена.')
  else {
    const response = await controlRequest(mode === 'stop' ? 'stop' : 'status', state).catch(() => null)
    if (!response?.ok) console.log('Временный сервер не отвечает.')
    else console.log(mode === 'stop' ? 'Временный доступ остановлен. Локальный сайт, API и Docker не изменены.' : `Создан адрес: ${state.url || 'создаётся'}\n${await checkPublicAccess(state.url)}`)
  }
} else throw new Error('Use start, status, or stop')
