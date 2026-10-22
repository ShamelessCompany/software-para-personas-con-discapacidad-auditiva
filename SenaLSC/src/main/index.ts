import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, protocol, screen, session, shell, Tray, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { IPC_CHANNEL } from "../shared/channels";
import { DEFAULT_SETTINGS } from "../shared/settings";
import { formatTranscriptText } from "../shared/transcript";
import { ASR_PROFILE, LISTENING_STATE, RESIDENT_COMMAND, type AsrProfile, type AsrResult, type AsrStartResult, type DefaultAudioSourceInfo, type MediaEntryResult, type MediaLibraryListResult, type MediaUrlResult, type OperationResult, type OverlayState, type ResidentPreferences, type ResidentPreferencesResult, type ResidentServiceState, type SidecarStatus } from "../shared/types";
import { isOverlayState, validateAsrStartRequest, validateAudioChunk, validateExportRequest, validateImportVisualMediaRequest, validateMediaId, validateMediaIdRequest, validateResidentPreferences, validateResidentServiceState, validateSaveVisualMediaRequest } from "../shared/validation";
import { MediaLibrary } from "./media-library";
import { AsrSidecar, isDemoDistribution } from "./sidecar";
import { OverlayStateCache } from "./overlay-state";
import { ResidentPreferencesStore } from "./resident-preferences";
import { calculateOverlayBounds, residentMenuPresentation, resolveResidentVisibility, shouldHideOnClose } from "./resident-shell";
import { isAllowedAudioPermission, isAllowedRendererUrl } from "./window-security";

