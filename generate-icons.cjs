// generate-icons.cjs — génère les icônes PNG PWA depuis le SVG Kaytek Inter
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

// Symbole inchangé — respiration gérée par le viewBox "-13 -13 126 126"
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

// viewBox avec 13px de padding interne → symbole occupe ~75% du SVG
// padding externe = marge supplémentaire dans l'image finale
async function generate(size, outputPath, padding = 0.12, bgColor = '#ffffff') {
  const logoSize = Math.round(size * (1 - 2 * padding))
  const offset = Math.round(size * padding)

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${size}px; height: ${size}px; overflow: hidden; background: ${bgColor}; display: flex; align-items: center; justify-content: center; }
</style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="${logoSize}" height="${logoSize}" viewBox="-13 -13 126 126" fill="none">
${svgBody}
</svg>
</body>
</html>`

  const tmpFile = path.join(__dirname, `_tmp_icon_${size}.html`)
  fs.writeFileSync(tmpFile, html, 'utf8')

  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: size, height: size })
  await page.goto(`file://${tmpFile}`)
  await page.waitForTimeout(200)
  await page.screenshot({ path: outputPath, type: 'png' })
  await browser.close()

  fs.unlinkSync(tmpFile)
  console.log(`✓ ${outputPath} (${size}×${size}, symbole=${Math.round(logoSize * 0.754)}px net)`)
}

async function main() {
  const iconsDir = path.join(__dirname, 'public', 'icons')
  if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true })

  // Regular icons (purpose: any) — 12% padding externe + ~10% padding SVG interne = ~22% total
  await generate(192, path.join(iconsDir, 'icon-192.png'), 0.12)
  await generate(512, path.join(iconsDir, 'icon-512.png'), 0.12)

  // Apple touch icon — un peu plus aéré sur iOS
  await generate(180, path.join(__dirname, 'public', 'apple-touch-icon.png'), 0.14)

  // Maskable icons (purpose: maskable) — safe zone Android/Chrome = 80% du centre (10% marge)
  // 8% padding externe + SVG interne ~10% = symbole dans ~63% de l'image = bien dans la safe zone
  await generate(512, path.join(iconsDir, 'icon-512-maskable.png'), 0.08)
  await generate(192, path.join(iconsDir, 'icon-192-maskable.png'), 0.08)

  console.log('\n✅ Toutes les icônes générées.')
}

main().catch(err => { console.error(err); process.exit(1) })
