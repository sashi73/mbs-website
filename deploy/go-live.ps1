# Sends what is on the TEST site to the LIVE site mbsplc.com.au.
# Runs in the PROD folder C:\Workzone\2026\MBSFIXITVER21, which stays on branch MBS-FixIT-ver-21 the whole time:
# it brings in branch MBS-FixIT-test from GitHub and pushes the live branch.
# Only run this after checking the version on the test site.
# Run from PowerShell:
#   cd C:\Workzone\2026\MBSFIXITVER21
#   powershell -ExecutionPolicy Bypass -File .\deploy\go-live.ps1
$ErrorActionPreference = 'Continue'   # git writes normal messages to stderr; we check each step ourselves
$repo = 'C:\Workzone\2026\MBSFIXITVER21'
$test = 'MBS-FixIT-test'
$live = 'MBS-FixIT-ver-21'
Set-Location $repo

$now = (git branch --show-current)
if ($now -ne $live) { Write-Host "The PROD folder is on '$now', not $live. Run:  git checkout $live  and try again." -ForegroundColor Red; exit 1 }
if (git status --porcelain --untracked-files=no) { Write-Host "The PROD folder has changes that aren't committed. Commit them first." -ForegroundColor Red; exit 1 }

git pull --no-edit origin $live
git fetch origin $test
if ($LASTEXITCODE -ne 0) { Write-Host "Could not get $test from GitHub." -ForegroundColor Red; exit 1 }
$ver = (git show "origin/$($test):version.txt" 2>$null | Select-Object -First 1)
Write-Host "This publishes the TEST version to the LIVE website mbsplc.com.au:" -ForegroundColor Yellow
Write-Host "   $ver"
$ok = Read-Host "Type LIVE to go ahead"
if ($ok -ne 'LIVE') { Write-Host "Stopped. Nothing changed."; exit 0 }

git merge "origin/$test" --no-edit
if ($LASTEXITCODE -ne 0) {
  git merge --abort
  Write-Host "The merge stopped with a conflict, so I undid it. Nothing was pushed. Ask for help." -ForegroundColor Red
  exit 1
}
git push origin $live
if ($LASTEXITCODE -ne 0) { Write-Host "Push failed. Check the message above." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Done. The live site is updating (1-2 minutes). Then open mbsplc.com.au and press Ctrl+F5." -ForegroundColor Green
