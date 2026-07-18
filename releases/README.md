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

Prebuilt `.vsix` files in this folder are tracked in git. When publishing on GitHub, you can also attach the matching file to a [GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github) tagged `v<version>`.
