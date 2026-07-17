# WheelMaker App

The `app` workspace contains the Workspace Web UI. Browser builds and the
Windows `WheelMakerDesktop` executable both use this same React/webpack output.

## Directory Layout

- `web/src`: pure React UI entry and pages
- `web/public`: web static template and PWA assets
- `scripts/export_web_release.js`: export web files for static hosting

## Commands

- `npm run web`: start pure React web dev server on `:8080`
- `npm run start`: alias for `npm run web`
- `npm run build:web`: build web files to `~/.wheelmaker/web` by default
- `npm run build:web:release`: build hashed web assets and export deployable files
- `npm run tsc:web`: type-check the web code

## Release Model

1. Browser/static release:
   - `npm run build:web:release`
   - Serve the exported web root.
   - Keep `/`, `/index.html`, `/service-worker.js`, and `/manifest.webmanifest` revalidatable.
   - Serve hashed/static files such as JS, CSS, fonts, and icons with long immutable cache headers.

2. Desktop release:
   - Run `publish-release.bat` from the repository root and choose Desktop.
   - Choose whether to keep the generated executable local or publish it with the prebuilt release.

3. Android APK embedded snapshot:
   - Run `publish-release.bat` from the repository root and choose Android.
   - The unified publisher copies the canonical bootstrap page into its per-build `.release-work/tmp/` asset root; Gradle packages that snapshot into the APK.
   - APK and `android-release.json` output are written under `.release-out/v1.x/android/`.
   - Reusable Gradle state is stored under `.release-work/cache/gradle/`.
   - No Android-generated Web assets are written under `app/` or `mobile/android/`.
