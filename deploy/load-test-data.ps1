# Loads the made-up TEST data into the TEST site: 150 enquiries (Sydney, Western Sydney and surrounding areas),
# 50 suppliers and 150 stock items with six months of stock movements. Anything already loaded is skipped.
# TEST SITE ONLY: it refuses to run against a site without the TEST SITE bar.
# No emails or Telegram alerts are sent. The password you type is not shown and not saved.
# Run from PowerShell:
#   cd C:\Workzone\2026\FIXITVER1
#   powershell -ExecutionPolicy Bypass -File .\deploy\load-test-data.ps1
# Add -What enquiries (or inventory) to load only that part; -Again to load a second copy.
param(
  [string]$Site = "https://fixittest.netlify.app",
  [ValidateSet('all', 'enquiries', 'inventory')][string]$What = 'all',
  [switch]$Again
)
$repo = 'C:\Workzone\2026\FIXITVER1'
if (-not (Test-Path (Join-Path $repo 'tools\load-test-data.mjs'))) { Write-Host "Can't find tools\load-test-data.mjs in $repo. Put v33 on the test site first (push-to-test.ps1)." -ForegroundColor Red; exit 1 }
Set-Location $repo

Write-Host ""
Write-Host "This adds TEST data ($($What)) (150 enquiries, 50 suppliers, 150 stock items) to $Site" -ForegroundColor Yellow
$ok = Read-Host "Type TEST to continue"
if ($ok -ne 'TEST') { Write-Host "Stopped. Nothing was loaded." -ForegroundColor Yellow; exit 0 }

$user = Read-Host "TEST console username"
$sec = Read-Host "TEST console password" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
  $env:MBS_LOAD_USER = $user
  $env:MBS_LOAD_PASS = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $nodeArgs = @('tools/load-test-data.mjs', '--site', $Site, '--what', $What)
  if ($Again) { $nodeArgs += '--again' }
  node @nodeArgs
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  Remove-Item Env:MBS_LOAD_USER, Env:MBS_LOAD_PASS -ErrorAction SilentlyContinue
}
