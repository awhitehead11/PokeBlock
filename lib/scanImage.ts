/** Downscale + JPEG encode so JSON body stays under typical serverless limits (e.g. Vercel ~4.5MB). */
const MAX_SIDE = 1680;
const JPEG_QUALITY = 0.82;

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      if (typeof r.result === "string") resolve(r.result);
      else reject(new Error("read failed"));
    };
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

export async function prepareImageForScan(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return fileToDataUrl(file);
  }
  try {
    const bitmap = await createImageBitmap(file);
    let w = bitmap.width;
    let h = bitmap.height;
    if (w < 1 || h < 1) {
      bitmap.close?.();
      return fileToDataUrl(file);
    }
    if (w > MAX_SIDE || h > MAX_SIDE) {
      if (w >= h) {
        h = Math.round((h * MAX_SIDE) / w);
        w = MAX_SIDE;
      } else {
        w = Math.round((w * MAX_SIDE) / h);
        h = MAX_SIDE;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return fileToDataUrl(file);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    if (!dataUrl.startsWith("data:image/jpeg")) {
      return fileToDataUrl(file);
    }
    return dataUrl;
  } catch {
    return fileToDataUrl(file);
  }
}
