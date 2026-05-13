import "./style.css";
import type {
  DwgWorkerRequest,
  DwgWorkerResponse
} from "./dwg-worker-protocol";

type DxfViewerInstance = import("dxf-viewer").DxfViewer;
type DxfViewerModule = typeof import("dxf-viewer");
type JsPdfModule = typeof import("jspdf");

type UiRefs = {
  openButton: HTMLButtonElement;
  fileInput: HTMLInputElement;
  exportButton: HTMLButtonElement;
  fitButton: HTMLButtonElement;
  statusText: HTMLElement;
  metaText: HTMLElement;
  viewerMount: HTMLElement;
  dropzone: HTMLElement;
};

type PreparedDrawing = {
  statusPrefix: string;
  successMessage: string;
  metaSuffix: string;
  url: string;
};

const STALE_LOAD_ERROR = "STALE_LOAD";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Application root not found.");
}

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Browser-first CAD to PDF</p>
        <h1>在线 CAD 转 PDF，先把 DXF 跑通。</h1>
        <p class="lede">
          文件只在浏览器内解析和渲染。当前 MVP 已支持 DXF 预览与单页 PDF 导出，
          并提供实验性 DWG 转 DXF 链路。
        </p>
      </div>
      <div class="hero-panel">
        <div class="panel-grid">
          <article>
            <span class="panel-label">处理方式</span>
            <strong>本地解析</strong>
            <p>上传后仅生成浏览器内对象 URL，不上传到服务端。</p>
          </article>
          <article>
            <span class="panel-label">当前范围</span>
            <strong>DXF + 实验性 DWG</strong>
            <p>DWG 会先在浏览器 Worker 内转成 DXF，再复用现有预览链路。</p>
          </article>
          <article>
            <span class="panel-label">部署方向</span>
            <strong>Cloudflare Pages</strong>
            <p>静态前端即可部署，不依赖传统后端转换服务。</p>
          </article>
        </div>
      </div>
    </section>

    <section class="workspace">
      <aside class="control-card">
        <div class="control-header">
          <p class="eyebrow">Workflow</p>
          <h2>导入与导出</h2>
        </div>

        <div class="dropzone" data-role="dropzone">
          <input
            class="visually-hidden"
            type="file"
            accept=".dxf,.dwg"
            data-role="file-input"
          />
          <p class="dropzone-title">拖入 DXF 或 DWG，或手动选择</p>
          <p class="dropzone-copy">
            DWG 目前属于实验功能，会先在浏览器 Worker 中转换成 DXF。
          </p>
          <button type="button" class="button button-primary" data-role="open-button">
            选择 CAD 文件
          </button>
        </div>

        <div class="button-row">
          <button type="button" class="button button-secondary" data-role="fit-button" disabled>
            适配视图
          </button>
          <button type="button" class="button button-accent" data-role="export-button" disabled>
            导出 PDF
          </button>
        </div>

        <div class="status-card">
          <p class="status-label">状态</p>
          <p class="status-text" data-role="status-text">等待导入 DXF 或 DWG 文件。</p>
          <p class="meta-text" data-role="meta-text">未载入文件</p>
        </div>
      </aside>

      <section class="viewer-card">
        <div class="viewer-topbar">
          <div>
            <p class="eyebrow">Preview</p>
            <h2>图纸预览</h2>
          </div>
          <p class="viewer-note">PDF 目前按当前渲染视图导出为单页。</p>
        </div>
        <div class="viewer-stage" data-role="viewer-mount">
          <div class="viewer-empty">
            <p>DXF 或转换后的 DWG 会在这里渲染。</p>
          </div>
        </div>
      </section>
    </section>
  </main>
