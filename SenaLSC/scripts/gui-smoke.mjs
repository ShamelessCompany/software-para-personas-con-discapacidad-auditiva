import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 10_000 + Math.floor(Math.random() * 40_000);
const electronPath = join(process.cwd(), "node_modules", "electron", "dist", "electron");
const profileDirectory = await mkdtemp(join(tmpdir(), "senalsc-gui-smoke-"));
const detached = process.platform !== "win32";
const child = spawn(electronPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDirectory}`, "."], {
  detached,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    sleep(milliseconds).then(() => { throw new Error(message); }),
  ]);
}

function stopChild(signal) {
  if (child.exitCode !== null || child.pid === undefined) return;
  try {
    if (detached) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (caught) {
    if (!(caught instanceof Error && "code" in caught && caught.code === "ESRCH")) throw caught;
  }
}

async function getPageTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.title === "SenaLSC" && !target.url.includes("captions=1") && !target.url.includes("visual-support=1"));
      if (page) return page;
    } catch {
      // Electron todavía está iniciando.
    }
    await sleep(250);
  }
  throw new Error("Electron no expuso la ventana principal por CDP.");
}

async function getOverlayTarget(query) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1_000) });
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.url.includes(query));
      if (page) return page;
    } catch {
      // El target puede estar cargando todavía.
    }
    await sleep(200);
  }
  throw new Error(`Electron no expuso el overlay ${query} por CDP.`);
}

function createCdpClient(url) {
  const socket = new WebSocket(url);
  let sequence = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
  });
  return {
    opened,
    close: () => socket.close(),
    send: async (method, params = {}) => {
      await withTimeout(opened, 5_000, `CDP no abrió el socket para ${method}.`);
      sequence += 1;
      const id = sequence;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return withTimeout(result, 5_000, `CDP no respondió a ${method}.`);
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitForEvaluation(client, expression, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await evaluate(client, expression);
    if (value) return true;
    await sleep(200);
  }
  return Boolean(await evaluate(client, expression));
}

try {
  const target = await getPageTarget();
  const client = createCdpClient(target.webSocketDebuggerUrl);
  await withTimeout(client.opened, 5_000, "CDP no abrió la ventana principal.");
  await client.send("Page.enable");
  await client.send("Runtime.enable");

  const visualTarget = await getOverlayTarget("visual-support=1");
  const visualClient = createCdpClient(visualTarget.webSocketDebuggerUrl);
  await withTimeout(visualClient.opened, 5_000, "CDP no abrió el overlay superior.");
  await visualClient.send("Page.enable");
  await visualClient.send("Runtime.enable");
  const visualInitiallyEmpty = await evaluate(visualClient, `document.visibilityState === 'hidden' && document.querySelector('.visual-overlay-shell') === null && document.body.innerText.trim() === ''`);
  if (!visualInitiallyEmpty) throw new Error("El overlay superior mostró contenido sin un medio activo.");

  const firstRun = await evaluate(client, `({
    title: document.title,
    heading: document.querySelector('h1')?.textContent,
    logoAlt: document.querySelector('.brand img')?.getAttribute('alt'),
    logoLoaded: document.querySelector('.brand img')?.complete && document.querySelector('.brand img')?.naturalWidth > 0,
    hasMicrophoneChoice: document.body.innerText.includes('Dispositivo de entrada'),
    hasMicrophoneTest: document.body.innerText.includes('Probar micrófono'),
    hasPendingPermission: document.body.innerText.includes('Pendiente de permiso'),
    hasStateIcon: document.querySelector('.service-state > span[aria-hidden="true"]') !== null
  })`);
  if (firstRun.title !== "SenaLSC" || firstRun.heading !== "Subtítulos listos para el aula" || firstRun.logoAlt !== "Logo del SENA" || !firstRun.logoLoaded || !firstRun.hasMicrophoneChoice || !firstRun.hasMicrophoneTest || !firstRun.hasPendingPermission || !firstRun.hasStateIcon) {
    throw new Error(`El primer inicio no abrió la consola accesible esperada en ${target.url}: ${JSON.stringify(firstRun)}`);
  }

  const libraryEnabled = await evaluate(client, `(() => { const input = Array.from(document.querySelectorAll('.source-toggles label')).find((label) => label.querySelector('strong')?.textContent === 'Biblioteca LSC')?.querySelector('input'); if (!input) return false; if (!input.checked) input.click(); return input.checked; })()`);
  if (!libraryEnabled) throw new Error("No se pudo activar la Biblioteca LSC unificada.");
  const initial = await evaluate(client, `({
    heading: document.querySelector('h1')?.textContent,
    hasNotice: document.body.innerText.includes('No constituye traducción gramatical ni reemplaza a un intérprete'),
    hasRealButton: document.body.innerText.includes('Iniciar subtítulos'),
    hasDemoButton: document.body.innerText.includes('Probar demostración')
  })`);
  if (initial.heading !== "Subtítulos listos para el aula" || !initial.hasNotice || !initial.hasRealButton || !initial.hasDemoButton) {
    throw new Error(`La consola de activación no contiene la UI esperada: ${JSON.stringify(initial)}`);
  }
  await evaluate(client, `document.querySelector('.live-preview')?.setAttribute('open', ''); Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Probar demostración'))?.click()`);
  const phraseReady = await waitForEvaluation(client, `document.querySelector('.live-preview')?.innerText.includes('Buenos días') && document.querySelector('[data-active-media="lsc50-0001"]') !== null`, 12_000);
  const demo = await evaluate(client, `({
    banner: document.body.innerText.includes('MODO DEMOSTRACIÓN'),
    phrase: document.body.innerText.includes('Buenos días'),
    media: document.querySelector('[data-active-media="lsc50-0001"]') !== null,
    badge: document.body.innerText.includes('FUENTE ACADÉMICA · LSC50')
  })`);
  if (!phraseReady || !demo.banner || !demo.phrase || !demo.media || !demo.badge) throw new Error(`La frase demo y el medio académico no se reflejaron correctamente: ${JSON.stringify(demo)}`);

  const captionsTarget = await getOverlayTarget("captions=1");
  const captionsClient = createCdpClient(captionsTarget.webSocketDebuggerUrl);
  await withTimeout(captionsClient.opened, 5_000, "CDP no abrió el overlay inferior.");
  await captionsClient.send("Runtime.enable");
  const captionsReady = await waitForEvaluation(captionsClient, `document.body.innerText.includes('Buenos días')`);
  if (!captionsReady) throw new Error("El overlay inferior no recibió el subtítulo.");
  const captionSurface = await evaluate(captionsClient, `(() => { const root = getComputedStyle(document.documentElement); const body = getComputedStyle(document.body); const shell = document.querySelector('.caption-overlay-shell'); const caption = document.querySelector('.overlay-caption > span'); return { root: root.backgroundColor, body: body.backgroundColor, shell: shell ? getComputedStyle(shell).backgroundColor : null, content: caption?.textContent?.trim(), status: document.querySelector('.overlay-caption-meta strong')?.textContent, local: document.querySelector('.overlay-caption-meta span')?.textContent?.startsWith('Local · '), panels: document.querySelectorAll('header, button, .topbar, .overlay-shell').length }; })()`);
  if (captionSurface.root !== "rgba(0, 0, 0, 0)" || captionSurface.body !== "rgba(0, 0, 0, 0)" || captionSurface.shell !== "rgba(0, 0, 0, 0)" || captionSurface.content !== "Buenos días" || captionSurface.status !== "Frase confirmada" || !captionSurface.local || captionSurface.panels !== 0) {
    throw new Error(`El overlay inferior no es una superficie transparente de solo contenido: ${JSON.stringify(captionSurface)}`);
  }

  const visualReady = await waitForEvaluation(visualClient, `document.body.innerText.includes('FUENTE ACADÉMICA · LSC50') && document.querySelector('[data-media-id="lsc50-0001"] video') !== null`, 12_000);
  if (!visualReady) throw new Error("El overlay superior no recibió el clip LSC50 y su badge académico.");
  await sleep(4_300);
  const simultaneous = await Promise.all([
    evaluate(captionsClient, `({ visibility: document.visibilityState, content: document.querySelector('.overlay-caption > span')?.textContent?.trim(), transparent: getComputedStyle(document.documentElement).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)', clickThroughSurface: getComputedStyle(document.body).pointerEvents === 'none' })`),
    evaluate(visualClient, `({ visibility: document.visibilityState, video: document.querySelector('[data-media-id="lsc50-0001"] video') !== null, transparent: getComputedStyle(document.documentElement).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)', clickThroughSurface: getComputedStyle(document.body).pointerEvents === 'none' })`),
  ]);
  const [captionNow, visualNow] = simultaneous;
  const separateTargets = captionsTarget.id !== visualTarget.id && captionsTarget.url !== visualTarget.url;
  if (captionNow.visibility !== "visible" || captionNow.content !== "Buenos días" || !captionNow.transparent || !captionNow.clickThroughSurface || visualNow.visibility !== "visible" || !visualNow.video || !visualNow.transparent || !visualNow.clickThroughSurface || !separateTargets) {
    throw new Error(`Los overlays no coexistieron correctamente en targets independientes: ${JSON.stringify({ captionNow, visualNow, captionsTarget: captionsTarget.id, visualTarget: visualTarget.id, separateTargets })}`);
  }
  const visualSurface = await evaluate(visualClient, `(() => { const shell = document.querySelector('.visual-overlay-shell'); const figure = document.querySelector('.visual-media'); const frame = document.querySelector('.visual-media-frame'); const video = document.querySelector('video'); return { visibility: document.visibilityState, html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor, shell: shell ? getComputedStyle(shell).backgroundColor : null, figure: figure ? getComputedStyle(figure).backgroundColor : null, frame: frame ? getComputedStyle(frame).backgroundColor : null, frameRadius: frame ? getComputedStyle(frame).borderRadius : null, fit: video ? getComputedStyle(video).objectFit : null, badge: document.body.innerText.includes('FUENTE ACADÉMICA · LSC50'), panels: document.querySelectorAll('header, button, .topbar, .overlay-shell, .control-panel').length }; })()`);
  if (visualSurface.visibility !== "visible" || Object.entries(visualSurface).some(([key, value]) => ["html", "body", "shell", "figure"].includes(key) && value !== "rgba(0, 0, 0, 0)") || visualSurface.frame === "rgba(0, 0, 0, 0)" || visualSurface.frameRadius !== "10px" || visualSurface.fit !== "contain" || !visualSurface.badge || visualSurface.panels !== 0) {
    throw new Error(`El overlay superior no es una superficie transparente de solo contenido: ${JSON.stringify(visualSurface)}`);
  }

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    await client.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
    const visibleControls = await evaluate(client, `(() => {
      const visible = (selector) => { const element = document.querySelector(selector); if (!element) return false; const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height >= 44 && rect.top >= 0 && rect.bottom <= window.innerHeight; };
      return { width: window.innerWidth, height: window.innerHeight, cta: visible('[data-testid="primary-listening-cta"]'), microphone: visible('[data-testid="microphone-selector"]'), horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    })()`);
    if (!visibleControls.cta || !visibleControls.microphone || visibleControls.horizontalOverflow) throw new Error(`CTA o selector fuera del viewport ${viewport.width}x${viewport.height}: ${JSON.stringify(visibleControls)}`);
  }
  await client.send("Emulation.clearDeviceMetricsOverride");

  await evaluate(client, `Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Historial')?.click()`);
  const history = await evaluate(client, `document.body.innerText.includes('RECONOCIMIENTO LOCAL') || document.body.innerText.includes('DEMOSTRACIÓN')`);
  if (!history) throw new Error("La frase demostrativa no llegó al historial.");

  captionsClient.close();
  visualClient.close();
  client.close();
  console.log("Smoke GUI correcto: logo, CTA y micrófono visibles en 1280x720, 1366x768 y 1920x1080; barra compacta, video discreto y ambos overlays simultáneos/click-through verificados.");
} finally {
  stopChild("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3_000)]);
  if (child.exitCode === null) {
    stopChild("SIGKILL");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(1_000)]);
  }
  await rm(profileDirectory, { recursive: true, force: true });
  if (stderr.includes("Unable to load preload script") || stderr.includes("Uncaught")) {
    throw new Error(`Electron reportó un error de runtime:\n${stderr}`);
  }
}
