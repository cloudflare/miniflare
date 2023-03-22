declare module "crypto" {
  namespace webcrypto {
    interface SubtleCrypto {
      timingSafeEqual(
        a: ArrayBuffer | ArrayBufferView,
        b: ArrayBuffer | ArrayBufferView
      ): boolean;
    }
  }
}
