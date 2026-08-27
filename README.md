# RMS Catalogue Selection

Standalone installable PWA for turning the RMS Review Votes Google Sheet into a durable catalogue-selection workflow and a real Word `.docx` working document.

## What it does

- Refreshes the public `RMS Review Votes` Sheet on launch, focus, every 60 seconds, and on demand.
- Normalises repeating artwork groups without assuming a six-artwork maximum.
- Parses Y/M/N votes, flags ties and imperfect source data, and keeps vote verdicts separate from catalogue decisions.
- Stores the last source snapshot, manual decisions, name corrections, field inclusion, and Young Artist confirmation in IndexedDB on the current device.
- Exports only included artworks to a bordered Word table in the required First Name, Surname, Title, Y, N, M, email, DOB/Young Artist, Download Image order.
- Provides original-image hyperlinks rather than embedding full-resolution artwork.

## Local development

Requires Node.js 22 or later.

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm test
npm run lint
npm run build
```

## Google Sheet connection

The app defaults to the public CSV export for spreadsheet `1UR7J2JYYI490ldJql0tlAP7PHwzOVNsUv7j_2SjqpJ8`, tab `813824911`. No Google credential is embedded or required.

Copy `.env.example` to `.env.local` only if the endpoint needs to be changed. The Sheet adapter is isolated in `src/lib/sheet.ts`, so authenticated retrieval can replace it later without rewriting the interface.

If the Sheet becomes private, a static GitHub Pages site cannot hold a service-account secret. At that point, replace the adapter with a protected server endpoint.

## GitHub Pages deployment

The included workflow tests and builds every push to `main`, then deploys `dist` to GitHub Pages. In repository settings, choose **GitHub Actions** as the Pages source.

This repository is configured with the `/RMS-catalogue/` base path. If the repository name changes, update `base`, `start_url`, `scope`, and `navigateFallback` in `vite.config.ts`.

Private-repository Pages availability depends on the GitHub account plan. If Pages is unavailable while the repository remains private, make the repository public or use another static host.

## Installing the PWA

Open the deployed site in Chrome or Edge and choose **Install RMS Catalogue Selection** from the browser install control. On Android, use **Add to Home screen**. The interface shell works offline and clearly labels cached Sheet data as offline/stale.

## Local-state boundaries

Catalogue decisions are device-local in v1. Clearing browser storage or using another browser/device starts a separate catalogue state. **Reset catalogue decisions** is protected by a typed confirmation and does not modify Google Sheets.
