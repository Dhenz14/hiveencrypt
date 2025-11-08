import pako from 'pako';

/**
 * Gzip compression utilities for Hive custom_json payload optimization
 * Provides 70-75% compression ratio for JSON data
 * 
 * @module compression
 */

/**
 * Compress a string using Gzip and encode to base64
 * 
 * @param data - The string data to compress
 * @returns Base64-encoded compressed data
 * 
 * @example
 * const json = JSON.stringify({ message: "Hello World" });
 * const compressed = gzipCompress(json);
 * console.log(`Original: ${json.length}, Compressed: ${compressed.length}`);
 */
export function gzipCompress(data: string): string {
  try {
    const compressed = pako.gzip(data);
    return btoa(String.fromCharCode(...compressed));
  } catch (error) {
    console.error('[COMPRESSION] Gzip compression failed:', error);
    throw new Error('Failed to compress data');
  }
}

/**
 * Decompress a base64-encoded Gzip string
 * 
 * @param compressedBase64 - Base64-encoded compressed data
 * @returns Decompressed original string
 * 
 * @example
 * const original = gzipDecompress(compressed);
 * console.log('Decompressed:', original);
 */
export function gzipDecompress(compressedBase64: string): string {
  try {
    const binaryString = atob(compressedBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const decompressed = pako.ungzip(bytes, { to: 'string' });
    return decompressed;
  } catch (error) {
    console.error('[COMPRESSION] Gzip decompression failed:', error);
    throw new Error('Failed to decompress data');
  }
}

/**
 * Calculate compression ratio as percentage
 * 
 * @param originalSize - Original data size in bytes
 * @param compressedSize - Compressed data size in bytes
 * @returns Compression ratio percentage (e.g., 25.5 means compressed to 25.5% of original)
 */
export function getCompressionRatio(originalSize: number, compressedSize: number): number {
  return (compressedSize / originalSize) * 100;
}

/**
 * Validate if compression is beneficial (compressed < 90% of original)
 * 
 * @param originalSize - Original data size
 * @param compressedSize - Compressed data size
 * @returns true if compression provides meaningful benefit
 */
export function isCompressionBeneficial(originalSize: number, compressedSize: number): boolean {
  return compressedSize < originalSize * 0.9;
}
