export type DwgWorkerRequest = {
  id: number;
  fileName: string;
  fileData: ArrayBuffer;
};

export type DwgWorkerProgressResponse = {
  id: number;
  type: "progress";
  message: string;
};

export type DwgWorkerSuccessResponse = {
  id: number;
  type: "success";
  dxfBuffer: ArrayBuffer;
};

export type DwgWorkerErrorResponse = {
  id: number;
  type: "error";
  error: string;
};

export type DwgWorkerResponse =
  | DwgWorkerProgressResponse
  | DwgWorkerSuccessResponse
  | DwgWorkerErrorResponse;
