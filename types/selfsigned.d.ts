declare module "selfsigned" {
  import forge from "node-forge";

  export type Attributes = forge.pki.CertificateField[];

  export interface Options {
    days?: number;
    keySize?: number;
    extensions?: any[];
    algorithm?: string;
    pkcs7?: boolean;
    clientCertificate?: boolean;
    clientCertificateCN?: string;
  }

  export interface Certificate {
    private: string;
    public: string;
    cert: string;
    fingerprint: string;
  }

  export function generate(attrs?: Attributes, options?: Options): Certificate;
  export function generate(
    attrs: Attributes,
    options: Options,
    callback: (err: Error, certificate: Certificate) => void
  ): void;
}
