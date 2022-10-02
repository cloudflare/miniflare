import { TextDecoder } from "util";
import type { SqliteDB } from "@miniflare/shared";
import analytics from "./analytics";
import buildSQLFunctions from "./functions";

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

export const kQuery = Symbol("kQuery");

export class AnalyticsEngine {
  readonly #dataset: string;
  readonly #db: SqliteDB;
  #decoder = new TextDecoder();

  constructor(dataset: string, db: SqliteDB) {
    this.#dataset = dataset;
    this.#db = db;
    db.exec(analytics.replaceAll("{{BINDING}}", dataset));
    buildSQLFunctions(db);
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
      dataset: this.#dataset,
      index1: indexes[0],
    };
    // prep doubles
    const doublesKeys: string[] = [];
    const doublesValues: string[] = [];
    doubles.forEach((double, i) => {
      const key = `double${i + 1}` as keyof DataPoint;
      (insertData[key] as any) = double;
      doublesKeys.push(key);
      doublesValues.push(`@${key}`);
    });
    // prep blobs
    const blobsKeys: string[] = [];
    const blobsValues: string[] = [];
    _blobs.forEach((blob, i) => {
      const key = `blob${i + 1}` as keyof DataPoint;
      (insertData[key] as any) = blob;
      blobsKeys.push(key);
      blobsValues.push(`@${key}`);
    });

    const input = prepare(
      `INSERT INTO ${this.#dataset} (dataset, index1${
        doublesKeys.length > 0 ? `, ${doublesKeys}` : ""
      }${
        blobsKeys.length > 0 ? `, ${blobsKeys}` : ""
      }) VALUES (@dataset, @index1${
        doublesValues.length > 0 ? `, ${doublesValues}` : ""
      }${blobsValues.length > 0 ? `, ${blobsValues}` : ""})`
    );
    const insert = this.#db.prepare(input);

    insert.run(insertData);
  }

  async [kQuery](input: string): Promise<any> {
    const query = this.#db.prepare(prepare(input));

    return query.get();
  }
}

/** @internal */
export function prepare(input: string): string {
  // split
  const pieces = input.split(" ");
  // find all instances of "INTERVAL"
  const intervalIndexes = [];
  for (let i = 0, pl = pieces.length; i < pl; i++) {
    if (pieces[i].toLocaleLowerCase() === "interval") {
      intervalIndexes.push(i);
    }
  }
  // for each instance, convert "INTERVAL X Y" to "INTERVAL(X, Y)"
  for (const intervalIndex of intervalIndexes) {
    const [interval, value, type] = pieces.slice(
      intervalIndex,
      intervalIndex + 3
    );
    pieces[intervalIndex] = `${interval}(`;
    pieces[intervalIndex + 1] = `${value.replaceAll("'", "")},`;
    pieces[intervalIndex + 2] = `'${type.replaceAll("'", "").toUpperCase()}')`;
  }

  return pieces.join(" ");
}
