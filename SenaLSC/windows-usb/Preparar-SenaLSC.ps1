[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Version = "0.1.0"
$PackageRoot = $PSScriptRoot
$InstallRoot = Join-Path $env:LOCALAPPDATA "SenaLSC\Windows-USB-Candidato-$Version"

function Assert-WindowsX64 {
  if ($env:OS -ne "Windows_NT") { throw "Este paquete solo se prepara en Windows." }
  if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
    throw "Se requiere Windows x64. Windows ARM64 y x86 no están soportados por este candidato."
  }
}

function Resolve-PackageFile([string]$RelativePath) {
  if ([IO.Path]::IsPathRooted($RelativePath) -or $RelativePath -split '[\\/]' -contains '..') {
    throw "SHA256SUMS contiene una ruta no segura: $RelativePath"
  }
  $Root = [IO.Path]::GetFullPath($PackageRoot + [IO.Path]::DirectorySeparatorChar)
  $Candidate = [IO.Path]::GetFullPath((Join-Path $PackageRoot $RelativePath))
  if (-not $Candidate.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { throw "Ruta fuera del paquete: $RelativePath" }
  return $Candidate
}

function Test-PackageHashes {
  $Sums = Join-Path $PackageRoot "SHA256SUMS.txt"
  if (-not (Test-Path -LiteralPath $Sums -PathType Leaf)) { throw "Falta SHA256SUMS.txt." }
  foreach ($Line in Get-Content -LiteralPath $Sums) {
    if (-not $Line.Trim()) { continue }
    if ($Line -notmatch '^(?<Hash>[0-9a-fA-F]{64})  (?<Path>.+)$') { throw "Línea no válida en SHA256SUMS.txt: $Line" }
    $File = Resolve-PackageFile $Matches.Path
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "Falta el archivo requerido: $($Matches.Path)" }
    $Actual = (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash
    if ($Actual -ne $Matches.Hash) { throw "Hash incorrecto: $($Matches.Path). Vuelva a copiar o extraer el ZIP." }
  }
}

function Test-Sidecar([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  $Output = & $Path --self-test
  if ($LASTEXITCODE -ne 0) { return $false }
  try { $Payload = $Output | ConvertFrom-Json } catch { return $false }
  return $Payload.type -eq "self-test" -and $Payload.status -eq "ok" -and $Payload.protocolVersion -eq 1 -and $Payload.engine -eq "vosk"
}

Assert-WindowsX64
Write-Host "Verificando archivos y hashes del CANDIDATO NO VALIDADO EN WINDOWS..."
Test-PackageHashes

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
Copy-Item -LiteralPath (Join-Path $PackageRoot "Aplicacion\SenaLSC-Windows-Candidato-NoValidado-0.1.0-x64.exe") -Destination $InstallRoot -Force
Remove-Item -LiteralPath (Join-Path $InstallRoot "modelo") -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $InstallRoot "sidecar-source") -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath (Join-Path $PackageRoot "modelo") -Destination $InstallRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PackageRoot "sidecar-source") -Destination $InstallRoot -Recurse -Force

$Sidecar = Join-Path $InstallRoot "sidecar-bin\senalsc-asr.exe"
if (-not (Test-Sidecar $Sidecar)) {
  $Py = Get-Command py -ErrorAction SilentlyContinue
  if (-not $Py) {
    $Winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($Winget) {
      $Answer = Read-Host "Falta Python 3.12. ¿Desea ejecutar 'winget install --id Python.Python.3.12 -e'? [s/N]"
      if ($Answer -match '^[sS]$') {
        & winget install --id Python.Python.3.12 -e
        if ($LASTEXITCODE -ne 0) { throw "winget no pudo instalar Python 3.12." }
      } else {
        throw "Instale Python con: winget install --id Python.Python.3.12 -e"
      }
    } else {
      Start-Process "https://www.python.org/downloads/windows/"
      throw "Instale Python 3.12 x64 desde python.org y vuelva a ejecutar Preparar-SenaLSC.ps1."
    }
  }
  & py -3.12 -c "import sys; assert sys.version_info[:2] == (3, 12)"
  if ($LASTEXITCODE -ne 0) { throw "No está disponible Python 3.12 mediante 'py -3.12'. Instálelo con: winget install --id Python.Python.3.12 -e" }
  & (Join-Path $InstallRoot "sidecar-source\build-windows.ps1")
  if (-not (Test-Sidecar $Sidecar)) { throw "El sidecar se compiló, pero su self-test obligatorio falló." }
}

Write-Host "Preparación terminada en: $InstallRoot"
Write-Host "CANDIDATO NO VALIDADO EN WINDOWS: ejecute Iniciar-SenaLSC.ps1 y complete la prueba de micrófono."
