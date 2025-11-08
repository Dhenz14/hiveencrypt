/**
 * Image processing utilities for Hive Messenger
 * Handles WebP compression, resizing, and base64 encoding
 * 
 * @module imageUtils
 */

import pako from 'pako';

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
 * Convert a Blob to ArrayBuffer
 * 
 * @param blob - The blob to convert
 * @returns Promise<ArrayBuffer> - Array buffer of binary data
 */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve(reader.result as ArrayBuffer);
    };
    reader.onerror = () => reject(new Error('Failed to convert blob to ArrayBuffer'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Gzip compress binary data (ArrayBuffer) and convert to base64
 * This compresses BEFORE base64 encoding for better compression ratios
 * 
 * @param arrayBuffer - Binary data to compress
 * @returns Promise<{ base64: string, compressionRatio: number }>
 */
export async function compressBinaryToBase64(arrayBuffer: ArrayBuffer): Promise<{ 
  base64: string; 
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
}> {
  const originalSize = arrayBuffer.byteLength;
  
  // Convert ArrayBuffer to Uint8Array
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Gzip compress the binary data
  const compressed = pako.gzip(uint8Array);
  const compressedSize = compressed.length;
  
  // Convert compressed bytes to base64
  const binaryString = Array.from(compressed).map(byte => String.fromCharCode(byte)).join('');
  const base64 = btoa(binaryString);
  
  const compressionRatio = Math.round((compressedSize / originalSize) * 100);
  
  console.log('[COMPRESS] Binary compression stats:', {
    originalSize,
    compressedSize,
    compressionRatio: `${compressionRatio}%`,
    savings: `${100 - compressionRatio}%`
  });
  
  return { base64, originalSize, compressedSize, compressionRatio };
}

/**
 * Decompress base64-encoded gzipped binary data
 * This reverses compressBinaryToBase64
 * 
 * @param base64 - Base64-encoded gzipped data
 * @returns Uint8Array - Decompressed binary data
 */
export function decompressBinaryFromBase64(base64: string): Uint8Array {
  // Decode base64 to binary string
  const binaryString = atob(base64);
  
  // Convert binary string to Uint8Array
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Gunzip decompress
  const decompressed = pako.ungzip(bytes);
  
  return decompressed;
}

/**
 * Convert a Blob to base64 string (legacy function, kept for compatibility)
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
 * Process image for blockchain storage with optimized compression
 * 
 * Pipeline:
 * 1. Convert to WebP format (70-75% savings from original)
 * 2. Gzip compress the WebP binary (20-30% additional savings)
 * 3. Base64 encode for JSON compatibility
 * 
 * @param file - Image file to process
 * @param maxWidth - Maximum width in pixels (default: 300)
 * @param quality - Compression quality 0-1 (default: 0.6)
 * @returns Promise<{ base64: string, contentType: string, compressionStats: object }>
 * 
 * @example
 * const processed = await processImageForBlockchain(imageFile);
 * console.log(`Final size: ${processed.base64.length} (${processed.compressionStats.totalSavings}% saved)`);
 */
export async function processImageForBlockchain(
  file: File,
  maxWidth: number = 300,
  quality: number = 0.6
): Promise<{ 
  base64: string; 
  contentType: string;
  compressionStats: {
    originalSize: number;
    webpSize: number;
    gzippedSize: number;
    base64Size: number;
    webpSavings: number;
    gzipSavings: number;
    totalSavings: number;
  };
}> {
  const originalSize = file.size;
  console.log('[IMAGE] 🚀 Starting blockchain processing pipeline:', {
    name: file.name,
    originalSize,
    type: file.type
  });

  // Step 1: Convert to WebP (image format compression)
  const webpBlob = await compressImageToWebP(file, maxWidth, quality);
  const webpSize = webpBlob.size;
  const webpSavings = Math.round((1 - webpSize / originalSize) * 100);
  
  console.log(`[IMAGE] ✅ Step 1/3: WebP conversion - ${webpSize} bytes (${webpSavings}% saved)`);

  // Step 2: Convert WebP to binary ArrayBuffer
  const arrayBuffer = await blobToArrayBuffer(webpBlob);
  
  // Step 3: Gzip compress the WebP binary BEFORE base64 encoding
  console.log('[IMAGE] ⚙️  Step 2/3: Gzip compressing binary data...');
  const { base64, compressedSize } = await compressBinaryToBase64(arrayBuffer);
  const gzipSavings = Math.round((1 - compressedSize / webpSize) * 100);
  
  console.log(`[IMAGE] ✅ Step 2/3: Gzip compression - ${compressedSize} bytes (${gzipSavings}% saved from WebP)`);
  
  // Step 4: Base64 encoding (already done in compressBinaryToBase64)
  const base64Size = base64.length;
  const totalSavings = Math.round((1 - base64Size / originalSize) * 100);
  
  console.log(`[IMAGE] ✅ Step 3/3: Base64 encoding - ${base64Size} bytes`);
  console.log(`[IMAGE] 🎉 Pipeline complete! Total savings: ${totalSavings}%`, {
    original: originalSize,
    webp: webpSize,
    gzipped: compressedSize,
    base64: base64Size
  });
  
  return {
    base64,
    contentType: 'image/webp',
    compressionStats: {
      originalSize,
      webpSize,
      gzippedSize: compressedSize,
      base64Size,
      webpSavings,
      gzipSavings,
      totalSavings
    }
  };
}
