# static/ is build output. Nothing in here is source.

Production never reads a committed copy of this folder: the Dockerfile builds
the React app and copies `Barista Front End/build` here (`COPY --from=
frontend-builder /app/frontend/build ./static`). Locally, `./build.sh` does the
same. Flask serves it as `static_folder`.

Until 12 Sep 2026 the repo tracked 400 files here -- bundles several builds
behind production, and a hundred-odd `debug-*.html` / `fix-*.html` /
`*-DELETE_LATER.html` pages from 2025 that, because `COPY . .` ran before the
build was overlaid, were **served live on cupq.app**. Finding 7 in
docs/FINDINGS_ROADMAP.md. They are gone; `.gitignore` keeps them gone.
