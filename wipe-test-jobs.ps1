# Clears all TEST jobs from the live MBS job tracker (Netlify Blobs store "mbs-jobs"):
# jobs, job index, job-number counter (next enquiry starts again at ...-000001), reminders, weekly-report marker, customer photos.
# The visitor counter (store "mbs-visits") is NOT touched.
# A backup of everything is saved first, OUTSIDE your git folder, so it never gets pushed.
#
# Run:  powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\wipe-test-jobs.ps1"

$repo = 'C:\Workzone\2026\MBSFIXITVER21'
$store = 'mbs-jobs'
Set-Location $repo

# 1. list what is there
$raw = (netlify.cmd blobs:list $store --json 2>$null) -join "`n"
try { $list = $raw | ConvertFrom-Json } catch { Write-Host 'Could not read the job store. Run "netlify.cmd login" and "netlify.cmd link" (pick mbsch), then try again.' -ForegroundColor Red; exit 1 }
$keys = @($list.blobs | ForEach-Object { $_.key })
if ($keys.Count -eq 0) { Write-Host 'The job store is already empty. Nothing to do.' -ForegroundColor Green; exit 0 }

$jobs   = @($keys | Where-Object { $_ -like 'job:*' }).Count
$photos = @($keys | Where-Object { $_ -like 'photo:*' }).Count
Write-Host ''
Write-Host "Found $($keys.Count) items: $jobs jobs, $photos photos, plus index / counter / reminders." -ForegroundColor Cyan

# 2. backup (outside the git folder)
$backup = "C:\Workzone\2026\MBS-jobs-backup-" + (Get-Date -Format 'yyyyMMdd-HHmm')
New-Item -ItemType Directory -Path $backup -Force | Out-Null
foreach ($k in $keys) {
  $file = Join-Path $backup (($k -replace '[:\\/*?"<>|]', '_') + $(if ($k -like 'photo:*') { '.jpg' } else { '.json' }))
  netlify.cmd blobs:get $store $k --output $file 2>$null | Out-Null
}
$saved = @(Get-ChildItem $backup -File).Count
Write-Host "Backup saved: $saved files in $backup" -ForegroundColor Cyan
if ($saved -lt $keys.Count) { Write-Host 'WARNING: not everything was backed up. Stopping, nothing deleted.' -ForegroundColor Red; exit 1 }

# 3. confirm
Write-Host ''
Write-Host 'This permanently deletes ALL jobs, photos and reminders from the LIVE site, and restarts job numbers at 000001.' -ForegroundColor Yellow
$answer = Read-Host 'Type DELETE (in capitals) to continue, or anything else to stop'
if ($answer -cne 'DELETE') { Write-Host 'Stopped. Nothing was deleted.' -ForegroundColor Green; exit 0 }

# 4. delete
$n = 0
foreach ($k in $keys) {
  netlify.cmd blobs:delete $store $k --force 2>$null | Out-Null
  $n++
  Write-Progress -Activity 'Deleting test jobs' -Status $k -PercentComplete ($n / $keys.Count * 100)
}
Write-Progress -Activity 'Deleting test jobs' -Completed

# 5. check
$left = @(((netlify.cmd blobs:list $store --json 2>$null) -join "`n" | ConvertFrom-Json).blobs)
if ($left.Count -eq 0) {
  Write-Host ''
  Write-Host 'Done. The job tracker is empty and the next enquiry will be ...-000001.' -ForegroundColor Green
  Write-Host 'Visitor counter untouched. Backup kept in:' $backup -ForegroundColor Green
} else {
  Write-Host "$($left.Count) items are still there. Run the script again." -ForegroundColor Yellow
}
