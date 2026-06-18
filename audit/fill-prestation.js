async page => { const inputs = await page.locator("input").all(); await inputs[0].fill("Remplacement serrure 3 points"); await inputs[1].fill("2"); await inputs[2].fill("85"); }
