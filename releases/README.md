# Releases (VSIX builds)

Versioned installers for BlueToken live here:

```
releases/
  0.1.0/bluetoken-0.1.0.vsix
  0.1.1/bluetoken-0.1.1.vsix
  …
  <version>/bluetoken-<version>.vsix
```

## Build a new VSIX

```bash
npm install
npm run package
```

This writes `releases/<version>/bluetoken-<version>.vsix` using the version in `package.json`.

## Install

In Cursor / VS Code / Antigravity:

**Extensions → ⋯ → Install from VSIX…** → pick the file under `releases/<version>/`.

## GitHub Releases

When publishing on GitHub, attach the matching `.vsix` from this folder to a [GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github) tagged `v<version>`.

> Binary `.vsix` files are gitignored by default (keep the repo light). Build locally or CI, then upload to GitHub Releases.
