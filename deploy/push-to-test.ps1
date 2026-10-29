# Puts a new MBS version on the TEST site.
# TEST folder C:\Workzone\2026\FIXITVER1, branch MBS-FixIT-test, site mbs-fixit-test.netlify.app
# Run from PowerShell:
#   cd C:\Workzone\2026\FIXITVER1
#   powershell -ExecutionPolicy Bypass -File .\deploy\push-to-test.ps1 -Version v33 -Message "what changed"
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$Message = ""
)
$ErrorActionPreference = 'Continue'   # git writes normal messages to stderr; we check each step ourselves
$repo = 'C:\Workzone\2026\FIXITVER1'
$branch = 'MBS-FixIT-test'
if ($Version -notmatch '^v') { $Version = 'v' + $Version }
$zip = Join-Path $env:USERPROFILE "Downloads\MBS_Website_$Version.zip"
$tmp = Join-Path $env:TEMP ("mbstest" + $Version.TrimStart('v'))

Set-Location $repo
if (-not (Test-Path $zip)) { Write-Host "Can't find $zip. Download it first." -ForegroundColor Red; exit 1 }
$now = (git branch --show-current)
if ($now -ne $branch) {
  git checkout $branch
  if ($LASTEXITCODE -ne 0) { Write-Host "This folder is on '$now', not $branch, and I couldn't switch. Stopped." -ForegroundColor Red; exit 1 }
}
git pull --no-edit origin $branch

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp -Force -ErrorAction Stop
Copy-Item -Path (Join-Path $tmp "MBS_Website_$Version\*") -Destination . -Recurse -Force -ErrorAction Stop

if ($Message -eq '') { $Message = "$Version on the test site" }
git add -A
git commit -m "$Version`: $Message"
if ($LASTEXITCODE -ne 0) { Write-Host "Nothing new to commit." -ForegroundColor Yellow }
git push origin $branch
if ($LASTEXITCODE -ne 0) { Write-Host "Push failed. Check the message above." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Done. $Version is on its way to the TEST site." -ForegroundColor Green
Write-Host "Netlify takes 1-2 minutes. Then open https://mbs-fixit-test.netlify.app and press Ctrl+F5."
