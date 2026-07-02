export function isHeicName(name: string) {
  return /\.hei[cf]$/i.test(name)
}

async function heicToJpegBlob(blob: Blob): Promise<Blob> {
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.85 })
  return Array.isArray(out) ? out[0] : out
}

// Browsers cannot render HEIC in <img>; convert iPhone photos to JPEG
// before upload so stored receipts are universally viewable.
export async function normalizeImageFile(file: File): Promise<File> {
  const isHeic = isHeicName(file.name) || file.type === 'image/heic' || file.type === 'image/heif'
  if (!isHeic) return file
  const jpeg = await heicToJpegBlob(file)
  return new File([jpeg], file.name.replace(/\.hei[cf]$/i, '.jpg'), { type: 'image/jpeg' })
}

// For HEIC files already in storage: fetch, convert, return an object URL.
// Caller must URL.revokeObjectURL when done.
export async function heicBlobToObjectUrl(blob: Blob): Promise<string> {
  const jpeg = await heicToJpegBlob(blob)
  return URL.createObjectURL(jpeg)
}
