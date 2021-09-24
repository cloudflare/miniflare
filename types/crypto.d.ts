declare module "crypto" {
  namespace webcrypto {
    const subtle: typeof crypto.subtle;
    const getRandomValues: typeof crypto.getRandomValues;
  }
}
