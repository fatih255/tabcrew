# Removes tabcrew-chrome (native host, Claude Code entry, installed files). Same as: node install\install.mjs --uninstall
& node (Join-Path $PSScriptRoot 'install.mjs') --uninstall @args
exit $LASTEXITCODE
