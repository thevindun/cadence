const MAX_BYTES = 950_000        // Bluesky's limit is ~1MB; leave headroom
const MAX_DIM = 2000             // most platforms downscale past this anyway

export async function compressImage(file) {
  if (!file.type.startsWith('image/')) return file          // video/gif untouched
  if (file.size <= MAX_BYTES && file.type !== 'image/png') return file

  const bitmap = await createImageBitmap(file)
  let { width, height } = bitmap
  const scale = Math.min(1, MAX_DIM / Math.max(width, height))
  width = Math.round(width * scale); height = Math.round(height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  // Step quality down until it fits.
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q))
    if (blob && blob.size <= MAX_BYTES) {
      return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
    }
  }
  throw new Error('Image too large to compress under 1MB — try a smaller file')
}