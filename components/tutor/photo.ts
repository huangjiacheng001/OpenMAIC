import { MAX_TUTOR_PHOTO } from '@/lib/tutor/protocol';

export async function prepareTutorPhoto(file: File): Promise<string> {
  if (file.size === 0 || file.size > 24_000_000) throw new Error('图片大小超出限制');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('无法读取图片');
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('无法处理图片');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.84, 0.68, 0.5, 0.36]) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= MAX_TUTOR_PHOTO) return data;
    }
    throw new Error('图片大小超出限制');
  } finally {
    URL.revokeObjectURL(url);
  }
}
