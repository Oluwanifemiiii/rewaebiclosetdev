## Quick orientation for AI coding agents

This repository is Sharetribe's Web Template: a server-rendered React app with a small Express server.
Keep guidance short, actionable, and anchored to files referenced below.

1. Big picture
   - Frontend: `src/` — React app using Redux (ducks pattern under `src/ducks`), route config in `src/routing`, and components in `src/components` and `src/containers`.
   - Server: `server/` — Express-based server. `server/index.js` is the production server (SSR + static assets). `server/apiServer.js` is a dev-only API server.
   - Build: `sharetribe-scripts` controls webpack build/dev. Server-side bundles are produced into `build/` and used by `server/index.js`.

2. Developer workflows & commands (use Yarn)
   - Install: `yarn install` (postinstall runs `patch-package`).
   - Local dev (frontend + backend): `yarn run dev` — runs `sharetribe-scripts start` and nodemon `server/apiServer.js` concurrently.
   - Only frontend dev: `yarn run dev-frontend`.
   - Only backend dev: `yarn run dev-backend`.
   - Build: `yarn run build` (runs `build-web` + `build-server`). `yarn start` runs production server: node --icu-data-dir=node_modules/full-icu server/index.js
   - Tests: `yarn test` (note: the repo sets `NODE_ICU_DATA=node_modules/full-icu` for tests). API server tests: `yarn run test-server`.
   - Format: `yarn run format`.

3. Important runtime/config requirements
   - Node engine: `>=18.20.1 <23.2.0` (see `package.json` `engines`). Use WSL on Windows for smoother experience if needed.
   - Environment config: `server/env.js` is used to load `.env.*` files. `server/index.js` enforces a set of mandatory env vars — notably:
     `REACT_APP_SHARETRIBE_SDK_CLIENT_ID`, `SHARETRIBE_SDK_CLIENT_SECRET`, `REACT_APP_MARKETPLACE_NAME`, `REACT_APP_MARKETPLACE_ROOT_URL`.
   - Patch package: `patches/` contains patches (e.g. `final-form+4.20.10.patch`) and `postinstall` runs `patch-package`.

4. Key integration points & patterns
   - Server-side rendering: `src/index.js` exports `renderApp` and `server/index.js` uses `getExtractors()` from `server/importer` to load the server bundle and run `renderer.render(...)`.
   - Chunk extraction: loadable-components is used (`@loadable/component` + `@loadable/server`). Look at `server/index.js` and `src/index.js` for how `nodeExtractor` and `webExtractor` are used.
   - API routes: `server/api/*.js` and `server/apiRouter.js` handle server API endpoints. Dev API server (`server/apiServer.js`) runs on a different port and enables CORS for frontend dev.
   - Redux: Uses a ducks pattern; prefer editing/adding `*.duck.js` under `src/ducks` for state logic and side-effect orchestration via dispatches. `src/store.js` and `src/config` show store setup.
   - Hosted assets and translations: `fetchAppAssets` and hosted config handling live in `src/ducks/hostedAssets.duck.js` and `src/index.js` shows how hosted assets/translations are loaded before render/hydrate.

5. Files to read first when working on a change
   - `package.json` — scripts, engines, dependencies (sharetribe-scripts matters a lot).
   - `server/index.js` — production server behavior, mandatory env vars, CSP handling, how SSR is wired.
   - `server/apiServer.js` — simpler dev-only API server (useful for API changes and local debugging).
   - `src/index.js` — client entry and SSR export (`renderApp`).
   - `src/ducks/*` — common place for state changes; follow existing duck files for naming and action creators.

6. Detective tips and examples
   - If a bug appears only in SSR, check `server/index.js` + `renderer.js` and the server bundle (build output under `build/`).
   - To run backend-only live reload: `yarn run dev-backend` (nodemon watches `server/`).
   - To reproduce cookie/CORS issues in dev, confirm `REACT_APP_MARKETPLACE_ROOT_URL` and `REACT_APP_DEV_API_SERVER_PORT` settings used by `server/apiServer.js`.

7. What NOT to change lightly
   - `sharetribe-scripts` build/eject behavior and the import/export contract of `src/index.js`/`renderApp` — many parts depend on the server-side entry signature.
   - `postinstall` patch flow; modifying it may break dependency hotfixes in `patches/`.

If any of this is unclear or you want examples for a specific task (add an endpoint, change SSR data preloading, or update a duck), tell me which area and I will expand with concrete file-level guidance and examples.
