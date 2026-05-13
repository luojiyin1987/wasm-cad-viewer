import "./style.css";

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
          文件只在浏览器内解析和渲染。当前 MVP 聚焦 DXF 预览与单页 PDF 导出，
          DWG 保留为下一阶段的 WebAssembly 实验能力。
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
            <strong>DXF MVP</strong>
            <p>预览、缩放适配、导出 PDF 先闭环，DWG 稍后接入。</p>
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
          <p class="dropzone-title">拖入 DXF 文件，或手动选择</p>
          <p class="dropzone-copy">
            DWG 会提示为“计划中”，当前不会上传也不会后台转换。
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
          <p class="status-text" data-role="status-text">等待导入 DXF 文件。</p>
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
            <p>DXF 载入后会在这里渲染。</p>
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
});

async function openCadFile(file: File): Promise<void> {
  const extension = getFileExtension(file.name);

  if (extension === "dwg") {
    currentFile = null;
    cleanupObjectUrl();
    setStatus("DWG 接入位已预留，但当前 MVP 只启用 DXF。");
    refs.metaText.textContent = `${file.name} · 计划中`;
    refs.fitButton.disabled = true;
    refs.exportButton.disabled = true;
    return;
  }

  if (extension !== "dxf") {
    currentFile = null;
    cleanupObjectUrl();
    setStatus("当前仅支持导入 DXF 文件。");
    refs.metaText.textContent = `${file.name} · 不支持`;
    refs.fitButton.disabled = true;
    refs.exportButton.disabled = true;
    return;
  }

  currentFile = file;
  cleanupObjectUrl();
  currentObjectUrl = URL.createObjectURL(file);

  setStatus("正在解析 DXF...");
  refs.metaText.textContent = `${file.name} · ${formatBytes(file.size)}`;
  refs.fitButton.disabled = true;
  refs.exportButton.disabled = true;

  try {
    const activeViewer = await ensureViewer(refs.viewerMount);
    await activeViewer.Load({
      url: currentObjectUrl,
      progressCbk: (phase, processedSize, totalSize) => {
        const detail = totalSize > 0
          ? `${phase} · ${Math.round((processedSize / totalSize) * 100)}%`
          : `${phase} · ${formatBytes(processedSize)}`;
        refs.statusText.textContent = `正在处理：${detail}`;
      }
    });

    const bounds = activeViewer.GetBounds();
    if (bounds) {
      activeViewer.FitView(bounds.minX, bounds.maxX, bounds.minY, bounds.maxY, 24);
    }
    activeViewer.Render();

    refs.fitButton.disabled = false;
    refs.exportButton.disabled = false;
    setStatus("DXF 已载入，可以预览或导出 PDF。");
  } catch (error) {
    refs.fitButton.disabled = true;
    refs.exportButton.disabled = true;
    setStatus(formatError(error, "DXF 载入失败。"));
  }
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
