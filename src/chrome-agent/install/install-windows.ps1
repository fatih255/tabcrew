# tabcrew-chrome installer for Windows (current user, no admin). Same as: node install\install.mjs
# Options: -- --no-claude  --dry-run
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 18+ is required (https://nodejs.org).' }
& node (Join-Path $PSScriptRoot 'install.mjs') @args
exit $LASTEXITCODE
