# Telemux Landing

This folder is a static landing page. Deploy the contents of `web/` as-is.

The install command shown on the page uses:

```bash
curl -fsSL https://raw.githubusercontent.com/bangnokia/telemux/main/web/install.sh | bash
```

The installer downloads the latest server release, verifies its SHA-256 checksum, installs the CLI into `~/telemux`, and creates a systemd service when available. It may ask for sudo when packages or service setup need root access.

The page uses the same `Ioskeley Mono Term` font bundled in the Telemux app.