`;

const refs = getRefs(app);

let viewer: DxfViewerInstance | null = null;
let currentFile: File | null = null;
let currentObjectUrl: string | null = null;
let viewerModulePromise: Promise<DxfViewerModule> | null = null;
let jsPdfModulePromise: Promise<JsPdfModule> | null = null;
let dwgWorker: Worker | null = null;
let activeLoadId = 0;

refs.openButton.addEventListener("click", () => {
  refs.fileInput.click();
});

refs.fileInput.addEventListener("change", async () => {
  const file = refs.fileInput.files?.[0] ?? null;
  if (file) {
    await openCadFile(file);
  }
});

refs.fitButton.addEventListener("click", () => {
  if (!viewer) {
    return;
  }
  const bounds = viewer.GetBounds();
  if (!bounds) {
    return;
  }
  viewer.FitView(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 24);
  viewer.Render();
  setStatus("视图已适配到当前图纸范围。");
});

refs.exportButton.addEventListener("click", async () => {
  if (!viewer || !currentFile) {
    return;
  }
  setStatus("正在导出 PDF...");
  refs.exportButton.disabled = true;

  try {
    const { jsPDF } = await loadJsPdfModule();
    const canvas = viewer.GetCanvas();
    const imageDataUrl = rasterizeCanvas(canvas);
    const pdf = new jsPDF({
      orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
      unit: "pt",
      format: "a4"
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 28;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;
    const scale = Math.min(contentWidth / canvas.width, contentHeight / canvas.height);
    const renderWidth = canvas.width * scale;
    const renderHeight = canvas.height * scale;
    const offsetX = (pageWidth - renderWidth) / 2;
    const offsetY = (pageHeight - renderHeight) / 2;

    pdf.setFillColor(250, 247, 242);
    pdf.rect(0, 0, pageWidth, pageHeight, "F");
    pdf.addImage(imageDataUrl, "PNG", offsetX, offsetY, renderWidth, renderHeight, undefined, "FAST");
    pdf.save(`${stripExtension(currentFile.name)}.pdf`);

    setStatus("PDF 导出完成。");
  } catch (error) {
    setStatus(formatError(error, "PDF 导出失败。"));
  } finally {
    refs.exportButton.disabled = false;
  }
});

setupDropzone(refs);

window.addEventListener("beforeunload", () => {
  cleanupObjectUrl();
  viewer?.Destroy();
  dwgWorker?.terminate();
});

async function openCadFile(file: File): Promise<void> {
  const loadId = ++activeLoadId;
  const extension = getFileExtension(file.name);

  currentFile = null;
  cleanupObjectUrl();
  clearViewer();
  refs.fitButton.disabled = true;
  refs.exportButton.disabled = true;

  if (extension !== "dxf" && extension !== "dwg") {
    setStatus("当前仅支持导入 DXF 和实验性 DWG 文件。");
    refs.metaText.textContent = `${file.name} · 不支持`;
    return;
  }

  refs.metaText.textContent = `${file.name} · ${formatBytes(file.size)} · ${extension.toUpperCase()}`;

  let stagingUrl: string | null = null;

  try {
    const preparedDrawing = extension === "dwg"
      ? await prepareDwgForPreview(file, loadId)
      : prepareDxfForPreview(file);

    stagingUrl = preparedDrawing.url;

    assertActiveLoad(loadId);
    currentObjectUrl = stagingUrl;
    stagingUrl = null;

    await loadPreparedDrawing(file, preparedDrawing, loadId);
  } catch (error) {
    if (stagingUrl) {
      URL.revokeObjectURL(stagingUrl);
      stagingUrl = null;
    }
    if (isStaleLoadError(error)) {
      return;
    }
    currentFile = null;
    cleanupObjectUrl();
    refs.fitButton.disabled = true;
    refs.exportButton.disabled = true;
    setStatus(formatError(error, extension === "dwg" ? "DWG 处理失败。" : "DXF 载入失败。"));
  }
}

function prepareDxfForPreview(file: File): PreparedDrawing {
  setStatus("正在解析 DXF...");
  return {
    statusPrefix: "正在处理 DXF",
    successMessage: "DXF 已载入，可以预览或导出 PDF。",
    metaSuffix: "DXF",
    url: URL.createObjectURL(file)
  };
}

async function prepareDwgForPreview(file: File, loadId: number): Promise<PreparedDrawing> {
  setStatus("实验性 DWG 支持：正在准备转换器...");
  const dxfBuffer = await convertDwgToDxf(file, loadId);
  assertActiveLoad(loadId);

  setStatus("DWG 已转换为 DXF，正在载入预览...");

  return {
    statusPrefix: "正在载入转换后的 DXF",
    successMessage: "DWG 已转换并载入，可以预览或导出 PDF。",
    metaSuffix: "DWG → DXF",
    url: URL.createObjectURL(new Blob([dxfBuffer], { type: "application/dxf" }))
  };
}

async function loadPreparedDrawing(
  file: File,
  preparedDrawing: PreparedDrawing,
  loadId: number
): Promise<void> {
  const activeViewer = await ensureViewer(refs.viewerMount);
  assertActiveLoad(loadId);

  await activeViewer.Load({
    url: preparedDrawing.url,
    progressCbk: (phase, processedSize, totalSize) => {
      if (!isActiveLoad(loadId)) {
        return;
      }
      const detail = totalSize > 0
        ? `${phase} · ${Math.round((processedSize / totalSize) * 100)}%`
        : `${phase} · ${formatBytes(processedSize)}`;
      refs.statusText.textContent = `${preparedDrawing.statusPrefix}：${detail}`;
    }
  });

  assertActiveLoad(loadId);

  const bounds = activeViewer.GetBounds();
  if (bounds) {
    activeViewer.FitView(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 24);
  }
  activeViewer.Render();

  currentFile = file;
  refs.fitButton.disabled = false;
  refs.exportButton.disabled = false;
  refs.metaText.textContent = `${file.name} · ${formatBytes(file.size)} · ${preparedDrawing.metaSuffix}`;
  setStatus(preparedDrawing.successMessage);
}

async function ensureViewer(container: HTMLElement): Promise<DxfViewerInstance> {
  if (viewer) {
    viewer.Clear();
    return viewer;
  }

  const { DxfViewer } = await loadViewerModule();
  container.innerHTML = "";
  viewer = new DxfViewer(container, {
    autoResize: true,
    antialias: true,
    blackWhiteInversion: true,
    preserveDrawingBuffer: true,
    clearAlpha: 1
  });
  return viewer;
}

function loadViewerModule(): Promise<DxfViewerModule> {
  viewerModulePromise ??= import("dxf-viewer");
  return viewerModulePromise;
}

function loadJsPdfModule(): Promise<JsPdfModule> {
  jsPdfModulePromise ??= import("jspdf");
  return jsPdfModulePromise;
}

async function convertDwgToDxf(file: File, loadId: number): Promise<ArrayBuffer> {
  const worker = getDwgWorker();
  const fileData = await file.arrayBuffer();
  assertActiveLoad(loadId);

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const handleMessage = (event: MessageEvent<DwgWorkerResponse>) => {
      const message = event.data;
      if (message.id !== loadId) {
        return;
      }

      if (message.type === "progress") {
        if (isActiveLoad(loadId)) {
          refs.statusText.textContent = message.message;
        }
        return;
      }

      cleanupListeners();

      if (message.type === "success") {
        resolve(message.dxfBuffer);
        return;
      }

      reject(new Error(message.error));
    };

    const handleError = (event: ErrorEvent) => {
      cleanupListeners();
      reject(new Error(event.message || "DWG worker crashed."));
    };

    const cleanupListeners = () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);

    const payload: DwgWorkerRequest = {
      id: loadId,
      fileName: file.name,
      fileData
    };

    worker.postMessage(payload, [fileData]);
  });
}

function getDwgWorker(): Worker {
  if (dwgWorker) {
    return dwgWorker;
  }

  dwgWorker = new Worker(
    new URL("./dwg-converter.worker.ts", import.meta.url),
    { type: "module" }
  );
  return dwgWorker;
}

function clearViewer(): void {
  if (!viewer) {
    return;
  }
  viewer.Clear();
  viewer.Render();
}

function isActiveLoad(loadId: number): boolean {
  return loadId === activeLoadId;
}

function assertActiveLoad(loadId: number): void {
  if (!isActiveLoad(loadId)) {
    throw new Error(STALE_LOAD_ERROR);
  }
}

function isStaleLoadError(error: unknown): boolean {
  return error instanceof Error && error.message === STALE_LOAD_ERROR;
}

function setupDropzone(refs: UiRefs): void {
  const activate = () => refs.dropzone.classList.add("is-dragover");
  const deactivate = () => refs.dropzone.classList.remove("is-dragover");

  refs.dropzone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    activate();
  });

  refs.dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    activate();
  });

  refs.dropzone.addEventListener("dragleave", (event) => {
    event.preventDefault();
    deactivate();
  });

  refs.dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    deactivate();
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file) {
      await openCadFile(file);
    }
  });
}

function getRefs(root: ParentNode): UiRefs {
  return {
    openButton: mustQuery<HTMLButtonElement>(root, '[data-role="open-button"]'),
    fileInput: mustQuery<HTMLInputElement>(root, '[data-role="file-input"]'),
    exportButton: mustQuery<HTMLButtonElement>(root, '[data-role="export-button"]'),
    fitButton: mustQuery<HTMLButtonElement>(root, '[data-role="fit-button"]'),
    statusText: mustQuery<HTMLElement>(root, '[data-role="status-text"]'),
    metaText: mustQuery<HTMLElement>(root, '[data-role="meta-text"]'),
    viewerMount: mustQuery<HTMLElement>(root, '[data-role="viewer-mount"]'),
    dropzone: mustQuery<HTMLElement>(root, '[data-role="dropzone"]')
  };
}

function mustQuery<T extends Element>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) {
    throw new Error(`Missing node: ${selector}`);
  }
  return node;
}

function setStatus(message: string): void {
  refs.statusText.textContent = message;
}

function cleanupObjectUrl(): void {
  if (!currentObjectUrl) {
    return;
  }
  URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;
}

function rasterizeCanvas(canvas: HTMLCanvasElement): string {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const context = exportCanvas.getContext("2d");

  if (!context) {
    throw new Error("Cannot create 2D export context.");
  }

  context.fillStyle = "#faf7f2";
  context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  context.drawImage(canvas, 0, 0);
  return exportCanvas.toDataURL("image/png");
}

function stripExtension(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

function getFileExtension(fileName: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return `${fallback} ${error.message}`;
  }
  return fallback;
}
