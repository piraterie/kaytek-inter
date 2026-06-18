async page => {
  const ids = await page.evaluate(() => {
    const cards = document.querySelectorAll(".devis-card, [class*='card']");
    return [...cards].slice(0,3).map(c => c.innerHTML.substring(0,100));
  });
  return JSON.stringify(ids);
}
