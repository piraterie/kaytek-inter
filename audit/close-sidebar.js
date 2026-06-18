async page => {
  await page.evaluate(() => {
    const overlay = document.querySelector('.sidebar-overlay, .nav-overlay, [class*="overlay"], [class*="backdrop"]');
    if (overlay) overlay.click();
  });
}
