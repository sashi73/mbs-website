# After an urgent fix went straight to the LIVE site (from the Prod chat), bring it into the TEST branch too,
# so the next test version doesn't undo it.
# Runs in the TEST folder C:\Workzone\2026\FIXITVER1.
# Run from PowerShell:
#   cd C:\Workzone\2026\FIXITVER1
#   powershell -ExecutionPolicy Bypass -File .\deploy\sync-test-from-live.ps1
$ErrorActionPreference = 'Continue'
$repo = 'C:\Workzone\2026\FIXITVER1'
$test = 'MBS-FixIT-test'
$live = 'MBS-FixIT-ver-21'
Set-Location $repo

$now = (git branch --show-current)
if ($now -ne $test) { Write-Host "The TEST folder is on '$now', not $test. Run:  git checkout $test  and try again." -ForegroundColor Red; exit 1 }
if (git status --porcelain --untracked-files=no) { Write-Host "The TEST folder has changes that aren't committed. Commit them first." -ForegroundColor Red; exit 1 }

git pull --no-edit origin $test
git fetch origin $live
git merge "origin/$live" --no-edit
if ($LASTEXITCODE -ne 0) {
  git merge --abort
  Write-Host "The live fix clashes with test changes, so I undid the merge. Nothing was pushed. Ask for help." -ForegroundColor Red
  exit 1
}
git push origin $test
if ($LASTEXITCODE -ne 0) { Write-Host "Push failed. Check the message above." -ForegroundColor Red; exit 1 }
Write-Host "Done. The test branch now has everything that is live, plus the test work." -ForegroundColor Green
