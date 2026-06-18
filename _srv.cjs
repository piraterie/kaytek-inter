const http = require("http")
const pages = {}
function makeHtml(logo, canvas) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;box-sizing:border-box;}html,body{width:${canvas}px;height:${canvas}px;overflow:hidden;background:#fff;display:flex;align-items:center;justify-content:center;}</style></head><body><svg xmlns="http://www.w3.org/2000/svg" width="${logo}" height="${logo}" viewBox="0 0 100 100" fill="none"><defs><clipPath id="fl"><rect x="0" y="0" width="52" height="100"/></clipPath></defs><polygon points="72,12 93,50 72,88 28,88 7,50 28,12" fill="none" stroke="#1A2F5C" stroke-width="9" stroke-linejoin="round"/><polygon points="72,12 93,50 72,88 28,88 7,50 28,12" fill="none" stroke="#3B82F6" stroke-width="9" stroke-linejoin="round" clip-path="url(#fl)"/><line x1="35" y1="22" x2="35" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/><line x1="35" y1="22" x2="54" y2="22" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/><line x1="35" y1="78" x2="54" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/><line x1="40" y1="50" x2="67" y2="22" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/><line x1="40" y1="50" x2="67" y2="78" stroke="#3B82F6" stroke-width="9" stroke-linecap="round"/></svg></body></html>`
}
pages["/i512"] = makeHtml(460,512)
pages["/i192"] = makeHtml(172,192)
pages["/i180"] = makeHtml(156,180)
const s = http.createServer((q,r)=>{ const h=pages[q.url]; if(!h){r.writeHead(404);r.end();return} r.writeHead(200,{"Content-Type":"text/html;charset=utf-8"});r.end(h) })
s.listen(8766, ()=>console.log("ready"))
