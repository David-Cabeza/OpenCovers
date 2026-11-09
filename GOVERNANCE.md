# Governance

## Maintainer

David Cabeza is the initial maintainer. The maintainer reviews flags, merges pull requests, and makes the final call when consensus is not reached.

## Decisions

- Small changes use lazy consensus in the issue or pull request.
- Architecture, contract, and security decisions use an ADR in `docs/adr/`.
- A decision that changes the public contract needs an ADR and a conformance case.
- The maintainer has the final call until a maintainer team exists.

## Flags

Anyone can propose a flag. A flag is ready when it states the what, the why, the scope, the acceptance criteria, the dependencies, and a size. A maintainer applies the `status:ready` label. A contributor claims a flag by commenting on the issue. The maintainer assigns the contributor and moves the label to `status:claimed`.

If a claimed flag has no draft pull request after seven days and no update, it returns to `status:ready`.

## Pull requests

A pull request needs one maintainer approval before it merges. Once CI exists, it also needs a green CI run. Security-sensitive changes need a second review. The reviewer checks the acceptance criteria, the evidence, and the absence of confidential material.

## Releases

The project uses semantic versioning after the public API stabilizes. Before 1.0, breaking changes are allowed with a changelog entry and a migration note.

## Becoming a maintainer

Contributors who land several flags, review other pull requests, and follow the code of conduct can be invited as maintainers. The current maintainer makes the invitation.
