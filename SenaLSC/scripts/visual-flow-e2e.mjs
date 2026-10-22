import { spawn } from "node:child_process";
import { join } from "node:path";

const port = 9334;
const electronPath = join(process.cwd(), "node_modules", "electron", "dist", "electron");
const child = spawn(electronPath, [".", `--remote-debugging-port=${port}`], {
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function pageTarget(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const target = (await response.json()).find(predicate);
      if (target) return target;
    } catch {
      // Electron todavía está iniciando.
    }
    await sleep(200);
  }
  throw new Error("No se encontró la ventana Electron esperada.");
}

function client(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  });
  return {
    close: () => socket.close(),
    evaluate: async (expression) => {
      await opened;
      id += 1;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
      const response = await result;
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
      return response.result.value;
    },
  };
}

async function waitFor(page, expression, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await page.evaluate(expression);
    if (result) return result;
    await sleep(150);
  }
  return page.evaluate(expression);
}

try {
  const mainTarget = await pageTarget((target) => target.type === "page" && target.title === "SenaLSC");
  const main = client(mainTarget.webSocketDebuggerUrl);
  const enabled = await main.evaluate(`(() => { const input = Array.from(document.querySelectorAll('.source-toggles label')).find((label) => label.textContent.includes('Biblioteca LSC'))?.querySelector('input'); if (!input) return false; if (!input.checked) input.click(); return input.checked; })()`);
  if (!enabled) throw new Error("No se encontró el toggle de Biblioteca LSC.");
  await main.evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Abrir ventana flotante'))?.click()`);
  await main.evaluate(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Probar demostración'))?.click()`);

  const snapshot = await waitFor(main, `(async () => { const state = await window.senaLsc.getOverlayState(); return state?.activeMedia?.entry?.id === 'lsc50-0001' ? { phrase: state.confirmedPhrase?.text, mediaUrl: state.activeMedia.mediaUrl, playbackKey: state.activeMedia.playbackKey, badge: state.activeMedia.entry.status } : null; })()`);
  if (!snapshot || snapshot.phrase !== "Buenos días" || snapshot.mediaUrl !== "senalsc-media://media/lsc50-0001" || !Number.isSafeInteger(snapshot.playbackKey) || snapshot.badge !== "academic") {
    throw new Error(`El snapshot visual no es válido: ${JSON.stringify(snapshot)}`);
  }

  const overlayTarget = await pageTarget((target) => target.type === "page" && target.url.includes("overlay=1"));
  const overlay = client(overlayTarget.webSocketDebuggerUrl);
  const rendered = await waitFor(overlay, `document.body.innerText.includes('Buenos días') && document.body.innerText.includes('FUENTE ACADÉMICA · LSC50') && document.querySelector('[data-media-id="lsc50-0001"]') !== null`);
  if (!rendered) throw new Error("El overlay no renderizó el snapshot visual completo.");
  overlay.close();
  main.close();
  console.log(`E2E visual correcto: “${snapshot.phrase}” -> ${snapshot.mediaUrl} -> playbackKey ${snapshot.playbackKey} -> overlay.`);
} finally {
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3_000)]);
  if (stderr.includes("Unable to load preload script") || stderr.includes("Uncaught")) throw new Error(`Electron reportó un error de runtime:\n${stderr}`);
}
