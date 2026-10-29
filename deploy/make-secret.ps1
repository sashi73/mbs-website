# Makes a strong random secret and puts it on the clipboard (it is not shown on screen).
# Paste it straight into Netlify with Ctrl+V. Never paste it into chat, email or a file.
# Run from PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\deploy\make-secret.ps1
$bytes = New-Object byte[] 30
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = ([Convert]::ToBase64String($bytes)) -replace '[+/=]', ''
$secret = 'mbs-' + $secret
Set-Clipboard -Value $secret
Write-Host "A new $($secret.Length)-character secret is on your clipboard. Paste it into Netlify with Ctrl+V." -ForegroundColor Green
