[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Version = "0.1.0"
$InstallRoot = Join-Path $env:LOCALAPPDATA "SenaLSC\Windows-USB-Candidato-$Version"
$App = Join-Path $InstallRoot "SenaLSC-Windows-Candidato-NoValidado-0.1.0-x64.exe"
$Sidecar = Join-Path $InstallRoot "sidecar-bin\senalsc-asr.exe"
$Model = Join-Path $InstallRoot "modelo\vosk-model-small-es-0.42"
$LargeModel = Join-Path $InstallRoot "modelo\vosk-model-es-0.42"

if ($env:OS -ne "Windows_NT" -or [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
  throw "Se requiere Windows x64."
}
foreach ($File in @($App, $Sidecar, (Join-Path $Model "am\final.mdl"), (Join-Path $Model "conf\model.conf"), (Join-Path $Model "graph\HCLr.fst"))) {
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { throw "Preparación incompleta. Falta: $File. Ejecute primero Preparar-SenaLSC.ps1." }
}

$SelfTestOutput = & $Sidecar --self-test
if ($LASTEXITCODE -ne 0) { throw "El self-test del sidecar falló. Ejecute de nuevo Preparar-SenaLSC.ps1." }
try { $SelfTest = $SelfTestOutput | ConvertFrom-Json } catch { throw "El sidecar devolvió un self-test no válido." }
if ($SelfTest.type -ne "self-test" -or $SelfTest.status -ne "ok" -or $SelfTest.protocolVersion -ne 1 -or $SelfTest.engine -ne "vosk") {
  throw "El contrato del self-test del sidecar no coincide con SenaLSC 0.1.0."
}

$env:SENA_LSC_SIDECAR_PATH = (Resolve-Path -LiteralPath $Sidecar).Path
$env:SENA_LSC_MODEL_PATH = (Resolve-Path -LiteralPath $Model).Path
if (Test-Path -LiteralPath (Join-Path $LargeModel "am\final.mdl") -PathType Leaf) {
  $env:SENA_LSC_LARGE_MODEL_PATH = (Resolve-Path -LiteralPath $LargeModel).Path
} else {
  Remove-Item Env:SENA_LSC_LARGE_MODEL_PATH -ErrorAction SilentlyContinue
}

Write-Host "Iniciando CANDIDATO NO VALIDADO EN WINDOWS con sidecar y modelo externos verificados..."
Start-Process -FilePath $App -WorkingDirectory $InstallRoot
