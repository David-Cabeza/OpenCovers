# Security policy

## Supported versions

OpenCovers is pre-alpha. No version is supported for production use.

## Report a vulnerability

Report vulnerabilities privately through GitHub: open the [Security tab](https://github.com/David-Cabeza/OpenCovers/security) and choose **Report a vulnerability**. Do not open a public issue or a public pull request for a vulnerability.

Include:

- What the vulnerability allows an attacker to do.
- The affected commit or file.
- The steps to reproduce it.
- Any suggested fix.

The maintainers aim to acknowledge your report within three business days. They will keep you informed until the issue is resolved. You can ask to be credited in the advisory.

## Scope

This policy covers the OpenCovers engine, the HTTP API, the MCP server, and the documentation in this repository. It does not cover third-party services or deployments operated by someone else.

## Secrets and guest data

Never commit API keys, access tokens, `.dev.vars`, `.env` files, or real guest data. Use synthetic data in tests and examples. If you find a secret in the repository, report it privately.
