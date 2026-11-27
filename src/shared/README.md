# Shared Modules

These modules are imported by both the SPA and the server-peer.

## Current location

| Module | Path | Future path |
|--------|------|-------------|
| Simulation helpers | `src/sim/` | `src/shared/sim/` |
| Network layer | `src/network/` | `src/shared/network/` |
| Game engine types | `src/game/engine/state.ts` | `src/shared/types/` |
| RNG | `src/game/engine/rng.ts` | `src/shared/types/` |
| Entities | `src/game/entities/` | `src/shared/entities/` |
| Physics systems | `src/game/systems/` | `src/shared/systems/` |

## Migration plan

1. Create `src/shared/` subdirectories
2. Move files one module at a time
3. Update all import paths (`../../src/game/` → `../../src/shared/`)
4. Verify: `npm run build && cd server-peer && npm run build && npm test`
5. Commit per-module for clean rollback

## Why shared/

- Makes the contract obvious: anything under `src/shared/` is imported by both SPA and server-peer
- Prevents accidental browser-only API usage in shared code
- Speeds up agent understanding: "what's shared?" → `ls src/shared/`
- Server-peer's `tsconfig.json` can include just `../src/shared/**` instead of listing individual directories