protocol.registerSchemesAsPrivileged([{
  scheme: "senalsc-media",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

let mainWindow: BrowserWindow | null = null;
let captionsWindow: BrowserWindow | null = null;
let visualSupportWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let preferencesStore: ResidentPreferencesStore | null = null;
let residentPreferences: ResidentPreferences = { captionsVisible: true, visualSupportVisible: true, launchAtLogin: false };
let residentState: ResidentServiceState = { listeningState: LISTENING_STATE.IDLE, demoMode: false, transitioning: false };
let explicitlyQuitting = false;
const overlayState = new OverlayStateCache();
let mediaLibrary: MediaLibrary | null = null;

const sidecar = new AsrSidecar({
  onResult: (result: AsrResult) => mainWindow?.webContents.send(IPC_CHANNEL.ASR_RESULT, result),
  onStatus: (status: SidecarStatus) => mainWindow?.webContents.send(IPC_CHANNEL.STATUS_CHANGED, status),
});

app.setName("SenaLSC");

function applicationIconPath(name: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, "assets", "icons", name)
    : join(app.getAppPath(), "assets", "icons", name);
}

function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  if (event.sender.isDestroyed()) return false;
  const url = event.senderFrame?.url;
  if (!url) return false;
  return isAllowedRendererUrl(url, rendererLocation());
}

function preloadPath(): string {
  return join(__dirname, "../preload/index.js");
}

function rendererLocation(kind?: "captions" | "visual-support"): string {
  const suffix = kind ? `?${kind}=1` : "";
  return process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}${suffix}`
    : `${pathToFileURL(join(__dirname, "../../dist/renderer/index.html")).href}${suffix}`;
}

function configureWindowSecurity(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const allowed = ["https://doi.org/10.6084/m9.figshare.27383016.v1", "https://figshare.com/articles/dataset/LSC50_Colombian_Sign_Language_Video_and_Inertial_Measurement_Dataset/27383016", "https://creativecommons.org/licenses/by/4.0/", "https://www.kaggle.com/datasets/juanrrai/colombian-sign-language-slc-signs-dataset", "https://creativecommons.org/licenses/by-sa/4.0/", "https://archive.org/details/alfabeto_expresa", "https://creativecommons.org/licenses/by-nc-nd/3.0/"];
    if (allowed.includes(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererUrl(url, rendererLocation())) event.preventDefault();
  });
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    show: !process.argv.includes("--hidden"),
    width: 1280,
    height: 720,
    minWidth: 860,
    minHeight: 640,
    title: isDemoDistribution() ? "SenaLSC Demo" : "SenaLSC",
    backgroundColor: "#f5f8f3",
    icon: applicationIconPath("icon-256.png"),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  configureWindowSecurity(mainWindow);
  void mainWindow.loadURL(rendererLocation());
  mainWindow.on("close", (event) => {
    if (!shouldHideOnClose(explicitlyQuitting)) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  mainWindow?.show();
  mainWindow?.focus();
}

function parseRange(value: string | null, size: number): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) return null;
  const start = startText ? Number(startText) : Math.max(0, size - Number(endText));
  const end = endText && startText ? Number(endText) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function streamResponse(path: string, mimeType: string, size: number, range: { start: number; end: number } | null): Response {
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  const length = end - start + 1;
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>;
  const headers: Record<string, string> = {
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-length": String(length),
    "content-type": mimeType,
    "x-content-type-options": "nosniff",
  };
  if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  return new Response(body, { status: range ? 206 : 200, headers });
}

function registerMediaProtocol(): void {
  protocol.handle("senalsc-media", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== "media" || url.username || url.password || url.port || url.search || url.hash) {
        return new Response("Solicitud no válida.", { status: 400 });
      }
      const id = validateMediaId(decodeURIComponent(url.pathname.replace(/^\//, "")));
      if (!id || !mediaLibrary) return new Response("Medio no encontrado.", { status: 404 });
      const resolved = await mediaLibrary.resolve(id);
      if (!resolved) return new Response("Medio no encontrado.", { status: 404 });
      const rangeHeader = request.headers.get("range");
      const range = parseRange(rangeHeader, resolved.size);
      if (rangeHeader && !range) return new Response(null, { status: 416, headers: { "content-range": `bytes */${resolved.size}` } });
      return streamResponse(resolved.path, resolved.mimeType, resolved.size, range);
    } catch {
      return new Response("Solicitud no válida.", { status: 400 });
    }
  });
}

function configurePassiveOverlay(window: BrowserWindow): void {
  configureWindowSecurity(window);
  window.on("page-title-updated", (event) => event.preventDefault());
  window.setTitle("");
  window.setAlwaysOnTop(true, "floating");
  window.setIgnoreMouseEvents(true, { forward: false });
  window.setFocusable(false);
  window.setSkipTaskbar(true);
  if (process.platform !== "win32") window.setVisibleOnAllWorkspaces(true);
}

async function createOverlayWindows(): Promise<void> {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = calculateOverlayBounds(display.workArea, overlayState.current()?.settings ?? DEFAULT_SETTINGS, display.scaleFactor);
  captionsWindow = new BrowserWindow({
    ...bounds.captions,
    show: false,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  visualSupportWindow = new BrowserWindow({
    ...bounds.visualSupport,
    show: false,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: { preload: preloadPath(), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  configurePassiveOverlay(captionsWindow);
  configurePassiveOverlay(visualSupportWindow);
  await Promise.all([
    captionsWindow.loadURL(rendererLocation("captions")),
    visualSupportWindow.loadURL(rendererLocation("visual-support")),
  ]);
  syncResidentWindows();
}

function positionOverlayWindows(): void {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const bounds = calculateOverlayBounds(display.workArea, overlayState.current()?.settings ?? DEFAULT_SETTINGS, display.scaleFactor);
  captionsWindow?.setBounds(bounds.captions);
  visualSupportWindow?.setBounds(bounds.visualSupport);
}

function syncResidentWindows(): void {
  const snapshot = overlayState.current();
  const visibility = resolveResidentVisibility(residentState, residentPreferences, Boolean(snapshot?.settings.showVisualSupport && snapshot.activeMedia));
  if (visibility.captions) captionsWindow?.showInactive(); else captionsWindow?.hide();
  if (visibility.visualSupport) visualSupportWindow?.showInactive(); else visualSupportWindow?.hide();
  rebuildTrayMenu();
}

function launchAtLoginAvailable(): boolean {
  return process.platform === "win32" && app.isPackaged;
}

function preferencesResult(): ResidentPreferencesResult {
  return { preferences: residentPreferences, launchAtLoginAvailable: launchAtLoginAvailable() };
}

function applyLaunchAtLogin(enabled: boolean): boolean {
  if (!launchAtLoginAvailable()) return false;
  app.setLoginItemSettings({ openAtLogin: enabled, enabled, path: process.execPath, args: ["--hidden"], name: "SenaLSC" });
  return app.getLoginItemSettings({ path: process.execPath, args: ["--hidden"] }).openAtLogin;
}

async function updateResidentPreferences(next: ResidentPreferences): Promise<ResidentPreferencesResult> {
  const launchAtLogin = next.launchAtLogin ? applyLaunchAtLogin(true) : false;
  if (!next.launchAtLogin) applyLaunchAtLogin(false);
  const preferences = { ...next, launchAtLogin };
  residentPreferences = preferencesStore ? await preferencesStore.save(preferences) : preferences;
  mainWindow?.webContents.send(IPC_CHANNEL.RESIDENT_PREFERENCES_CHANGED, preferencesResult());
  syncResidentWindows();
  return preferencesResult();
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const presentation = residentMenuPresentation(residentState);
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: presentation.status, enabled: false },
    { label: presentation.listeningAction, enabled: presentation.actionEnabled, click: () => mainWindow?.webContents.send(IPC_CHANNEL.RESIDENT_COMMAND, RESIDENT_COMMAND.TOGGLE_LISTENING) },
    { type: "separator" },
    { label: "Mostrar configuración", click: showMainWindow },
    { label: residentPreferences.captionsVisible ? "Ocultar subtítulos" : "Mostrar subtítulos", click: () => void updateResidentPreferences({ ...residentPreferences, captionsVisible: !residentPreferences.captionsVisible }) },
    { label: residentPreferences.visualSupportVisible ? "Ocultar apoyo visual" : "Mostrar apoyo visual", click: () => void updateResidentPreferences({ ...residentPreferences, visualSupportVisible: !residentPreferences.visualSupportVisible }) },
  ];
  if (launchAtLoginAvailable()) template.push({ label: "Iniciar con Windows", type: "checkbox", checked: residentPreferences.launchAtLogin, click: () => void updateResidentPreferences({ ...residentPreferences, launchAtLogin: !residentPreferences.launchAtLogin }) });
  template.push({ type: "separator" }, { label: "Salir", click: requestQuit });
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray(): void {
  const trayIcon = (): Electron.NativeImage => nativeImage.createFromPath(applicationIconPath(nativeTheme.shouldUseDarkColors ? "tray-on-dark.png" : "tray-on-light.png"));
  tray = new Tray(trayIcon());
  tray.setToolTip("SenaLSC");
  tray.on("double-click", showMainWindow);
  nativeTheme.on("updated", () => tray?.setImage(trayIcon()));
  rebuildTrayMenu();
}

function requestQuit(): void {
  if (explicitlyQuitting) return;
  explicitlyQuitting = true;
  void sidecar.stop().finally(() => app.quit());
}

function defaultAudioSourceInfo(): Promise<DefaultAudioSourceInfo> {
  if (process.platform !== "linux") return Promise.resolve({ isWoMic: false });
  return new Promise((resolve) => {
    execFile("pactl", ["get-default-source"], { timeout: 2_000, windowsHide: true, encoding: "utf8" }, (error, stdout) => {
      resolve({ isWoMic: !error && stdout.trim() === "wo-mic-source" });
    });
  });
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNEL.STATUS_GET, async (event, rawProfile: unknown) => {
    if (!isTrustedSender(event)) throw new Error("Origen IPC no autorizado.");
    const profile: AsrProfile = Object.values(ASR_PROFILE).includes(rawProfile as never) ? rawProfile as AsrProfile : ASR_PROFILE.LIGHT;
    return sidecar.inspect(profile);
  });
  ipcMain.handle(IPC_CHANNEL.ASR_START, async (event, rawRequest: unknown): Promise<AsrStartResult> => {
    if (!isTrustedSender(event)) return { ok: false, message: "Origen IPC no autorizado.", sessionId: null };
    const request = validateAsrStartRequest(rawRequest);
    if (!request) return { ok: false, message: "La configuración de reconocimiento no es válida.", sessionId: null };
    try {
      const { status, sessionId } = await sidecar.start(request.sampleRate, request.profile);
      return { ok: status.ready && status.processRunning && sessionId !== null, message: status.message, sessionId };
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "error desconocido";
      return { ok: false, message: `No se pudo iniciar el reconocimiento local: ${detail}`, sessionId: null };
    }
  });
  ipcMain.on(IPC_CHANNEL.ASR_AUDIO, (event, rawAudio: unknown) => {
    if (!isTrustedSender(event)) return;
    const audio = validateAudioChunk(rawAudio);
    if (audio) sidecar.sendAudio(audio);
  });
  ipcMain.handle(IPC_CHANNEL.ASR_STOP, async (event): Promise<OperationResult> => {
    if (!isTrustedSender(event)) return { ok: false, message: "Origen IPC no autorizado." };
    try {
      const status = await sidecar.stop();
      return status.processRunning
        ? { ok: false, message: status.message }
        : { ok: true, message: "Escucha detenida. El audio no se guardó." };
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "error desconocido";
      return { ok: false, message: `No se pudo detener el reconocimiento local: ${detail}` };
    }
  });
  ipcMain.handle(IPC_CHANNEL.AUDIO_DEFAULT_SOURCE, async (event): Promise<DefaultAudioSourceInfo> => {
    if (!isTrustedSender(event)) throw new Error("Origen IPC no autorizado.");
    return defaultAudioSourceInfo();
  });
  ipcMain.on(IPC_CHANNEL.OVERLAY_UPDATE, (event, state: unknown) => {
    if (!isTrustedSender(event) || !isOverlayState(state)) return;
    overlayState.update(state);
    positionOverlayWindows();
    captionsWindow?.webContents.send(IPC_CHANNEL.OVERLAY_STATE, state);
    visualSupportWindow?.webContents.send(IPC_CHANNEL.OVERLAY_STATE, state);
    syncResidentWindows();
  });
  ipcMain.handle(IPC_CHANNEL.OVERLAY_GET_STATE, (event): OverlayState | null => {
    if (!isTrustedSender(event)) throw new Error("Origen IPC no autorizado.");
    return overlayState.current();
  });
  ipcMain.on(IPC_CHANNEL.OVERLAY_PLAYLIST_ADVANCE, (event) => {
    if (!isTrustedSender(event) || event.sender !== visualSupportWindow?.webContents) return;
    mainWindow?.webContents.send(IPC_CHANNEL.OVERLAY_PLAYLIST_ADVANCE);
  });
  ipcMain.handle(IPC_CHANNEL.RESIDENT_PREFERENCES_GET, (event): ResidentPreferencesResult => {
    if (!isTrustedSender(event)) throw new Error("Origen IPC no autorizado.");
    return preferencesResult();
  });
  ipcMain.handle(IPC_CHANNEL.RESIDENT_PREFERENCES_SET, async (event, rawPreferences: unknown): Promise<ResidentPreferencesResult> => {
    if (!isTrustedSender(event)) throw new Error("Origen IPC no autorizado.");
    const preferences = validateResidentPreferences(rawPreferences);
    if (!preferences) throw new Error("Las preferencias residentes no son válidas.");
    return updateResidentPreferences(preferences);
  });
  ipcMain.on(IPC_CHANNEL.RESIDENT_STATE_UPDATE, (event, rawState: unknown) => {
    if (!isTrustedSender(event)) return;
    const state = validateResidentServiceState(rawState);
    if (!state) return;
    residentState = state;
    syncResidentWindows();
  });
  ipcMain.on(IPC_CHANNEL.MAIN_WINDOW_HIDE, (event) => {
    if (isTrustedSender(event)) mainWindow?.hide();
  });
  ipcMain.handle(IPC_CHANNEL.TRANSCRIPT_EXPORT, async (event, request: unknown): Promise<OperationResult> => {
    if (!isTrustedSender(event)) return { ok: false, message: "Origen IPC no autorizado." };
    const valid = validateExportRequest(request);
    if (!valid) return { ok: false, message: "Los datos de exportación no son válidos." };
    const options: Electron.SaveDialogOptions = {
      title: "Exportar transcripción",
      defaultPath: `transcripcion-senalsc.${valid.format}`,
      filters: valid.format === "txt"
        ? [{ name: "Texto", extensions: ["txt"] }]
        : [{ name: "JSON", extensions: ["json"] }],
    };
    try {
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { ok: false, message: "Exportación cancelada." };
      const content = valid.format === "txt" ? formatTranscriptText(valid.entries) : JSON.stringify(valid.entries, null, 2);
      await writeFile(result.filePath, content, "utf8");
      return { ok: true, message: "Transcripción exportada correctamente." };
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "error desconocido";
      return { ok: false, message: `No se pudo exportar la transcripción: ${detail}` };
    }
  });
  ipcMain.handle(IPC_CHANNEL.MEDIA_LIST, async (event): Promise<MediaLibraryListResult> => {
    if (!isTrustedSender(event) || !mediaLibrary) throw new Error("Origen IPC no autorizado.");
    return mediaLibrary.list();
  });
  ipcMain.handle(IPC_CHANNEL.MEDIA_STATUS, (event) => {
    if (!isTrustedSender(event) || !mediaLibrary) throw new Error("Origen IPC no autorizado.");
    return mediaLibrary.status();
  });
  ipcMain.handle(IPC_CHANNEL.MEDIA_IMPORT, async (event, request: unknown): Promise<MediaEntryResult> => {
    if (!isTrustedSender(event) || !mediaLibrary) return { ok: false, message: "Origen IPC no autorizado.", entry: null };
    const valid = validateImportVisualMediaRequest(request);
    if (!valid) return { ok: false, message: "Los metadatos del medio no son válidos.", entry: null };
    try {
      const options: Electron.OpenDialogOptions = {
        title: "Importar ayuda visual",
        properties: ["openFile"],
        filters: [
          { name: "Imagen o video permitido", extensions: ["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm"] },
          { name: "Imágenes", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
          { name: "Videos", extensions: ["mp4", "webm"] },
        ],
      };
      const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
      const sourcePath = result.filePaths[0];
      if (result.canceled || !sourcePath) return { ok: false, message: "Importación cancelada.", entry: null };
      const entry = await mediaLibrary.import(sourcePath, valid.draft);
      return { ok: true, message: "Medio importado en la biblioteca local.", entry };
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "error desconocido";
      return { ok: false, message: `No se pudo importar el medio: ${detail}`, entry: null };
    }
  });
  ipcMain.handle(IPC_CHANNEL.MEDIA_SAVE, async (event, request: unknown): Promise<MediaEntryResult> => {
    if (!isTrustedSender(event) || !mediaLibrary) return { ok: false, message: "Origen IPC no autorizado.", entry: null };
    const valid = validateSaveVisualMediaRequest(request);
    if (!valid) return { ok: false, message: "La entrada no es válida o no cumple la política de validación.", entry: null };
    try {
      const entry = await mediaLibrary.save(valid.entry);
      return { ok: true, message: "Entrada actualizada.", entry };
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "error desconocido";
      return { ok: false, message: `No se pudo guardar la entrada: ${detail}`, entry: null };
    }
  });
  ipcMain.handle(IPC_CHANNEL.MEDIA_DELETE, async (event, request: unknown): Promise<OperationResult> => {
    if (!isTrustedSender(event) || !mediaLibrary) return { ok: false, message: "Origen IPC no autorizado." };
    const valid = validateMediaIdRequest(request);
    if (!valid) return { ok: false, message: "El identificador del medio no es válido." };
    try {
      await mediaLibrary.delete(valid.id);
      return { ok: true, message: "Medio importado eliminado de este equipo." };
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "error desconocido";
      return { ok: false, message: `No se pudo eliminar el medio: ${detail}` };
    }
  });
  ipcMain.handle(IPC_CHANNEL.MEDIA_URL, async (event, request: unknown): Promise<MediaUrlResult> => {
    if (!isTrustedSender(event) || !mediaLibrary) return { ok: false, message: "Origen IPC no autorizado.", url: null };
    const valid = validateMediaIdRequest(request);
    if (!valid || !await mediaLibrary.resolve(valid.id)) return { ok: false, message: "El medio no está disponible.", url: null };
    return { ok: true, message: "Medio disponible.", url: `senalsc-media://media/${valid.id}` };
  });
}

