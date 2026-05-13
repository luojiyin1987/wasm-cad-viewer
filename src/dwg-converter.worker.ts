/// <reference lib="webworker" />

import createModule, {
  type DRW_Database,
  type DRW_DwgR,
  type DRW_FileHandler,
  type MainModule
} from "@mlightcad/libdxfrw-web";
import wasmUrl from "@mlightcad/libdxfrw-web/dist/libdxfrw.wasm?url";
import {
  LibreDwg,
  createModule as createLibreDwgModule
} from "@mlightcad/libredwg-web";
import libredwgWasmUrl from "@mlightcad/libredwg-web/wasm/libredwg-web.wasm?url";
import type {
  DwgWorkerErrorResponse,
  DwgWorkerProgressResponse,
  DwgWorkerRequest,
  DwgWorkerSuccessResponse
} from "./dwg-worker-protocol";

const workerScope = self as DedicatedWorkerGlobalScope;

let modulePromise: Promise<MainModule> | null = null;
let libreDwgPromise: Promise<LibreDwg> | null = null;
const queue: DwgWorkerRequest[] = [];
let isBusy = false;

workerScope.addEventListener("message", (event: MessageEvent<DwgWorkerRequest>) => {
  queue.push(event.data);
  void processQueue();
});

async function processQueue(): Promise<void> {
  if (isBusy) {
    return;
  }
  isBusy = true;

  while (queue.length > 0) {
    const request = queue.shift()!;
    await processRequest(request);
  }

  isBusy = false;
}

async function processRequest(request: DwgWorkerRequest): Promise<void> {
  const { id, fileData } = request;

  try {
    const dxfBuffer = await convertDwgToDxf(id, fileData);
    const response: DwgWorkerSuccessResponse = {
      id,
      type: "success",
      dxfBuffer
    };
    workerScope.postMessage(response, [dxfBuffer]);
  } catch (error) {
    const response: DwgWorkerErrorResponse = {
      id,
      type: "error",
      error: error instanceof Error ? error.message : "DWG conversion failed."
    };
    workerScope.postMessage(response);
  }
}

function getLibdxfrwModule(): Promise<MainModule> {
  modulePromise ??= createModule({
    locateFile(path: string) {
      if (path === "libdxfrw.wasm") {
        return wasmUrl;
      }
      return path;
    }
  });
  return modulePromise;
}

async function convertDwgToDxf(id: number, fileData: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    postProgress(id, "实验性 DWG 支持：正在加载 libdxfrw...");
    return await convertWithLibdxfrw(id, fileData);
  } catch (primaryError) {
    const primaryMessage = toErrorMessage(primaryError);
    postProgress(id, `libdxfrw 失败，正在尝试 libredwg fallback...`);

    try {
      return await convertWithLibredwg(id, fileData);
    } catch (fallbackError) {
      const fallbackMessage = toErrorMessage(fallbackError);
      throw new Error(
        `libdxfrw 失败：${primaryMessage}；libredwg 失败：${fallbackMessage}`
      );
    }
  }
}

async function convertWithLibdxfrw(id: number, fileData: ArrayBuffer): Promise<ArrayBuffer> {
  const libdxfrw = await getLibdxfrwModule();

  postProgress(id, "实验性 DWG 支持：libdxfrw 正在解析 DWG...");

  let database: DRW_Database | null = null;
  let fileHandler: DRW_FileHandler | null = null;
  let dwgReader: DRW_DwgR | null = null;

  try {
    database = new libdxfrw.DRW_Database();
    fileHandler = new libdxfrw.DRW_FileHandler();
    fileHandler.database = database;

    dwgReader = new libdxfrw.DRW_DwgR(fileData);
    const readOk = dwgReader.read(fileHandler, false);

    if (!readOk) {
      const errorCode = dwgReader.getError().value;
      throw new Error(`DWG 解析失败，底层错误码 ${errorCode}。`);
    }

    postProgress(id, "实验性 DWG 支持：libdxfrw 正在导出临时 DXF...");
    const dxfContent = fileHandler.fileExport(
      libdxfrw.DRW_Version.AC1021,
      false,
      database,
      false
    );

    if (!dxfContent) {
      throw new Error("DWG 已读取，但 DXF 导出结果为空。");
    }

    return new TextEncoder().encode(dxfContent).buffer;
  } finally {
    dwgReader?.delete();
    fileHandler?.delete();
    database?.delete();
  }
}

async function convertWithLibredwg(id: number, fileData: ArrayBuffer): Promise<ArrayBuffer> {
  postProgress(id, "实验性 DWG 支持：正在加载 libredwg...");
  const libreDwg = await getLibreDwg();

  postProgress(id, "实验性 DWG 支持：libredwg 正在尝试转换...");
  const dxfBytes = libreDwg.dwg_write_dxf(fileData);

  if (!dxfBytes || dxfBytes.byteLength === 0) {
    throw new Error("DWG 可以读取，但 libredwg 没有产出 DXF。");
  }

  const copy = new Uint8Array(dxfBytes).slice().buffer;
  return copy;
}

async function getLibreDwg(): Promise<LibreDwg> {
  libreDwgPromise ??= createLibreDwgModule({
    locateFile(path: string) {
      if (path === "libredwg-web.wasm") {
        return libredwgWasmUrl;
      }
      return path;
    }
  }).then((wasmInstance) => LibreDwg.createByWasmInstance(wasmInstance));

  return libreDwgPromise;
}

function postProgress(id: number, message: string): void {
  const response: DwgWorkerProgressResponse = {
    id,
    type: "progress",
    message
  };
  workerScope.postMessage(response);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
