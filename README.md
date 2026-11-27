# Open Space Duel

A browser-based space-combat game with solo, same-device duel and manual WebRTC duel modes. This is a release candidate, not a stable release. Online interoperability is still under qualification.

## Build and test locally

Requirements: Node.js 22 or later, npm, a modern browser.

```sh
npm ci --ignore-scripts
npm run lint
npm run typecheck
npx --no-install vitest run tests/steering-energy.test.ts
npm run build
npm run dev
```

Open the URL printed by Vite. To preview the production build, run `npm run preview`. The built static site is in `dist/`; the project is configured for the GitHub Pages project path `/open-space-duel/`. No backend, account, token or AI tool is required to build or try the local game.

## Local controls

| Action | Pilot 1 | Pilot 2 |
|---|---|---|
| Thrust | W | Up |
| Turn | A / D | Left / Right |
| Primary fire | Space / F | Enter / M |
| Secondary fire | X / R | K / comma |
| Shield | Left Shift / Q | L / period |
| Pause | Escape | — |

Choose arcade or inertial flight and a ship class before starting a duel. Thrust, steering, weapons and shields share an energy budget. The inertial model retains angular momentum until counter-thrust is applied. For an online duel, follow the private-link offer/reply instructions shown in the game. Network and browser restrictions can affect connectivity.

## Project resources

- [Play the currently published game](https://mark-e-deyoung.github.io/open-space-duel/)
- [Report a bug](https://github.com/mark-e-deyoung/open-space-duel/issues)
- [Public CI evidence](https://github.com/mark-e-deyoung/open-space-duel/actions)

Include the version, browser, reproduction steps and expected/observed behavior in bug reports. Do not include credentials, private invite links or personal information.

The package declares ISC licensing; third-party dependencies retain their own licenses. See the dependency lockfile for the exact dependency versions.
