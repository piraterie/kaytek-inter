async page => {
  await page.evaluate(() => {
    document.querySelectorAll("*").forEach(el => { if(el.scrollHeight > el.clientHeight + 50) el.scrollTop = el.scrollHeight; });
    window.scrollBy(0, 800);
  });
}
