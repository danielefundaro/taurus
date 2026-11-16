# Repository Guidelines

## Project Structure & Module Organization

Modules are built independently:

- `taurus-be/`: Java 25 Spring Boot API. Code is under `src/main/java`; configuration, Liquibase migrations, and Docker files are under `src/main/resources`; tests are under `src/test/java`.
- `taurus-fe/`: Angular 22 client. Features live in `src/app/pages`, shared UI in `components` and `dialogs`, API access in `service`, and assets in `src/assets`.
- `taurus-omr/`: Python 3.12 FastAPI service for optical music recognition (Audiveris, homr), MIDI conversion and the text reading of scanned pages (RapidOCR), called only by the backend. Code is under `src/taurus_omr`, tests under `tests`; engines, models and dependencies are pinned in the `Dockerfile`, `requirements.txt` and `models.sha256`.
- `keycloak-authenticator/`: Java 21 Keycloak provider and custom themes, compiled for the Java version of the Keycloak image, following the standard Maven `src/main`/`src/test` layout.
- `taurus-info/`: Astro marketing site; pages, components, and layouts are in `src`, with public assets in `public`.

## Build, Test, and Development Commands

- Backend: `./mvnw` starts the API; `./mvnw verify` runs checks/tests and the coverage gate on the merged unit and integration data; `-Dtaurus.test.requireDocker=true`, as in CI, turns a Docker-less skip of a P0 test into a failure; `docker compose -f src/main/docker/services.yml up --wait` starts dependencies, OMR service included.
- Frontend: `npm ci`, then `npm start` for development, `npm run build` for production, and `npm test` for Karma/Jasmine tests; `npm run test:coverage` adds the coverage gate and `npm run e2e` drives the Playwright suite described in `e2e/README.md`, which needs a full instance. `npm start` and `npm run build` download the score player SoundFont first (`TAURUS_SKIP_SOUNDFONT=1` skips it).
- OMR service: `pip install -r requirements-test.txt` and `python -m pytest` run the tests with fake engines; with `TAURUS_OMR_ACCURACY_URL` and `TAURUS_OMR_ACCURACY_KEY` set, `tests/test_accuracy.py` checks the real engines of a running service against the reference corpus in `accuracy/`, and its engraving time; `docker build -t taurus-omr .` builds the complete image; `services.yml` starts it with the other backend dependencies, pulling `fundanie/taurus-omr` (published at every `v*.*.*` tag) or building it when not published; `docker compose -f taurus-be/src/main/docker/services.yml up -d --build omr` rebuilds it from the working tree.
- Keycloak provider: `./mvnw verify` builds and tests the provider JAR.
- Info site: `pnpm install`, `pnpm dev`, `pnpm check`, `pnpm build`, and `pnpm test`, which checks the built site: expected files, page metadata, internal links, sitemap and the security headers of `nginx.conf`. Use pnpm 12 and Node.js 26.

## Coding Style & Naming Conventions

Honor module-local configuration. Angular uses strict TypeScript, four-space indentation, single quotes, semicolons, and Prettier (`npm run format`). Name Angular files in kebab case with role suffixes, for example `inventory.service.ts`. Java uses four-space indentation and standard package/class naming; backend formatting is enforced by Spotless/Prettier. Keep Astro TypeScript strict and follow existing two-space formatting.

For PrimeNG UI changes in `taurus-fe/`, consult `docs/llms-full.md` and read only the sections relevant to the component.

## Testing Guidelines

Backend tests use JUnit 5. Name unit tests `*Test.java` and integration tests `*IT.java`; mirror production packages. Test service logic, REST endpoints, persistence, and tenant isolation. Angular specs should sit beside their subject as `*.spec.ts`. Coverage has a measured baseline that both modules enforce: `jacoco.line.minimum` and `jacoco.branch.minimum` in `taurus-be/pom.xml`, and `taurus-fe/scripts/check-coverage.mjs`. Raise a baseline when coverage grows; never lower one without a note in the test runbook. A test that needs Docker, PostgreSQL, RabbitMQ or Keycloak goes through `DockerRequirement.required()`. Run each affected module's verification command before submitting.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, sentence-case summaries such as `Add media-asset table` and `Improve notices messages`. Keep commits focused and avoid mixing unrelated modules. Pull requests should explain the problem and solution, list affected modules and verification commands, link relevant issues/specs, and include screenshots for UI changes. Call out database migrations, configuration changes, and compatibility impacts explicitly.

## Security & Configuration

Never commit credentials, tokens, or production `.env` files. Start from tracked examples such as `taurus-info/.env.example`. Treat keystores, OAuth/Keycloak settings, tenant configuration, and Liquibase changes as security-sensitive; document required deployment values without embedding secrets.
