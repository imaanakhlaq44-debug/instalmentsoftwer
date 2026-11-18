# One-time setup: puts the shop app's Google Play upload key into the
# repository's GitHub secrets, so the "Build shop app" workflow can sign the
# Play bundle by itself. Run it on the computer that holds the key:
#
#   powershell -ExecutionPolicy Bypass -File android\set-shop-signing-secrets.ps1
#
# Nothing is printed: the key and its password go straight to `gh secret set`.
$ErrorActionPreference = 'Stop'
$folder = Join-Path $env:LOCALAPPDATA 'ALMAS-SDM\shop-signing'
$settings = Get-Content (Join-Path $folder 'signing.json') -Raw | ConvertFrom-Json
$keystore = Join-Path $folder 'almas-shop-upload.p12'
if (-not (Test-Path $keystore)) { throw "Shop upload key not found at $keystore" }

[Convert]::ToBase64String([IO.File]::ReadAllBytes($keystore)) | gh secret set ALMAS_SHOP_UPLOAD_KEYSTORE_BASE64
$settings.storePassword | gh secret set ALMAS_SHOP_UPLOAD_PASSWORD
$settings.keyAlias | gh secret set ALMAS_SHOP_UPLOAD_ALIAS

gh secret list | Select-String 'ALMAS_SHOP_UPLOAD'
Write-Host 'Done. The Build shop app workflow now signs the Play bundle automatically.'
