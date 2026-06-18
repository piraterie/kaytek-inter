async page => {
  const main = document.querySelector("main") || document.querySelector("[class*=content]") || document.documentElement;
  main.scrollTop = 9999;
  document.body.scrollTop = 9999;
  document.documentElement.scrollTop = 9999;
  return "scrolled";
}
