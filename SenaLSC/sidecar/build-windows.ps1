$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $Root ".venv-sidecar-win"
$BuildRoot = Join-Path $Root ".build-sidecar-win"
if ($env:OS -ne "Windows_NT") { throw "El sidecar ASR solo puede compilarse y validarse en Windows." }
if (-not [Environment]::Is64BitOperatingSystem) { throw "El sidecar ASR requiere Windows x64." }
$ManifestPath = Join-Path $Root "sidecar-bin\senalsc-asr.manifest.json"
Remove-Item $ManifestPath -Force -ErrorAction SilentlyContinue
py -3.12 -m venv $Venv
& "$Venv\Scripts\python.exe" -m pip install -r "$PSScriptRoot\requirements-build.txt"
Remove-Item $BuildRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
& "$Venv\Scripts\pyinstaller.exe" --onefile --name senalsc-asr --distpath "$BuildRoot\dist" --workpath "$BuildRoot\work" --specpath "$BuildRoot" "$PSScriptRoot\asr.py"
New-Item -ItemType Directory -Force -Path "$Root\sidecar-bin" | Out-Null
Copy-Item "$BuildRoot\dist\senalsc-asr.exe" "$Root\sidecar-bin\senalsc-asr.exe" -Force
$Sidecar = Get-Item "$Root\sidecar-bin\senalsc-asr.exe"
$ProcessInfo = [System.Diagnostics.ProcessStartInfo]::new()
$ProcessInfo.FileName = $Sidecar.FullName
$ProcessInfo.Arguments = "--self-test"
$ProcessInfo.UseShellExecute = $false
$ProcessInfo.RedirectStandardOutput = $true
$ProcessInfo.RedirectStandardError = $true
$ProcessInfo.CreateNoWindow = $true
$SelfTestProcess = [System.Diagnostics.Process]::new()
$SelfTestProcess.StartInfo = $ProcessInfo
if (-not $SelfTestProcess.Start()) { throw "No se pudo iniciar el self-test del sidecar." }
if (-not $SelfTestProcess.WaitForExit(10000)) {
  $SelfTestProcess.Kill($true)
  throw "El self-test del sidecar excedió 10 segundos."
}
$SelfTestOutput = $SelfTestProcess.StandardOutput.ReadToEnd().Trim()
$SelfTestError = $SelfTestProcess.StandardError.ReadToEnd().Trim()
if ($SelfTestProcess.ExitCode -ne 0) { throw "El self-test del sidecar falló con código $($SelfTestProcess.ExitCode): $SelfTestError" }
if ($SelfTestOutput.Contains("`n") -or $SelfTestOutput.Contains("`r")) { throw "El self-test del sidecar devolvió más de una línea." }
try { $SelfTest = $SelfTestOutput | ConvertFrom-Json } catch { throw "El self-test del sidecar no devolvió JSON válido." }
$SelfTestKeys = @($SelfTest.PSObject.Properties.Name)
if (
  $SelfTestKeys.Count -ne 4 -or
  $SelfTest.type -ne "self-test" -or
  $SelfTest.status -ne "ok" -or
  $SelfTest.protocolVersion -ne 1 -or
  $SelfTest.engine -ne "vosk"
) { throw "El self-test del sidecar no devolvió el contrato exacto esperado." }
$Hash = (Get-FileHash $Sidecar.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$Manifest = [ordered]@{
  formatVersion = 2
  file = "senalsc-asr.exe"
  platform = "win32"
  architecture = "x64"
  size = $Sidecar.Length
  sha256 = $Hash
  selfTest = [ordered]@{
    status = "passed"
    protocolVersion = 1
  }
}
$Manifest | ConvertTo-Json | Set-Content $ManifestPath -Encoding utf8
Write-Host "Sidecar validado por ejecución y manifiesto creados en sidecar-bin\"
