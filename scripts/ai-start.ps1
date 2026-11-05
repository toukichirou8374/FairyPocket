# FairyPocket AI brain: started at Windows sign-in by the "FairyPocket AI" shortcut in the Startup folder.
# (Kept in English/ASCII because Windows PowerShell 5.1 misreads UTF-8 scripts without a BOM.)
# 1. Ollama on 127.0.0.1:11434 only (skipped if Ollama's own tray app already started it)
# 2. Relay scripts/ai-proxy.mjs on 127.0.0.1:11435 only (target of `tailscale serve`)
# Changes no Tailscale, firewall, or other settings.

$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $env:LOCALAPPDATA 'FairyPocketAI.log'

function Listening([int]$port) {
  return [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

Add-Content -Path $log -Value "$(Get-Date -Format s) start"

# Give Ollama's tray app a chance to start its server first
if (-not $env:FAIRYPOCKET_AI_NOWAIT) { Start-Sleep -Seconds 25 }
if (-not (Listening 11434)) {
  $env:OLLAMA_HOST = '127.0.0.1:11434'
  $env:OLLAMA_ORIGINS = [Environment]::GetEnvironmentVariable('OLLAMA_ORIGINS', 'User')
  $env:OLLAMA_KEEP_ALIVE = '30m'
  Start-Process (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe') -ArgumentList 'serve' -WindowStyle Hidden
  Add-Content -Path $log -Value "$(Get-Date -Format s) started ollama serve"
}

if (-not (Listening 11435)) {
  Start-Process 'node' -ArgumentList ('"' + (Join-Path $root 'scripts\ai-proxy.mjs') + '"') -WindowStyle Hidden
  Add-Content -Path $log -Value "$(Get-Date -Format s) started relay"
}
