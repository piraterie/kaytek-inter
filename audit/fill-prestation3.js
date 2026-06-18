async page => {
  const allInputs = await page.locator("input, textarea").all();
  await allInputs[2].fill("Remplacement serrure 3 points AUDIT");
  await allInputs[3].fill("2");
  await allInputs[4].fill("85");
}
