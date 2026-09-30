export function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('图片读取失败，请换一张图片重试。'));
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const max = 800;
          let width = img.width;
          let height = img.height;
          if (width > max) {
            height *= max / width;
            width = max;
          }
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]);
        } catch (err) {
          reject(new Error('图片处理失败，请换一张图片重试。'));
        }
      };
      img.onerror = () => reject(new Error('图片解码失败，请换一张图片重试。'));
      img.src = e.target.result;
    };
  });
}
