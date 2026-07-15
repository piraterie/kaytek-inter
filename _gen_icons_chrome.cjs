// _gen_icons_chrome.cjs — génère les icônes PNG en utilisant Chrome système
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const svgBody = `
  <defs>
    <clipPath id="fl">
      <rect x="0" y="0" width="52" height="100"/>
    </clipPath>
  </defs>
  <polygon points="72,12 93,50 72,88 28,88 7,50 28,12" fill="none" stroke="#1A2F5C" stroke-width="9" stroke-linejoin="round"/>
  <polygon points="72,12 93,50 72,88 28,88 7,50 28,12" fill="none" stroke="#3B82F6" stroke-width="9" stroke-linejoin="round" clip-path="url(#fl)"/>
  <line x1="35" y1="22" x2="35" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/>
  <line x1="35" y1="22" x2="54" y2="22" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/>
  <line x1="35" y1="78" x2="54" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/>
  <line x1="40" y1="50" x2="67" y2="22" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/>
  <line x1="40" y1="50" x2="67" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/>
`

async function generate(size, outputPath, padding = 0.12, bgColor = '#ffffff') {
  const logoSize = Math.round(size * (1 - 2 * padding))

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>* { margin:0;padding:0;box-sizing:border-box; } html,body { width:${size}px;height:${size}px;overflow:hidden;background:${bgColor};display:flex;align-items:center;justify-content:center; }</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="${logoSize}" height="${logoSize}" viewBox="-13 -13 126 126" fill="none">
${svgBody}
</svg>
</body></html>`

  const tmpFile = path.join(__dirname, `_tmp_icon_${size}.html`)
  fs.writeFileSync(tmpFile, html, 'utf8')

  const browser = await chromium.launch({ executablePath: CHROME_PATH })
  const page = await browser.newPage()
  await page.setViewportSize({ width: size, height: size })
  await page.goto(`file://${tmpFile}`)
  await page.waitForTimeout(200)
  await page.screenshot({ path: outputPath, type: 'png' })
  await browser.close()

  fs.unlinkSync(tmpFile)
  console.log(`✓ ${outputPath} (${size}×${size})`)
}

async function main() {
  const iconsDir = path.join(__dirname, 'public', 'icons')
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true })

  await generate(192, path.join(iconsDir, 'icon-192.png'), 0.12)
  await generate(512, path.join(iconsDir, 'icon-512.png'), 0.12)
  await generate(180, path.join(__dirname, 'public', 'apple-touch-icon.png'), 0.14)
  await generate(512, path.join(iconsDir, 'icon-512-maskable.png'), 0.08)
  await generate(192, path.join(iconsDir, 'icon-192-maskable.png'), 0.08)

  console.log('\n✅ Toutes les icônes générées.')
}

main().catch(err => { console.error(err); process.exit(1) })
