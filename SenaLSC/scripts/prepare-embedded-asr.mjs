import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import extract from "@electron-internal/extract-zip";
import { x as extractTar } from "tar";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const CACHE_DIRECTORY = join(PROJECT_ROOT, "artifacts", "embedded-asr-downloads");
const RUNTIME_DIRECTORY = join(PROJECT_ROOT, "resources", "embedded-asr");
const SITE_PACKAGES = join(RUNTIME_DIRECTORY, "site-packages");
const MODEL_DIRECTORY = join(PROJECT_ROOT, "models", "vosk-model-small-es-0.42");

const SOURCES = [
  { name: "Python", version: "3.12.10", filename: "python-3.12.10-embed-amd64.zip", size: 11133606, sha256: "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3", url: "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip", type: "python" },
  { name: "vosk", version: "0.3.45", filename: "vosk-0.3.45-py3-none-win_amd64.whl", size: 13997596, sha256: "6994ddc68556c7e5730c3b6f6bad13320e3519b13ce3ed2aa25a86724e7c10ac", url: "https://files.pythonhosted.org/packages/c0/4c/deb0861f7da9696f8a255f1731bb73e9412cca29c4b3888a3fcb2a930a59/vosk-0.3.45-py3-none-win_amd64.whl", type: "wheel" },
  { name: "cffi", version: "2.1.1", filename: "cffi-2.1.1-cp312-cp312-win_amd64.whl", size: 185919, sha256: "f53e442b08449d42821fa4a4fba000095af9f62742a500f978a9f557ec44339a", url: "https://files.pythonhosted.org/packages/d9/79/615cc094e2fb508cade7de88d3b4f6c4ec2bab695c97bce9153dc65aadf5/cffi-2.1.1-cp312-cp312-win_amd64.whl", type: "wheel" },
  { name: "requests", version: "2.34.2", filename: "requests-2.34.2-py3-none-any.whl", size: 73075, sha256: "2a0d60c172f83ac6ab31e4554906c0f3b3588d37b5cb939b1c061f4907e278e0", url: "https://files.pythonhosted.org/packages/a0/f4/c67b0b3f1b9245e8d266f0f112c500d50e5b4e83cb6f3b71b6528104182a/requests-2.34.2-py3-none-any.whl", type: "wheel" },
  { name: "tqdm", version: "4.70.0", filename: "tqdm-4.70.0-py3-none-any.whl", size: 80184, sha256: "7f585706bfddbdebf89daac705b2dfcc16890130727d3197ca62c732b4310953", url: "https://files.pythonhosted.org/packages/f9/1c/01bfd571a64e7f270e6bab5e33777debe0edc56759233ce84f27dec92d14/tqdm-4.70.0-py3-none-any.whl", type: "wheel" },
  { name: "srt", version: "3.5.3", filename: "srt-3.5.3.tar.gz", size: 28296, sha256: "4884315043a4f0740fd1f878ed6caa376ac06d70e135f306a6dc44632eed0cc0", url: "https://files.pythonhosted.org/packages/66/b7/4a1bc231e0681ebf339337b0cd05b91dc6a0d701fa852bb812e244b7a030/srt-3.5.3.tar.gz", type: "sdist" },
  { name: "websockets", version: "17.1", filename: "websockets-17.1-cp312-cp312-win_amd64.whl", size: 217786, sha256: "617243e19a0992095956f406ee9cd3bc4ba92862d83cb1d83bb59ce574412bec", url: "https://files.pythonhosted.org/packages/50/23/493ecfdaf32898e5ea24dc900e33e5e317f9662d5d9ab2d44b2e111b4e1c/websockets-17.1-cp312-cp312-win_amd64.whl", type: "wheel" },
  { name: "pycparser", version: "3.0", filename: "pycparser-3.0-py3-none-any.whl", size: 48172, sha256: "b727414169a36b7d524c1c3e31839a521725078d7b2ff038656844266160a992", url: "https://files.pythonhosted.org/packages/0c/c3/44f3fbbfa403ea2a7c779186dc20772604442dde72947e7d01069cbe98e3/pycparser-3.0-py3-none-any.whl", type: "wheel" },
  { name: "charset-normalizer", version: "3.5.1", filename: "charset_normalizer-3.5.1-cp312-cp312-win_amd64.whl", size: 200551, sha256: "3617ac3cfd8b9888f145ad89dd6e692285834b0201c6074a5eeaad3fd4d668c2", url: "https://files.pythonhosted.org/packages/9d/7a/4c6c298171e6b3e745633180ff59350fc0ca0db1ffd28df1e369e0579f71/charset_normalizer-3.5.1-cp312-cp312-win_amd64.whl", type: "wheel" },
  { name: "idna", version: "3.19", filename: "idna-3.19-py3-none-any.whl", size: 68550, sha256: "815e7be7a7806d54abb586dc943addc79e8b2ee16915059658cbeff4b1b43bf4", url: "https://files.pythonhosted.org/packages/57/b0/0e52c878c53f245edd3a11020f20979b3f490f245af532c7cae3027754b5/idna-3.19-py3-none-any.whl", type: "wheel" },
  { name: "urllib3", version: "2.7.0", filename: "urllib3-2.7.0-py3-none-any.whl", size: 131087, sha256: "9fb4c81ebbb1ce9531cce37674bbc6f1360472bc18ca9a553ede278ef7276897", url: "https://files.pythonhosted.org/packages/7f/3e/5db95bcf282c52709639744ca2a8b149baccf648e39c8cc87553df9eae0c/urllib3-2.7.0-py3-none-any.whl", type: "wheel" },
  { name: "certifi", version: "2026.7.22", filename: "certifi-2026.7.22-py3-none-any.whl", size: 136983, sha256: "62f22742b58a1a33014a2b6b706588a8d7e2a88ae7bd1a6ebe8c992928483775", url: "https://files.pythonhosted.org/packages/0b/a7/71ac2cff56fec219ed242bb11b8efb69fcc4bec75db06fb7bfe35de520e6/certifi-2026.7.22-py3-none-any.whl", type: "wheel" },
  { name: "colorama", version: "0.4.6", filename: "colorama-0.4.6-py2.py3-none-any.whl", size: 25335, sha256: "4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6", url: "https://files.pythonhosted.org/packages/d1/d6/3965ed04c63042e047cb6a3e6ed1a63a35087b6a609aa3a15ed8ac56c221/colorama-0.4.6-py2.py3-none-any.whl", type: "wheel" },
];

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function download(source) {
  const destination = join(CACHE_DIRECTORY, source.filename);
  try {
    const current = await readFile(destination);
    if (current.length === source.size && digest(current) === source.sha256) return destination;
  } catch {
    // El archivo todavía no existe o está incompleto.
  }
  const response = await fetch(source.url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`No se pudo descargar ${source.name}: HTTP ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length !== source.size || digest(buffer) !== source.sha256) throw new Error(`Hash o tamaño no válido para ${source.filename}.`);
  await writeFile(destination, buffer);
  return destination;
}

async function listFiles(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...await listFiles(join(directory, entry.name), relative));
    else if (entry.isFile()) output.push(relative);
  }
  return output.sort();
}

async function treeSummary(directory) {
  const files = await listFiles(directory);
  const hash = createHash("sha256");
  let size = 0;
  for (const file of files) {
    const buffer = await readFile(join(directory, file));
    size += buffer.length;
    hash.update(file).update("\0").update(buffer).update("\0");
  }
  return { files: files.length, size, sha256: hash.digest("hex") };
}

await mkdir(CACHE_DIRECTORY, { recursive: true });
await rm(RUNTIME_DIRECTORY, { recursive: true, force: true });
await mkdir(SITE_PACKAGES, { recursive: true });

const downloads = new Map();
for (const source of SOURCES) downloads.set(source.filename, await download(source));

const python = SOURCES.find((source) => source.type === "python");
await extract(downloads.get(python.filename), { dir: RUNTIME_DIRECTORY });
await rm(join(RUNTIME_DIRECTORY, "python.exe"), { force: true });
for (const source of SOURCES.filter((entry) => entry.type === "wheel")) {
  await extract(downloads.get(source.filename), { dir: SITE_PACKAGES });
}
await rm(join(SITE_PACKAGES, "tqdm", "completion.sh"), { force: true });
const voskInitPath = join(SITE_PACKAGES, "vosk", "__init__.py");
const voskInit = await readFile(voskInitPath, "utf8");
const linuxModelDirectory = 'MODEL_DIRS = [os.getenv("VOSK_MODEL_PATH"), Path("/usr/share/vosk"),\n        Path.home() / "AppData/Local/vosk", Path.home() / ".cache/vosk"]';
const windowsModelDirectories = 'MODEL_DIRS = [os.getenv("VOSK_MODEL_PATH"),\n        Path.home() / "AppData/Local/vosk", Path.home() / ".cache/vosk"]';
if (!voskInit.includes(linuxModelDirectory)) throw new Error("No se encontró el fallback Linux esperado en Vosk; no se modificó el runtime.");
await writeFile(voskInitPath, voskInit.replace(linuxModelDirectory, windowsModelDirectories), "utf8");

const temporary = await mkdtemp(join(tmpdir(), "senalsc-srt-"));
try {
  const source = SOURCES.find((entry) => entry.type === "sdist");
  await extractTar({ file: downloads.get(source.filename), cwd: temporary, strict: true });
  const sourceRoot = join(temporary, `srt-${source.version}`);
  await cp(join(sourceRoot, "srt.py"), join(SITE_PACKAGES, "srt.py"));
  await mkdir(join(RUNTIME_DIRECTORY, "licenses"), { recursive: true });
  await cp(join(sourceRoot, "LICENSE"), join(RUNTIME_DIRECTORY, "licenses", "srt-LICENSE.txt"));
} finally {
  await rm(temporary, { recursive: true, force: true });
}

await writeFile(join(RUNTIME_DIRECTORY, "python312._pth"), "python312.zip\n.\nsite-packages\nimport site\n", "utf8");
const modelSummary = await treeSummary(MODEL_DIRECTORY);
const runtimeSummaryBeforeManifest = await treeSummary(RUNTIME_DIRECTORY);
const manifest = {
  formatVersion: 1,
  platform: "win32",
  architecture: "x64",
  python: { version: "3.12.10", executable: "pythonw.exe", format: "PE32+ AMD64" },
  engine: { name: "vosk", version: "0.3.45", importPath: "site-packages/vosk/__init__.py" },
  model: { name: "vosk-model-small-es-0.42", ...modelSummary },
  runtime: runtimeSummaryBeforeManifest,
  requiredFiles: [
    "pythonw.exe", "python312.dll", "python3.dll", "python312.zip", "python312._pth",
    "site-packages/_cffi_backend.cp312-win_amd64.pyd", "site-packages/vosk/__init__.py",
    "site-packages/vosk/libvosk.dll", "site-packages/vosk/libgcc_s_seh-1.dll",
    "site-packages/vosk/libstdc++-6.dll", "site-packages/vosk/libwinpthread-1.dll",
  ],
  sources: SOURCES.map(({ type, ...source }) => ({ ...source, packageType: type })),
};
await writeFile(join(RUNTIME_DIRECTORY, "embedded-asr.manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const pythonw = await stat(join(RUNTIME_DIRECTORY, "pythonw.exe"));
console.log(`Runtime ASR embebido preparado: ${manifest.runtime.files} archivos, ${manifest.runtime.size} bytes; pythonw.exe ${pythonw.size} bytes; modelo ${modelSummary.files} archivos.`);
