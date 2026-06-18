// gen-icons-server.cjs — Démarre un mini serveur HTTP + génère les icônes
const http = require('http')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

function makeHtml(logoSize, canvasSize, bg = '#ffffff') {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:${canvasSize}px; height:${canvasSize}px; overflow:hidden; background:${bg};
  display:flex; align-items:center; justify-content:center; }</style>
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
  { path: '/i512', logoSize: 460, canvasSize: 512 },
  { path: '/i192', logoSize: 172, canvasSize: 192 },
  { path: '/i180', logoSize: 156, canvasSize: 180 },
  { path: '/m512', logoSize: 492, canvasSize: 512 },
  { path: '/m192', logoSize: 184, canvasSize: 192 },
]

const server = http.createServer((req, res) => {
  const icon = icons.find(i => i.path === req.url)
  if (!icon) { res.writeHead(404); res.end('not found'); return }
  const html = makeHtml(icon.logoSize, icon.canvasSize)
  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(html)
})

server.listen(8765, () => {
  console.log('Server running on port 8765')

  const outputs = [
    { url: 'http://localhost:8765/i512', size: 512, out: 'public/icons/icon-512.png' },
    { url: 'http://localhost:8765/i192', size: 192, out: 'public/icons/icon-192.png' },
    { url: 'http://localhost:8765/i180', size: 180, out: 'public/apple-touch-icon.png' },
    { url: 'http://localhost:8765/m512', size: 512, out: 'public/icons/icon-512-maskable.png' },
    { url: 'http://localhost:8765/m192', size: 192, out: 'public/icons/icon-192-maskable.png' },
  ]

  for (const { url, size, out } of outputs) {
    try {
      execSync(
        `npx playwright-cli resize ${size} ${size} && npx playwright-cli goto "${url}" && npx playwright-cli screenshot --filename="${out}"`,
        { stdio: 'inherit', timeout: 30000 }
      )
      console.log('✓', out)
    } catch (e) {
      console.error('✗', out, e.message)
    }
  }

  server.close()
  console.log('Done.')
})
