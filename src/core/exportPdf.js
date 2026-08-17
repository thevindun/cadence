export function exportPdf({ title, range, cards, platforms, posts }) {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return false
  const row = (l, v) => `<tr><td>${l}</td><td style="text-align:right">${v}</td></tr>`
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;color:#111;margin:40px;}
  h1{font-size:22px;margin:0 0 4px} .sub{color:#666;font-size:12px;margin-bottom:24px}
  .cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:28px}
  .card{border:1px solid #e2e6ea;border-radius:10px;padding:12px 16px;min-width:110px}
  .card b{display:block;font-size:22px} .card span{color:#666;font-size:11px}
  table{width:100%;border-collapse:collapse;margin-bottom:28px}
  th,td{text-align:left;padding:7px 6px;border-bottom:1px solid #eef1f4;font-size:12px}
  th{color:#666;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.5px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:#666;margin:0 0 10px}
  @media print{@page{margin:16mm}}
</style></head><body>
<h1>${title}</h1><div class="sub">${range} · generated ${new Date().toLocaleDateString()}</div>
<div class="cards">${cards.map((c) => `<div class="card"><b>${c.value}</b><span>${c.label}</span></div>`).join('')}</div>
<h2>By platform</h2><table><tr><th>Platform</th><th style="text-align:right">Engagement</th></tr>
${platforms.map((p) => row(p.label, p.value)).join('')}</table>
<h2>Top posts</h2><table><tr><th>Date</th><th>Post</th><th style="text-align:right">Engagement</th></tr>
${posts.map((p) => `<tr><td>${p.date}</td><td>${p.text}</td><td style="text-align:right">${p.value}</td></tr>`).join('')}</table>
</body></html>`)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 300)
  return true
}