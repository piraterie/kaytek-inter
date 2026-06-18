// guide/setup/visual-effects.ts
// Couche visuelle pédagogique pour les enregistrements Playwright.
// Ajoute : curseur visible, ripple au clic, surlignage, tooltips, titre/conclusion.
// Usage : appeler injectVisualLayer(page) après la première navigation, puis utiliser
// vClick() / vFill() à la place de click() / fill() pour les actions importantes.
import type { Page, Locator } from '@playwright/test'

// ── CSS injecté dans la page ─────────────────────────────────────────────────
const LAYER_CSS = `
  /* Curseur personnalisé visible dans les enregistrements */
  #kt-cursor {
    position: fixed;
    width: 22px;
    height: 22px;
    background: rgba(255, 255, 255, 0.95);
    border: 2.5px solid #2563eb;
    border-radius: 50%;
    pointer-events: none;
    z-index: 2147483645;
    transform: translate(-50%, -50%);
    box-shadow: 0 2px 10px rgba(37,99,235,0.4), 0 0 0 3px rgba(37,99,235,0.12);
    transition: opacity 0.2s;
  }

  /* Ripple animé au clic — disque plein (assez de masse pour le codec WebM) */
  .kt-ripple {
    position: fixed;
    width: 24px;
    height: 24px;
    background: rgba(37, 99, 235, 0.55);
    border: 4px solid rgba(37, 99, 235, 0.95);
    border-radius: 50%;
    pointer-events: none;
    z-index: 2147483644;
    transform: translate(-50%, -50%);
    animation: kt-ripple-anim 0.75s ease-out forwards;
  }
  @keyframes kt-ripple-anim {
    0%   { width: 24px;  height: 24px;  opacity: 0.95; background: rgba(37,99,235,0.55); }
    40%  { width: 70px;  height: 70px;  opacity: 0.6;  background: rgba(37,99,235,0.25); }
    100% { width: 110px; height: 110px; opacity: 0;    background: rgba(37,99,235,0); }
  }

  /* Surlignage d'un élément cliqué */
  .kt-highlight {
    position: fixed;
    border: 2.5px solid #2563eb;
    border-radius: 6px;
    background: rgba(37, 99, 235, 0.07);
    pointer-events: none;
    z-index: 2147483643;
    animation: kt-hl-anim 1.4s ease forwards;
  }
  @keyframes kt-hl-anim {
    0%   { opacity: 0; box-shadow: none; }
    10%  { opacity: 1; box-shadow: 0 0 0 5px rgba(37,99,235,0.16); }
    75%  { opacity: 1; box-shadow: 0 0 0 5px rgba(37,99,235,0.16); }
    100% { opacity: 0; box-shadow: none; }
  }

  /* Tooltip descriptif en bas de l'écran */
  #kt-tooltip {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(15, 23, 42, 0.93);
    color: #f8fafc;
    padding: 10px 24px;
    border-radius: 999px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.01em;
    z-index: 2147483642;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.25s ease;
    white-space: nowrap;
    max-width: 680px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.45);
    border: 1px solid rgba(255,255,255,0.09);
  }
  #kt-tooltip.visible { opacity: 1; }

  /* Badge étape (coin haut-droit) */
  #kt-step {
    position: fixed;
    top: 16px;
    right: 16px;
    background: rgba(15, 23, 42, 0.88);
    color: #f8fafc;
    padding: 6px 16px;
    border-radius: 999px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    z-index: 2147483641;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.3s ease;
    border: 1px solid rgba(255,255,255,0.1);
  }
  #kt-step.visible { opacity: 1; }

  /* Overlay plein écran — titre ou conclusion */
  #kt-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.91);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    z-index: 2147483640;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.4s ease;
  }
  #kt-overlay.visible { opacity: 1; }
  #kt-overlay-title {
    color: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 30px;
    font-weight: 700;
    text-align: center;
    margin: 0;
    padding: 0 48px;
    line-height: 1.25;
  }
  #kt-overlay-sub {
    color: rgba(248,250,252,0.58);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 17px;
    font-weight: 400;
    text-align: center;
    margin: 0;
    padding: 0 48px;
  }
`

// ── Injecter la couche visuelle dans la page ─────────────────────────────────
// À appeler une fois après la navigation finale (les éléments persistent sur la même page).
export async function injectVisualLayer(page: Page): Promise<void> {
  await page.addStyleTag({ content: LAYER_CSS })
  await page.evaluate(() => {
    // Curseur
    const cursor = document.createElement('div')
    cursor.id = 'kt-cursor'
    document.body.appendChild(cursor)

    // Tooltip
    const tip = document.createElement('div')
    tip.id = 'kt-tooltip'
    document.body.appendChild(tip)

    // Badge étape
    const step = document.createElement('div')
    step.id = 'kt-step'
    document.body.appendChild(step)

    // Overlay
    const ov = document.createElement('div')
    ov.id = 'kt-overlay'
    ov.innerHTML = '<p id="kt-overlay-title"></p><p id="kt-overlay-sub"></p>'
    document.body.appendChild(ov)
  })
}

