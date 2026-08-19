/**
 * Shrinks a photograph until it will fit in a request.
 *
 * A payment screenshot straight off a phone is three or four megabytes, and the
 * API rejects a body over 256 KB. Sending it and letting the customer discover
 * that from an error message would be the wrong way round — they are standing
 * somewhere with a screenshot and a locked phone. So the browser does the work:
 * scale down, then drop quality until the result fits, and only then upload.
 *
 * JPEG, not PNG. A screenshot of a bank app is a photograph as far as
 * compression is concerned, and PNG would be several times larger for no
 * visible gain.
 */

/** Matches `PROOF_IMAGE_MAX_CHARS` on the server, less a little headroom. */
const MAX_CHARS = 170_000;
const MAX_DIMENSION = 1400;
const QUALITY_STEPS = [0.7, 0.55, 0.4, 0.3];

export async function shrinkImageForUpload(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose an image.');
  }

  const bitmap = await loadImage(file);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot process the image.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  for (const quality of QUALITY_STEPS) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= MAX_CHARS) return dataUrl;
  }

  // Every quality step was still too big — the image is enormous or nearly all
  // detail. Halving the dimensions once more is the last try before giving up.
  const smaller = document.createElement('canvas');
  smaller.width = Math.round(canvas.width / 2);
  smaller.height = Math.round(canvas.height / 2);
  smaller.getContext('2d')?.drawImage(canvas, 0, 0, smaller.width, smaller.height);

  const last = smaller.toDataURL('image/jpeg', 0.5);
  if (last.length > MAX_CHARS) {
    throw new Error('That image is too large to send. Please take a screenshot rather than a photo of the screen.');
  }
  return last;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      // The object URL is the only thing here that would leak if left behind.
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };

    image.src = url;
  });
}
