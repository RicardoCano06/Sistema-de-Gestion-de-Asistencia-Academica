# Arranca backend + frontend y muestra la URL para el celular (misma Wi‑Fi).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $root '.env'))) {
    Write-Host ''
    Write-Host '  AVISO: no hay .env en la raíz del repo (backend necesita Supabase/JWT).' -ForegroundColor Yellow
    Write-Host ''
}

node (Join-Path $PSScriptRoot 'print-mobile-dev-urls.mjs')

Write-Host '  Abriendo dos ventanas: backend (:4000) y frontend (:5173)...' -ForegroundColor Cyan
Write-Host ''

Start-Process powershell -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location -LiteralPath '$root'; Write-Host 'Backend API :4000' -ForegroundColor Green; npm run dev"
)

Start-Sleep -Seconds 2

Start-Process powershell -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location -LiteralPath (Join-Path '$root' 'frontend'); Write-Host 'Frontend Vite :5173 (red local)' -ForegroundColor Green; npm run dev"
)
