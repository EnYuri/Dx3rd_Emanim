<# Install the repository-local hooks once for this checkout. #>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
git -C $Root config core.hooksPath tools/git-hooks
if ($LASTEXITCODE -ne 0) { throw "Could not configure this repository's Git hooks path." }
Write-Host "DX3rd | Git hooks enabled: tools/git-hooks"
Write-Host "DX3rd | Every commit now bumps system.json's version. Packs are NOT rebuilt or staged -- packs/ is the source of truth and you stage it yourself with 'git add packs'."
