const Jimp = require('jimp');

/**
 * Recorta el JPEG usando las coordenadas ROI normalizadas del evento LPR.
 * Usa jimp (JavaScript puro, sin dependencias nativas).
 *
 * @param {Buffer} jpegBuffer - JPEG completo de la cámara
 * @param {object} roi - { topLeftX, topLeftY, bottomRightX, bottomRightY }
 * @param {number} paddingPct - % de padding extra alrededor del ROI (default 10%)
 * @returns {string} JPEG croppeado en base64
 */
async function cropRoi(jpegBuffer, roi, paddingPct = 0.10) {
  const { topLeftX, topLeftY, bottomRightX, bottomRightY } = roi;

  const image = await Jimp.read(jpegBuffer);
  const width  = image.bitmap.width;
  const height = image.bitmap.height;

  // Coordenadas absolutas en píxeles
  let x = topLeftX * width;
  let y = topLeftY * height;
  let w = (bottomRightX - topLeftX) * width;
  let h = (bottomRightY - topLeftY) * height;

  // Padding para dar contexto visual a la placa
  const padX = w * paddingPct;
  const padY = h * paddingPct;

  x = Math.max(0, Math.floor(x - padX));
  y = Math.max(0, Math.floor(y - padY));
  w = Math.min(width  - x, Math.ceil(w + padX * 2));
  h = Math.min(height - y, Math.ceil(h + padY * 2));

  // Fallback si ROI es inválido (ej: x=1.0 fuera de rango)
  if (w <= 0 || h <= 0 || x >= width || y >= height) {
    console.warn('[CROP] ROI inválido, usando fallback (mitad inferior)');
    x = 0;
    y = Math.floor(height * 0.5);
    w = width;
    h = Math.floor(height * 0.5);
  }

  const cropped = image.crop(x, y, w, h);
  const buffer  = await cropped.quality(85).getBufferAsync(Jimp.MIME_JPEG);
  return buffer.toString('base64');
}

module.exports = { cropRoi };
