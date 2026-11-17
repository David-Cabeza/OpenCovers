#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

required=(
  LICENSE
  README.md
  CONTRIBUTING.md
  CODE_OF_CONDUCT.md
  SECURITY.md
  GOVERNANCE.md
  ROADMAP.md
  docs/adr/TEMPLATE.md
  docs/decisions/2026-11-08-publication.md
  .github/ISSUE_TEMPLATE/flag.yml
  .github/ISSUE_TEMPLATE/bug.yml
  .github/ISSUE_TEMPLATE/config.yml
  .github/PULL_REQUEST_TEMPLATE.md
  .github/CODEOWNERS
  .gitignore
)

for file in "${required[@]}"; do
  if [ ! -e "$file" ]; then
    printf 'missing: %s\n' "$file" >&2
    exit 1
  fi
done

if command -v ruby >/dev/null 2>&1; then
  ruby -ryaml -e 'Dir[".github/**/*.yml"].each { |f| YAML.load_file(f) }'
else
  printf 'note: ruby not found, skipping the YAML syntax check (install ruby to run it)\n' >&2
fi

if git grep -n -E "LicenseRef-Proprietary|BEGIN (RSA|OPENSSH|EC) PRIVATE" -- \
  README.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md GOVERNANCE.md ROADMAP.md docs .github; then
  printf 'forbidden content found\n' >&2
  exit 1
fi

remote_install='npx\s+(-y|--yes)\s+(?!@opencovers/)\S|\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b'
set +e
git grep -n -I -P "$remote_install" -- . ':!pnpm-lock.yaml' ':!docs/collaboration-security.md'
status=$?
set -e
if [ "$status" -eq 0 ]; then
  printf 'remote install pattern found; see docs/collaboration-security.md, section 3\n' >&2
  exit 1
elif [ "$status" -ne 1 ]; then
  printf 'note: git grep -P unavailable, skipping the remote install check\n' >&2
fi

if ! git check-ignore -q .opencode/; then
  printf '.opencode/ is not ignored\n' >&2
  exit 1
fi

if ! git check-ignore -q opencode.json; then
  printf 'opencode.json is not ignored\n' >&2
  exit 1
fi

printf 'publication checks passed\n'
