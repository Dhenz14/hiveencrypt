/**
 * Image processing utilities for Hive Messenger
 * Handles WebP compression, resizing, and base64 encoding
 * 
 * @module imageUtils
 */

/**
 * Compress an image to WebP format with specified dimensions and quality
 * WebP provides 25-40% better compression than JPEG
 * 
 * @param file - The image file to compress
 * @param maxWidth - Maximum width in pixels (default: 300)
 * @param quality - Compression quality 0-1 (default: 0.6)
 * @returns Promise<Blob> - Compressed WebP image blob
 * 
 * @example
 * const compressed = await compressImageToWebP(imageFile, 300, 0.6);
 * console.log(`Original: ${imageFile.size}, Compressed: ${compressed.size}`);
 */
export async function compressImageToWebP(
  file: File,
  maxWidth: number = 300,
  quality: number = 0.6
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(
          (blob) => {
            if (blob) {
              console.log('[IMAGE] Compressed:', {
                original: file.size,
                compressed: blob.size,
                reduction: Math.round((1 - blob.size / file.size) * 100) + '%',
                dimensions: `${width}x${height}`
              });
              resolve(blob);
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          'image/webp',
          quality
        );
      };
      
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a Blob to base64 string
 * 
 * @param blob - The blob to convert
 * @returns Promise<string> - Base64 encoded string
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      const base64Data = base64.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = () => reject(new Error('Failed to convert blob to base64'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Estimate final encrypted size after all transformations
 * 
 * @param base64Length - Length of base64 image data
 * @returns Estimated final size in bytes
 * 
 * Calculation:
 * - Base64 image: input
 * - JSON wrapping with short keys: +25%
 * - Gzip compression: -75%
 * - Memo encryption: +30%
 */
export function estimateEncryptedSize(base64Length: number): number {
  const withJsonWrapping = base64Length * 1.25;
  const afterGzip = withJsonWrapping * 0.25;
  const afterEncryption = afterGzip * 1.30;
  return Math.ceil(afterEncryption);
}

/**
 * Calculate how many chunks will be needed for a given payload size
 * 
 * @param encryptedSize - Size of encrypted payload in bytes
 * @param chunkSize - Maximum chunk size (default: 7000)
 * @returns Number of chunks required
 */
export function calculateChunksNeeded(encryptedSize: number, chunkSize: number = 7000): number {
  return Math.ceil(encryptedSize / chunkSize);
}

/**
 * Validate image file type and size
 * 
 * @param file - File to validate
 * @param maxSizeMB - Maximum file size in MB (default: 5)
 * @returns { valid: boolean, error?: string }
 */
export function validateImageFile(file: File, maxSizeMB: number = 5): { valid: boolean; error?: string } {
  if (!file.type.startsWith('image/')) {
    return { valid: false, error: 'File must be an image' };
  }
  
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return { valid: false, error: `Image must be smaller than ${maxSizeMB}MB` };
  }
  
  return { valid: true };
}

/**
 * Create a data URL from a base64 string
 * 
 * @param base64 - Base64 encoded image data
 * @param mimeType - MIME type (default: 'image/webp')
 * @returns Data URL string
 */
export function createDataURL(base64: string, mimeType: string = 'image/webp'): string {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Process image for blockchain storage
 * Combines compression and base64 encoding in a single step
 * 
 * @param file - Image file to process
 * @param maxWidth - Maximum width in pixels (default: 300)
 * @param quality - Compression quality 0-1 (default: 0.6)
 * @returns Promise<{ base64: string, contentType: string }> - Processed image data
 * 
 * @example
 * const processed = await processImageForBlockchain(imageFile);
 * console.log(`Base64 length: ${processed.base64.length}`);
 */
export async function processImageForBlockchain(
  file: File,
  maxWidth: number = 300,
  quality: number = 0.6
): Promise<{ base64: string; contentType: string }> {
  console.log('[IMAGE] Processing for blockchain:', {
    name: file.name,
    size: file.size,
    type: file.type
  });

  const compressedBlob = await compressImageToWebP(file, maxWidth, quality);
  const base64 = await blobToBase64(compressedBlob);
  
  return {
    base64,
    contentType: 'image/webp'
  };
}