// ── Déplacer le curseur visible ──────────────────────────────────────────────
async function moveCursor(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.move(x, y, { steps: 12 })
  await page.evaluate(([cx, cy]) => {
    const c = document.getElementById('kt-cursor')
    if (c) { c.style.left = cx + 'px'; c.style.top = cy + 'px' }
  }, [x, y])
}

// ── Ripple au point de clic ──────────────────────────────────────────────────
async function spawnRipple(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(([cx, cy]) => {
    const r = document.createElement('div')
    r.className = 'kt-ripple'
    r.style.left = cx + 'px'
    r.style.top  = cy + 'px'
    document.body.appendChild(r)
    setTimeout(() => r.remove(), 620)
  }, [x, y])
}

// ── Surligner un élément ─────────────────────────────────────────────────────
export async function highlightEl(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox().catch(() => null)
  if (!box) return
  await page.evaluate((b) => {
    const el = document.createElement('div')
    el.className = 'kt-highlight'
    el.style.left   = (b.x - 5) + 'px'
    el.style.top    = (b.y - 5) + 'px'
    el.style.width  = (b.width  + 10) + 'px'
    el.style.height = (b.height + 10) + 'px'
    document.body.appendChild(el)
    setTimeout(() => el.remove(), 1500)
  }, box)
}

// ── Tooltip ──────────────────────────────────────────────────────────────────
export async function showTip(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const el = document.getElementById('kt-tooltip')
    if (el) { el.textContent = t; el.classList.add('visible') }
  }, text)
}

export async function hideTip(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('kt-tooltip')?.classList.remove('visible')
  })
}

// ── Badge étape ──────────────────────────────────────────────────────────────
export async function showStep(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const el = document.getElementById('kt-step')
    if (el) { el.textContent = t; el.classList.add('visible') }
  }, text)
}

export async function hideStep(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('kt-step')?.classList.remove('visible')
  })
}

// ── Overlay titre / conclusion ───────────────────────────────────────────────
export async function showTitle(page: Page, title: string, sub = ''): Promise<void> {
  await page.evaluate(([t, s]) => {
    const h = document.getElementById('kt-overlay-title')
    const p = document.getElementById('kt-overlay-sub')
    if (h) h.textContent = t
    if (p) p.textContent = s
    document.getElementById('kt-overlay')?.classList.add('visible')
  }, [title, sub])
  await page.waitForTimeout(2_600)
  await page.evaluate(() => {
    document.getElementById('kt-overlay')?.classList.remove('visible')
  })
  await page.waitForTimeout(500)
}

export async function showConclusion(page: Page, text: string, sub = '✓ Terminé'): Promise<void> {
  await page.evaluate(([t, s]) => {
    const h = document.getElementById('kt-overlay-title')
    const p = document.getElementById('kt-overlay-sub')
    if (h) h.textContent = t
    if (p) p.textContent = s
    document.getElementById('kt-overlay')?.classList.add('visible')
  }, [text, sub])
  await page.waitForTimeout(2_600)
}

// ── Clic enrichi (hover → surlignage → ripple → clic) ───────────────────────
export async function vClick(
  page: Page,
  locator: Locator,
  tooltip?: string,
  pauseAfterMs = 700,
): Promise<void> {
  if (tooltip) await showTip(page, tooltip)

  const box = await locator.boundingBox().catch(() => null)
  if (box) {
    const cx = box.x + box.width  / 2
    const cy = box.y + box.height / 2
    await moveCursor(page, cx, cy)
    await page.waitForTimeout(380)
    await highlightEl(page, locator)
    await page.waitForTimeout(260)
    await spawnRipple(page, cx, cy)
  }

  await locator.click()
  await page.waitForTimeout(pauseAfterMs)

  if (tooltip) await hideTip(page)
}

// ── Saisie enrichie (déplace le curseur + tape caractère par caractère) ──────
export async function vFill(
  page: Page,
  locator: Locator,
  value: string,
  tooltip?: string,
  delayMs = 55,
): Promise<void> {
  if (tooltip) await showTip(page, tooltip)

  await highlightEl(page, locator)
  const box = await locator.boundingBox().catch(() => null)
  if (box) {
    await moveCursor(page, box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(250)
  }

  await locator.click()
  await locator.fill('')
  await locator.pressSequentially(value, { delay: delayMs })
  await page.waitForTimeout(500)

  if (tooltip) {
    await page.waitForTimeout(400)
    await hideTip(page)
  }
}
