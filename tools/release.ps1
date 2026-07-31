<#
Rebuild the LevelDB compendium packs from the private _source CSV pipeline.

  powershell -ExecutionPolicy Bypass -File tools/release.ps1 -UpdatePacks   # Foundry 종료 필수

This is a **manual bulk-reshaping tool only**. Commits do not rebuild anything and
`packs/` is the source of truth for compendium content; ordinary work (adding
missing data, fixing values) is done inside Foundry and committed with
`git add packs`. This script is the one path that overwrites that source of truth
with generated output, so it recovers Foundry-side edits into _source first --
and even so, anything _source cannot express, above all documents created inside
Foundry, is lost here. See CLAUDE.md, "컴펜디움 릴리즈".

-UpdatePacks is required. There used to be a bare-invocation "preview zip" mode,
and it was removed rather than fixed: the preview was no longer a preview of
anything (CI builds the public zip from the committed packs/, not from _source),
while it still ran the generators -- and `_source/build-core-character-data.mjs`
writes `works`/`syndromes` straight into the live packs/ regardless of --output.
That made an apparently read-only local build silently overwrite two committed
packs that the recovery step cannot restore, with no Foundry-close guard in front
of it. It also consumed the recovery baseline (_source/pack-*), leaving the repo
in a state whose only exit was this very command. Do not reintroduce a mode that
calls the generators without replacing packs/.
#>
[CmdletBinding()]
param(
    [string]$OutputDirectory = "dist",
    # Replace ./packs with freshly generated output. Required -- see above.
    [switch]$UpdatePacks
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

if (-not $UpdatePacks) {
    throw "tools/release.ps1 rebuilds the compendium packs and needs -UpdatePacks stated explicitly. (The old preview-zip mode is gone: CI builds the release zip from the committed packs/.) For ordinary edits, change the data in Foundry and 'git add packs'."
}

# Windows PowerShell 5.1 defaults to the active ANSI codepage for UTF-8 files
# without a BOM. system.json contains Korean labels, so always state UTF-8.
$Manifest = Get-Content (Join-Path $Root "system.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Dist = Join-Path $Root $OutputDirectory
$Stage = Join-Path $Dist "staging"
$BuildOutput = Join-Path $Stage "packs"

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

# Replacing a package's LevelDB directories while Foundry has them open can leave
# the running world with stale handles, so fail early rather than writing corrupt
# packs. The generators reach the live packs/ too (build-core-character-data.mjs
# writes works/syndromes there directly), so this guard must precede them, not
# just the Move-Item transaction below.
$FoundryProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match "foundry" })
if ($FoundryProcesses.Count -gt 0) {
    $Names = ($FoundryProcesses | ForEach-Object { "$($_.ProcessName) ($($_.Id))" }) -join ", "
    throw "Close Foundry before updating committed packs. Detected: $Names"
}

if (Test-Path $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Path $BuildOutput -Force | Out-Null

# Recover Foundry-side edits into _source BEFORE the generators run.
#
# `packs/` is the source of truth for compendium content now; this script is the one
# path that overwrites it from the CSV pipeline. So the recovery belongs here rather
# than in the commit hook -- whoever reaches a rebuild, by any route, passes this line.
#
# It must precede the generator call below. The obvious reason: the pack directories
# are replaced wholesale, so unrecovered edits are simply gone. The subtle one: the
# recovery's baseline IS the previous build output still sitting in _source/pack-*,
# and `--generate` overwrites exactly that. Regenerating first would make legitimate
# _source edits look like pack hand-tuning and pin the old values as overrides forever.
Write-Host "DX3rd | recovering Foundry-side pack edits into _source before rebuild"
& node (Join-Path $PSScriptRoot "recover-pack-edits.mjs") --all --write
$RecoverStatus = $LASTEXITCODE
if ($RecoverStatus -eq 3) {
    Write-Warning "DX3rd | pack recovery skipped: no LevelDB reader available (set FOUNDRY_APP_PATH to enable)."
} elseif ($RecoverStatus -eq 4) {
    throw "The recovery baseline no longer matches packs/ (a _source generator ran on its own). Hand-tuning and _source edits are indistinguishable in that state, so this rebuild stops rather than overwrite packs/."
} elseif ($RecoverStatus -ne 0) {
    throw "Pack recovery failed (exit $RecoverStatus); refusing to rebuild over edits that are not yet in _source."
}

# Private generators run first, then their JSON output is compiled into staging.
& node (Join-Path $PSScriptRoot "build-compendia.mjs") --generate --output $BuildOutput
if ($LASTEXITCODE -ne 0) { throw "Compendium build failed." }

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
        $Source = Join-Path $BuildOutput $Name
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

# packs/ 와 _source 의 빌드 산출 JSON 이 방금 일치했다. 그 사실을 해시로 남겨 두면
# 나중에 누가 생성기만 따로 돌렸는지 알 수 있고, recover-pack-edits 가 낡은 기준선으로
# 손튜닝을 오판하는 것을 막는다. 실패해도 릴리즈 자체를 깨뜨릴 이유는 없다.
& node (Join-Path $PSScriptRoot "recover-pack-edits.mjs") --stamp
if ($LASTEXITCODE -ne 0) { Write-Warning "DX3rd | baseline stamp failed; recover-pack-edits will warn until the next successful build." }

Remove-Item -LiteralPath $Stage -Recurse -Force

Write-Host "DX3rd | packs rebuilt. Review 'git status -- packs' before staging: this replaced every declared pack."
