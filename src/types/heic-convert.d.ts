declare module 'heic-convert' {
  interface ConvertOptions {
    buffer: ArrayBufferLike;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }

  function heicConvert(options: ConvertOptions): Promise<ArrayBuffer>;
  export default heicConvert;
}
