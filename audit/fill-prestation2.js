async page => {
  const allInputs = await page.locator("input, textarea").all();
  const details = [];
  for (let i = 0; i < allInputs.length; i++) {
    const ph = await allInputs[i].getAttribute("placeholder");
    const type = await allInputs[i].getAttribute("type");
    const val = await allInputs[i].inputValue();
    details.push(i + ": type=" + type + " ph=" + ph + " val=" + val);
  }
  return details.join(" | ");
}
