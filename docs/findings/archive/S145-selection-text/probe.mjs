import { chromium } from "playwright"

const b = await chromium.launch()
const p = await b.newPage()
await p.setContent(`<div class="msg" data-entry="e"><div id="t"><p>Use <code>foo</code> and <strong>bar</strong>
next line</p><ul><li>a</li><li>b</li></ul></div></div>`)
const src = "Use `foo` and **bar**\nnext line\n\n- a\n- b"
const out = await p.evaluate(() => {
  const s = getSelection()
  const r = document.createRange()
  const t = document.getElementById("t")
  const res = {}
  r.selectNodeContents(t)
  s.removeAllRanges()
  s.addRange(r)
  res.all = s.toString()
  const p1 = t.querySelector("p")
  r.setStart(p1.firstChild, 0)
  r.setEnd(p1.childNodes[1].firstChild, 3)
  s.removeAllRanges()
  s.addRange(r)
  res.code = s.toString()
  r.selectNodeContents(t.querySelector("strong"))
  s.removeAllRanges()
  s.addRange(r)
  res.word = s.toString()
  return res
})
for (const [k, v] of Object.entries(out))
  console.log(k, JSON.stringify(v), "found:", src.indexOf(v) >= 0)
await b.close()
