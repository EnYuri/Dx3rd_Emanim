<#
Build a distribution ZIP without private source material.

Usage (run after closing Foundry):
  powershell -ExecutionPolicy Bypass -File tools/release.ps1

The archive is whitelist-based. `_source`, Git metadata, local backups, docs,
and every other unlisted file can never enter a release by accident.
#>
[CmdletBinding()]
param(
    [string]$OutputDirectory = "dist",
    # Copy the newly built database packs into ./packs so they can be committed
    # with the version bump that triggers the GitHub Release workflow.
    [switch]$UpdatePacks
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
# Windows PowerShell 5.1 defaults to the active ANSI codepage for UTF-8 files
# without a BOM. system.json contains Korean labels, so always state UTF-8.
$Manifest = Get-Content (Join-Path $Root "system.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Version = $Manifest.version
$Dist = Join-Path $Root $OutputDirectory
$Stage = Join-Path $Dist "staging"
$SystemStage = Join-Path $Stage $Manifest.id
$Zip = Join-Path $Dist ("{0}-v{1}.zip" -f $Manifest.id, $Version)

function Test-Dx3rdPackDirectory {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Pack '$Name' is not a directory: $Path"
    }

    # CURRENT가 가리키는 MANIFEST와 최소 한 개의 LevelDB 데이터/WAL 파일이 있어야
    # 불완전한 스테이징 결과를 실사용 packs에 주입하지 않는다.
    $Current = Join-Path $Path "CURRENT"
    if (-not (Test-Path -LiteralPath $Current -PathType Leaf)) {
        throw "Pack '$Name' has no CURRENT file."
    }
    $ManifestFile = (Get-Content -LiteralPath $Current -Raw -Encoding UTF8).Trim()
    if ($ManifestFile -notmatch '^MANIFEST-\d+$') {
        throw "Pack '$Name' has an invalid CURRENT target: '$ManifestFile'"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Path $ManifestFile) -PathType Leaf)) {
        throw "Pack '$Name' CURRENT target is missing: $ManifestFile"
    }
    $DataFiles = @(Get-ChildItem -LiteralPath $Path -File | Where-Object {
        $_.Name -match '^\d+\.(ldb|log)$'
    })
    if ($DataFiles.Count -eq 0) {
        throw "Pack '$Name' has no LevelDB data files."
    }
    return $DataFiles.Count
}

if ($UpdatePacks) {
    # Replacing a package's LevelDB directories while Foundry has them open can
    # leave the running world with stale handles. The pre-commit path always
    # uses -UpdatePacks, so fail early rather than making a risky commit.
    $FoundryProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match "foundry" })
    if ($FoundryProcesses.Count -gt 0) {
        $Names = ($FoundryProcesses | ForEach-Object { "$($_.ProcessName) ($($_.Id))" }) -join ", "
        throw "Close Foundry before updating committed packs. Detected: $Names"
    }
}

