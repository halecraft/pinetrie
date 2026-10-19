// S279's probe: the names core's and rules' indexes export that no other
// package imports (source or test). Run: node docs/findings/S279-one-plan-per-card-command/index-unused.mjs <repo root>
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"
const require = createRequire(path.join(process.argv[2], "package.json"))
const o = require(fs.readdirSync(path.join(process.argv[2], "node_modules/.pnpm")).filter(d => d.startsWith("oxc-parser@")).map(d => path.join(process.argv[2], "node_modules/.pnpm", d, "node_modules/oxc-parser"))[0])
const ROOT = process.argv[2]
const files=[]; (function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==="node_modules"||e.name.startsWith("."))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.(ts|tsx)$/.test(e.name))files.push(p)}})(ROOT+"/packages");
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==="node_modules"||e.name.startsWith("."))continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.(ts|tsx)$/.test(e.name))files.push(p)}})(ROOT+"/apps");
const used={}
for(const f of files){let pr;try{pr=o.parseSync(f,fs.readFileSync(f,"utf8")).program}catch{continue}
 for(const st of pr.body){ if(st.type!=="ImportDeclaration"&&!(st.type==="ExportNamedDeclaration"&&st.source))continue; const p=st.source.value; if(!p.startsWith("@pinetrie/"))continue; const pkg=p.split("/")[1]; if(f.startsWith(`${ROOT}/packages/${pkg}/`))continue
  for(const e of st.specifiers??[]){const n=(e.imported??e.local)?.name; if(n)(used[pkg]??=new Set()).add(n)}}}
for(const pkg of ["rules","core"]){
 let idx=fs.readFileSync(`${ROOT}/packages/${pkg}/index.ts`,"utf8")
 let names
 if(pkg==="core"){names=[];for(const m of idx.matchAll(/export \* from "\.\/([\w-]+)\.ts"/g)){const s=fs.readFileSync(`${ROOT}/packages/core/${m[1]}.ts`,"utf8");for(const d of s.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|class|interface|type|enum)\s+(\w+)/gm))names.push(d[1])}}
 else names=[...idx.matchAll(/^\s+(?:type\s+)?([A-Za-z_]\w*),?$/gm)].map(m=>m[1])
 const un=names.filter(n=>!used[pkg]?.has(n))
 console.log(JSON.stringify({pkg,names:names.length,unused:un}))
}
