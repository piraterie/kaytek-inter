async page => {
  await page.evaluate(() => {
    const main = document.querySelector("main") || document.documentElement;
    main.scrollTop = 9999;
    document.documentElement.scrollTop = 9999;
  });
}
