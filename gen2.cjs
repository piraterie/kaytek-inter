// gen2.cjs — génère chaque icône avec une session playwright-cli fraîche
const http = require('http')
const { execSync } = require('child_process')

function makeHtml(logo, canvas) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;}html,body{width:${canvas}px;height:${canvas}px;overflow:hidden;background:#fff;display:flex;align-items:center;justify-content:center;}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" width="${logo}" height="${logo}" viewBox="0 0 100 100" fill="none"><defs><clipPath id="fl"><rect x="0" y="0" width="52" height="100"/></clipPath></defs><polygon points="72,12 93,50 72,88 28,88 7,50 28,12" fill="none" stroke="#1A2F5C" stroke-width="9" stroke-linejoin="round"/><polygon points="72,12 93,50 72,88 28,88 7,50 28,12" fill="none" stroke="#3B82F6" stroke-width="9" stroke-linejoin="round" clip-path="url(#fl)"/><line x1="35" y1="22" x2="35" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/><line x1="35" y1="22" x2="54" y2="22" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/><line x1="35" y1="78" x2="54" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/><line x1="40" y1="50" x2="67" y2="22" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/><line x1="40" y1="50" x2="67" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/></svg></body></html>`
}

const icons = [
  { id: 'a', logo: 172, canvas: 192, out: 'public/icons/icon-192.png' },
  { id: 'b', logo: 460, canvas: 512, out: 'public/icons/icon-512.png' },
  { id: 'c', logo: 156, canvas: 180, out: 'public/apple-touch-icon.png' },
  { id: 'd', logo: 184, canvas: 192, out: 'public/icons/icon-192-maskable.png' },
  { id: 'e', logo: 492, canvas: 512, out: 'public/icons/icon-512-maskable.png' },
]

const pages = {}
for (const ic of icons) pages[`/${ic.id}`] = makeHtml(ic.logo, ic.canvas)

const server = http.createServer((q, r) => {
  const h = pages[q.url]
  if (!h) { r.writeHead(404); r.end(); return }
  r.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); r.end(h)
})

server.listen(8765, () => {
  console.log('Server :8765 ready')

  for (const { id, canvas, out } of icons) {
    const sname = `icg${id}`
    const url = `http://localhost:8765/${id}`
    console.log(`→ ${out}`)
    try {
      execSync(`npx playwright-cli -s=${sname} open "${url}"`, { stdio: 'pipe', timeout: 15000 })
      execSync(`npx playwright-cli -s=${sname} resize ${canvas} ${canvas}`, { stdio: 'pipe', timeout: 10000 })
      execSync(`npx playwright-cli -s=${sname} screenshot --filename="${out}"`, { stdio: 'pipe', timeout: 15000 })
      try { execSync(`npx playwright-cli -s=${sname} close`, { stdio: 'pipe', timeout: 5000 }) } catch {}
      console.log(`  ✓ ${out}`)
    } catch (e) {
      console.error(`  ✗ ${out}: ${e.message.split('\n')[0]}`)
      try { execSync(`npx playwright-cli -s=${sname} close`, { stdio: 'pipe', timeout: 5000 }) } catch {}
    }
  }

  server.close()
  console.log('Done.')
})
