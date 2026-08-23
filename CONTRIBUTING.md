# Contributing

Thanks for your interest in dsh-bubble-explain!

## Development setup

The plugin is a DSH profile bundle. To build the host side you need a DSH
source checkout (the harness `packages/` tree):

```bash
DSH_CHECKOUT=<checkout> bash scripts/build.sh
npm run build:client   # bundle the client overlay
```

Checks that need no checkout:

```bash
npm ci
npm run typecheck
npm run build:client
npm test
```

## Reporting issues

Open an issue describing the problem, the DSH version, and (if relevant) a
minimal reproduction. This project is maintained by its author; please be
patient with response times.

## Code style

- TypeScript, strict mode, no `any` unless unavoidable.
- Keep `src/explain.ts` side-effect free (pure validation + prompt assembly);
  it is the unit-tested core.
- New behavior should come with a test under `src/`.
- Line endings are normalized to LF (`.gitattributes`).
