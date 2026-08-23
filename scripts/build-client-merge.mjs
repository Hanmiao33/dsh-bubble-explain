// Wrap the single compiled CJS client module (.client-build/index.js) into
// the proven netease-sidebar bundle shape:
//   window.__ModuleLoader__.load({ id, factory: (require) => { var module
//   = { exports: {} }; var exports = module.exports; ... return module.exports; } })
// The compiled module's only external require is "react" (a seed word in the
// boot graph); everything else is inline in the single source file.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const build = join(root, '.client-build')
const out = join(root, 'lib', 'client.js')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

let body = readFileSync(join(build, 'index.js'), 'utf8')
  .replace(/\n?\/\/# sourceMappingURL=.*$/u, '')

// Strip the compiler's leading "use strict" (the loader wraps in strict CJS
// context anyway) and any sourceMapping comment.
body = body.replace(/^["']use strict["'];?\s*/u, '')

const bundle = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(pkg.name)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
	return module.exports;
	}
});
`

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, bundle, 'utf8')
console.log(`wrote ${out} (${bundle.length} bytes)`)
