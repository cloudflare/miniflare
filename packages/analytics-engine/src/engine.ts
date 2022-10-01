import { TextDecoder } from "util";
import type { SqliteDB } from "@miniflare/shared";

export interface AnalyticsEngineEvent {
  readonly doubles?: number[]; // up to 20
  readonly blobs?: (ArrayBuffer | string | null)[]; // up to 20, max sum of all blobs: 5kb
  readonly indexes?: string[]; // 0 or 1
}

interface DataPoint {
  dataset: string;
  index1: string;
  double1?: number;
  double2?: number;
  double3?: number;
  double4?: number;
  double5?: number;
  double6?: number;
  double7?: number;
  double8?: number;
  double9?: number;
  double10?: number;
  double11?: number;
  double12?: number;
  double13?: number;
  double14?: number;
  double15?: number;
  double16?: number;
  double17?: number;
  double18?: number;
  double19?: number;
  double20?: number;
  blob1?: string | null;
  blob2?: string | null;
  blob3?: string | null;
  blob4?: string | null;
  blob5?: string | null;
  blob6?: string | null;
  blob7?: string | null;
  blob8?: string | null;
  blob9?: string | null;
  blob10?: string | null;
  blob11?: string | null;
  blob12?: string | null;
  blob13?: string | null;
  blob14?: string | null;
  blob15?: string | null;
  blob16?: string | null;
  blob17?: string | null;
  blob18?: string | null;
  blob19?: string | null;
  blob20?: string | null;
}

type Doubles =
  | "double1"
  | "double2"
  | "double3"
  | "double4"
  | "double5"
  | "double6"
  | "double7"
  | "double8"
  | "double9"
  | "double10"
  | "double11"
  | "double12"
  | "double13"
  | "double14"
  | "double15"
  | "double16"
  | "double17"
  | "double18"
  | "double19"
  | "double20";

type Blobs =
  | "blob1"
  | "blob2"
  | "blob3"
  | "blob4"
  | "blob5"
  | "blob6"
  | "blob7"
  | "blob8"
  | "blob9"
  | "blob10"
  | "blob11"
  | "blob12"
  | "blob13"
  | "blob14"
  | "blob15"
  | "blob16"
  | "blob17"
  | "blob18"
  | "blob19"
  | "blob20";

export class AnalyticsEngine {
  readonly #name: string;
  readonly #db: SqliteDB;
  #decoder = new TextDecoder();

  constructor(name: string, db: SqliteDB) {
    this.#name = name;
    this.#db = db;
  }

  async writeDataPoint({
    indexes = [],
    doubles = [],
    blobs = [],
  }: AnalyticsEngineEvent): Promise<void> {
    const decoder = this.#decoder;
    // convert arrayBuffers if they exist
    const _blobs = blobs.map((blob) => {
      if (blob instanceof ArrayBuffer) {
        return decoder.decode(new Uint8Array(blob));
      }
      return blob;
    });
    // ensure user is following limits
    if (indexes.length > 1) {
      throw new Error('"indexes" can not have more than one element.');
    }
    if (doubles.length > 20) {
      throw new Error(
        '"doubles" array must contain less than or equal to 20 elements.'
      );
    }
    if (blobs.length > 20) {
      throw new Error(
        '"blobs" array must contain less than or equal to 20 elements.'
      );
    }
    const blobsSize = _blobs.reduce(
      (total, blob) => total + (blob?.length ?? 0),
      0
    );
    if (blobsSize > 50_000) {
      throw new Error('"blobs" total size must be less than 50kB.');
    }
    // prep insert
    const insertData: DataPoint = {
      dataset: this.#name,
      index1: indexes[0],
    };
    // prep doubles
    const doublesKeys: string[] = [];
    const doublesValues: string[] = [];
    doubles.forEach((double, i) => {
      const key = `double${i + 1}` as Doubles;
      insertData[key] = double;
      doublesKeys.push(key);
      doublesValues.push(`@${key}`);
    });
    // prep blobs
    const blobsKeys: string[] = [];
    const blobsValues: string[] = [];
    _blobs.forEach((blob, i) => {
      const key = `blob${i + 1}` as Blobs;
      insertData[key] = blob;
      blobsKeys.push(key);
      blobsValues.push(`@${key}`);
    });

    const insert = this.#db.prepare(
      `INSERT INTO ${this.#name} (dataset, index1${
        doublesKeys.length > 0 ? `, ${doublesKeys}` : ""
      }${
        blobsKeys.length > 0 ? `, ${blobsKeys}` : ""
      }) VALUES (@dataset, @index1${
        doublesValues.length > 0 ? `, ${doublesValues}` : ""
      }${blobsValues.length > 0 ? `, ${blobsValues}` : ""})`
    );

    insert.run(insertData);
  }
}