function configurePermissions(): void {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    return isAllowedAudioPermission(permission, requestingOrigin, rendererLocation(), details.mediaType ? [details.mediaType] : []);
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const local = isAllowedRendererUrl(webContents.getURL(), rendererLocation());
    const mediaTypes = "mediaTypes" in details ? details.mediaTypes : [];
    const requestingOrigin = new URL(webContents.getURL()).protocol === "file:" ? "file://" : new URL(webContents.getURL()).origin;
    callback(Boolean(local && isAllowedAudioPermission(permission, requestingOrigin, rendererLocation(), mediaTypes)));
  });
}

void app.whenReady().then(async () => {
  if (process.platform === "win32") app.setAppUserModelId("co.edu.sena.senalsc");
  Menu.setApplicationMenu(null);
  preferencesStore = new ResidentPreferencesStore(join(app.getPath("userData"), "resident-preferences.json"));
  residentPreferences = await preferencesStore.load();
  if (launchAtLoginAvailable()) {
    const enabled = app.getLoginItemSettings({ path: process.execPath, args: ["--hidden"] }).openAtLogin;
    if (enabled !== residentPreferences.launchAtLogin) residentPreferences = await preferencesStore.save({ ...residentPreferences, launchAtLogin: enabled });
  } else if (residentPreferences.launchAtLogin) {
    residentPreferences = await preferencesStore.save({ ...residentPreferences, launchAtLogin: false });
  }
  mediaLibrary = new MediaLibrary({
    dataDirectory: app.getPath("userData"),
    bundledDirectory: app.isPackaged ? join(process.resourcesPath, "assets", "lsc") : join(app.getAppPath(), "assets", "lsc"),
  }, isDemoDistribution());
  registerMediaProtocol();
  configurePermissions();
  registerIpc();
  createMainWindow();
  createTray();
  await createOverlayWindows();
  positionOverlayWindows();
  screen.on("display-added", positionOverlayWindows);
  screen.on("display-removed", positionOverlayWindows);
  screen.on("display-metrics-changed", positionOverlayWindows);
  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("before-quit", () => { explicitlyQuitting = true; });
app.on("window-all-closed", () => undefined);
