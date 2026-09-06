// Browser-side image shrinking for things that get stored as data URIs in
// the settings row (Railway disk is ephemeral, so the DB is where images
// live). Two flavours because the assets are different:
//
//   compressImageFile  photo-ish backgrounds -> JPEG, quality steps down
//                      until it fits. A wallpaper only needs ~1920px.
//   compressLogoFile   logos -> PNG (keeps transparency; JPEG would put a
//                      white box behind the mark), size steps down until
//                      it fits.
//
// Shared by Branding -> Logo & look and Branding -> Labels so the sticker
// logo and the screen logo are shrunk the same way.

export const compressImageFile = (file, maxDim = 1920, startQuality = 0.72, targetBytes = 700 * 1024) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          let q = startQuality;
          let dataUrl = canvas.toDataURL('image/jpeg', q);
          while (dataUrl.length > targetBytes && q > 0.4) {
            q -= 0.1;
            dataUrl = canvas.toDataURL('image/jpeg', q);
          }
          resolve(dataUrl);
        } catch (err) { reject(err); }
      };
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

export const compressLogoFile = (file, maxDim = 900, targetBytes = 380 * 1024) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          let scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          let dataUrl = '';
          // Step the size down until it fits. Resizing beats quality
          // stepping here: PNG has no quality dial, and a logo that is
          // physically smaller is still a clean logo.
          for (let i = 0; i < 6; i += 1) {
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            dataUrl = canvas.toDataURL('image/png');
            if (dataUrl.length <= targetBytes) break;
            scale *= 0.75;
          }
          resolve(dataUrl);
        } catch (err) { reject(err); }
      };
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });

// Any image file -> a logo-sized PNG data URI. Small files pass through as
// they are; big ones are shrunk. `maxBytes` matches the old Branding cap.
export const readLogoFile = async (file, maxBytes = 400 * 1024) => {
  if (file.size <= maxBytes) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Could not read that image file.'));
      reader.readAsDataURL(file);
    });
  }
  return compressLogoFile(file);
};