if (Test-Path $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $SystemStage -Force | Out-Null

# Private generators run first, then their JSON output is compiled into staging.
& node (Join-Path $PSScriptRoot "build-compendia.mjs") --generate --output (Join-Path $SystemStage "packs")
if ($LASTEXITCODE -ne 0) { throw "Compendium build failed." }

# Only Foundry runtime files and public project metadata are copied.
$Files = @("system.json", "template.json", "README.md", "LICENSE", "LICENSE.md")
$Directories = @("assets", "lang", "scripts", "styles", "templates")
foreach ($File in $Files) {
    $Source = Join-Path $Root $File
    if (Test-Path -LiteralPath $Source) { Copy-Item -LiteralPath $Source -Destination $SystemStage -Force }
}
foreach ($Directory in $Directories) {
    $Source = Join-Path $Root $Directory
    if (Test-Path -LiteralPath $Source) { Copy-Item -LiteralPath $Source -Destination $SystemStage -Recurse -Force }
}

if (Test-Path $Zip) { Remove-Item -LiteralPath $Zip -Force }
Compress-Archive -Path (Join-Path $SystemStage "*") -DestinationPath $Zip -CompressionLevel Optimal

if ($UpdatePacks) {
    $LivePacks = Join-Path $Root "packs"
    New-Item -ItemType Directory -Path $LivePacks -Force | Out-Null
    # 새 팩을 먼저 LivePacks 내부의 임시 디렉터리에 완전히 복사·검증한다. 이후의
    # Move-Item은 같은 볼륨에서 디렉터리 이름만 바꾸므로, 기존 팩을 먼저 지우고
    # 복사하다 실패하는 데이터 손상 경로를 피할 수 있다.
    $Transaction = Join-Path $LivePacks (".dx3rd-pack-update-" + $PID)
    $Incoming = Join-Path $Transaction "incoming"
    $Backup = Join-Path $Transaction "backup"
    $Replaced = @()
    New-Item -ItemType Directory -Path $Incoming -Force | Out-Null
    New-Item -ItemType Directory -Path $Backup -Force | Out-Null

    try {
        # system.json에 선언된 팩만 대상으로 한다. 구 버전/로컬 작업용 미선언 팩은
        # 건드리지 않는다.
        foreach ($Pack in $Manifest.packs) {
            $Name = $Pack.name
            $Source = Join-Path $SystemStage (Join-Path "packs" $Name)
            if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
                throw "Built pack is missing: $Name"
            }
            $Target = Join-Path $Incoming $Name
            Copy-Item -LiteralPath $Source -Destination $Target -Recurse -Force
            $Count = Test-Dx3rdPackDirectory -Path $Target -Name $Name
            Write-Host "DX3rd | staged pack verified: $Name ($Count LevelDB files)"
        }

        foreach ($Pack in $Manifest.packs) {
            $Name = $Pack.name
            $Destination = Join-Path $LivePacks $Name
            $Saved = Join-Path $Backup $Name
            $Entry = [PSCustomObject]@{
                Name = $Name
                Destination = $Destination
                Saved = $Saved
                HadOriginal = Test-Path -LiteralPath $Destination
            }
            # 원본을 옮긴 직후 오류가 나도 이 목록을 기준으로 반드시 원복한다.
            $Replaced += $Entry
            if ($Entry.HadOriginal) { Move-Item -LiteralPath $Destination -Destination $Saved -Force }
            Move-Item -LiteralPath (Join-Path $Incoming $Name) -Destination $Destination -Force
            Test-Dx3rdPackDirectory -Path $Destination -Name $Name | Out-Null
        }
    } catch {
        $UpdateError = $_
        Write-Warning "DX3rd | pack update failed; restoring previous packs."
        $RollbackErrors = @()
        for ($Index = $Replaced.Count - 1; $Index -ge 0; $Index--) {
            $Entry = $Replaced[$Index]
            try {
                if (Test-Path -LiteralPath $Entry.Destination) {
                    Remove-Item -LiteralPath $Entry.Destination -Recurse -Force
                }
                if ($Entry.HadOriginal -and (Test-Path -LiteralPath $Entry.Saved)) {
                    Move-Item -LiteralPath $Entry.Saved -Destination $Entry.Destination -Force
                }
            } catch {
                $RollbackErrors += "$($Entry.Name): $($_.Exception.Message)"
            }
        }
        if ($RollbackErrors.Count) {
            throw "Pack update failed and rollback was incomplete: $($RollbackErrors -join '; ') Original error: $($UpdateError.Exception.Message)"
        }
        throw "Pack update failed; previous packs were restored. Original error: $($UpdateError.Exception.Message)"
    } finally {
        if (Test-Path -LiteralPath $Transaction) {
            Remove-Item -LiteralPath $Transaction -Recurse -Force
        }
    }
    Write-Host "DX3rd | updated committed pack output safely: $LivePacks"
}

Remove-Item -LiteralPath $Stage -Recurse -Force

Write-Host "DX3rd | release created: $Zip"
