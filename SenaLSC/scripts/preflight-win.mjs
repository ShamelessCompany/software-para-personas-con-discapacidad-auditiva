import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  SELF_TEST_PROTOCOL_VERSION,
  SELF_TEST_TIMEOUT_MS,
  parseSelfTestOutput,
  sha256,
  validateManifest,
  validatePeX64,
} from "./preflight-win-lib.mjs";

const sidecarPath = "sidecar-bin/senalsc-asr.exe";
const manifestPath = "sidecar-bin/senalsc-asr.manifest.json";

function fail(message) {
  console.error([
    `No se puede crear el paquete Windows completo: ${message}`,
    "Genere el sidecar en Windows con ./sidecar/build-windows.ps1 y vuelva a ejecutar npm run package:win.",
    "Para una interfaz portable rotulada sin reconocimiento real, use npm run package:win:demo.",
  ].join("\n"));
  process.exit(1);
}

try {
  if (process.platform !== "win32") {
    fail("el paquete ASR real solo puede construirse y validarse en Windows. Use npm run package:win:demo en Linux o construya el ASR en Windows");
  }

  const [buffer, fileInfo, rawManifest] = await Promise.all([
    readFile(sidecarPath),
    stat(sidecarPath),
    readFile(manifestPath, "utf8"),
  ]);
  const peError = validatePeX64(buffer);
  if (peError) fail(peError);

  const manifest = JSON.parse(rawManifest.replace(/^\uFEFF/, ""));
  const fileSha256 = sha256(buffer);
  if (!validateManifest(manifest, fileInfo.size, fileSha256)) fail(`el manifiesto ${manifestPath} no coincide con el ejecutable o su self-test`);

  const selfTest = spawnSync(sidecarPath, ["--self-test"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: SELF_TEST_TIMEOUT_MS,
  });
  if (selfTest.error || selfTest.status !== 0) fail("el self-test obligatorio del sidecar no terminó correctamente");
  const selfTestPayload = parseSelfTestOutput(selfTest.stdout);
  if (!selfTestPayload || manifest.selfTest.protocolVersion !== selfTestPayload.protocolVersion) {
    fail("el self-test obligatorio no devolvió el JSON exacto o no coincide con el manifiesto");
  }
  console.log(`Preflight Windows correcto: PE x64, manifiesto SHA-256 y self-test ASR v${SELF_TEST_PROTOCOL_VERSION} verificados.`);
} catch (caught) {
  if (caught instanceof SyntaxError) fail(`el manifiesto ${manifestPath} no contiene JSON válido`);
  const code = caught && typeof caught === "object" && "code" in caught ? caught.code : null;
  if (code === "ENOENT") fail(`falta ${sidecarPath} o ${manifestPath}`);
  fail(caught instanceof Error ? caught.message : "no se pudo validar el sidecar");
}
