# Working rules for this repo (Codex, Claude Code, Cursor)

## Build number — bump on every UI change
The app header shows `Build vX.Y.Z · <commit>`.
- `vX.Y.Z` comes from `package.json` `version`. **Every commit that changes anything the user can see must bump it**:
  - new feature or new control → minor (0.8.0 → 0.9.0)
  - fix or wording/style tweak → patch (0.8.0 → 0.8.1)
  - Use `npm version <x.y.z> --no-git-tag-version` so `package-lock.json` stays in step.
- `<commit>` is filled in automatically from the GitHub Actions commit SHA at deploy time. Never hard-code it.

## Before pushing
`npm test && npm run lint && npm run build` must all pass. Pushing to `main` deploys to GitHub Pages
(https://sourmilkman.github.io/RMS-catalogue/).

## Catalogue rules
- Printed catalogue order: Sculptures → Miniature Paintings → Young Artists, each A–Z by surname, numbered continuously.
- Sculpture vs painting is decided **per artwork** (toggle on the artwork card, or the Word import's section). Young Artists override both.
- Data extraction never guesses: anything ambiguous is left blank and flagged to the user.
