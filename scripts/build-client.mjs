// Bundle the TypeScript-compiled client half into the DSH web client-modules
// handoff format: window.__ModuleLoader__.load({ id, factory }).
//
// Each compiled CJS file becomes a private module in `__modules`; the factory
// receives the host `require` for anything not in the private table (our
// client bundle has no host runtime imports, so the table is self-contained).
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const compiledRoot = join(root, '.client-build')
const outputPath = join(root, 'lib', 'client.js')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

const files = (await readdir(compiledRoot))
  .filter((path) => path.endsWith('.js'))
  .sort((a, b) => a.localeCompare(b))

const lines = []
lines.push(`window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {`)
lines.push('var __modules = Object.create(null); var __cache = Object.create(null);')
for (const filename of files) {
  const moduleId = `./${filename}`
  const compiledPath = join(compiledRoot, filename)
  const source = (await readFile(compiledPath, 'utf8'))
    .replace(/\n?\/\/# sourceMappingURL=.*$/u, '')
    // Host package imports stay on `require`; compiler-emitted local CJS
    // imports route through the private module table.
    .replace(/\brequire(?=\(["']\.\.?\/)/gu, '__load_')
  lines.push(`__modules[${JSON.stringify(moduleId)}] = function(module, exports, require, __load_) {`)
  lines.push(source)
  lines.push('};')
}
for (const line of [
  'function __resolve(from, request) {',
  '  if (!request.startsWith(".")) return request;',
  '  var parts = from.slice(2).split("/"); parts.pop();',
  '  for (var part of request.split("/")) { if (part === "." || part === "") continue; if (part === "..") parts.pop(); else parts.push(part); }',
  '  return "./" + parts.join("/");',
  '}',
  'function __load(id) {',
  '  if (__modules[id] === undefined) return require(id);',
  '  if (__cache[id] !== undefined) return __cache[id].exports;',
  '  var module = __cache[id] = { exports: {} };',
  '  __modules[id](module, module.exports, require, function(request) { var resolved = __resolve(id, request); return __modules[resolved] === undefined ? require(request) : __load(resolved); });',
  '  return module.exports;',
  '}',
  'return __load("./index.js"); } });',
  '',
]) lines.push(line)

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, lines.join('\n'))
console.log(`dsh-bubble-explain: wrote ${outputPath} (${files.length} module(s))`)
