// gen-icons.cjs — Génère les icônes PNG PWA via playwright-cli
const http = require('http')
const { execSync } = require('child_process')
const fs = require('fs')

function makeHtml(logoSize, canvasSize) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:${canvasSize}px;height:${canvasSize}px;overflow:hidden;background:#fff;
display:flex;align-items:center;justify-content:center;}</style>
</head><body>
<svg xmlns="http://www.w3.org/2000/svg" width="${logoSize}" height="${logoSize}" viewBox="0 0 100 100" fill="none">
<defs><clipPath id="fl"><rect x="0" y="0" width="52" height="100"/></clipPath></defs>
<polygon points="72,12 93,50 72,88 28,88 7,50 28,12" fill="none" stroke="#1A2F5C" stroke-width="9" stroke-linejoin="round"/>
<polygon points="72,12 93,50 72,88 28,88 7,50 28,12" fill="none" stroke="#3B82F6" stroke-width="9" stroke-linejoin="round" clip-path="url(#fl)"/>
<line x1="35" y1="22" x2="35" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/>
<line x1="35" y1="22" x2="54" y2="22" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/>
<line x1="35" y1="78" x2="54" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/>
<line x1="40" y1="50" x2="67" y2="22" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/>
<line x1="40" y1="50" x2="67" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/>
</svg>
</body></html>`
}

const icons = [
  { id: 'i512', logoSize: 460, canvasSize: 512, out: 'public/icons/icon-512.png' },
  { id: 'i192', logoSize: 172, canvasSize: 192, out: 'public/icons/icon-192.png' },
  { id: 'i180', logoSize: 156, canvasSize: 180, out: 'public/apple-touch-icon.png' },
  { id: 'ms512', logoSize: 492, canvasSize: 512, out: 'public/icons/icon-512-maskable.png' },
  { id: 'ms192', logoSize: 184, canvasSize: 192, out: 'public/icons/icon-192-maskable.png' },
]

const pages = {}
for (const ic of icons) pages[`/${ic.id}`] = makeHtml(ic.logoSize, ic.canvasSize)

const server = http.createServer((req, res) => {
  const html = pages[req.url]
  if (!html) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
})

server.listen(8765, async () => {
  console.log('HTTP server started on :8765')

  try {
    // Open a named session once
    execSync('npx playwright-cli -s=ico open', { stdio: 'pipe' })

    for (const { id, canvasSize, out } of icons) {
      const url = `http://localhost:8765/${id}`
      console.log(`Generating ${out}...`)
      execSync(`npx playwright-cli -s=ico resize ${canvasSize} ${canvasSize}`, { stdio: 'pipe' })
      execSync(`npx playwright-cli -s=ico goto "${url}"`, { stdio: 'pipe' })
      execSync(`npx playwright-cli -s=ico screenshot --filename="${out}"`, { stdio: 'pipe' })
      console.log(`  ✓ ${out}`)
    }

    execSync('npx playwright-cli -s=ico close', { stdio: 'pipe' })
    console.log('\n✅ Toutes les icônes générées.')
  } catch (e) {
    console.error('Erreur:', e.message)
    try { execSync('npx playwright-cli -s=ico close', { stdio: 'pipe' }) } catch {}
  }

  server.close()
})
