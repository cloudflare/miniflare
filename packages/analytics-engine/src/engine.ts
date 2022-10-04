import { TextDecoder } from "util";
import type { SqliteDB } from "@miniflare/shared";
import analytics from "./analytics";
import buildSQLFunctions, { isDate } from "./functions";

export type Format = "JSON" | "JSONEachRow" | "TabSeparated";

export type MetaType = "DateTime" | "String" | "Float64";

export interface AnalyticsEngineEvent {
  readonly doubles?: number[]; // up to 20
  readonly blobs?: (ArrayBuffer | string | null)[]; // up to 20, max sum of all blobs: 5kb
  readonly indexes?: string[]; // 0 or 1
}

interface DataPoint {
  dataset: string;
  index1?: string;
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

export interface ResponseData {
  [key: string]: number | string;
}

export interface FormatJSON {
  meta: { [key: string]: MetaType };
  data: ResponseData[];
  rows: number;
}

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

  writeDataPoint({
    indexes = [],
    doubles = [],
    blobs = [],
  }: AnalyticsEngineEvent): void {
    const decoder = this.#decoder;
    for (const blob of blobs) {
      if (
        blob !== null &&
        typeof blob !== "string" &&
        !(blob instanceof ArrayBuffer)
      ) {
        throw new Error('"blobs" may only be an ArrayBuffer, string, or null.');
      }
    }
    for (const double of doubles) {
      if (typeof double !== "number") {
        throw new Error('"doubles" may only contain numbers.');
      }
    }
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

    const [input] = _prepare(
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
}

/** @internal */
export function _prepare(input: string): [string, Format | undefined] {
  // split
  const pieces = input
    .replaceAll("\n", " ") // convert new lines to spaces
    .replaceAll(",", " , ") // ensure commas exist by themselves
    .replaceAll("(", "( ") // seperate following word of opening "("
    .replaceAll(")", " )") // seperate out close ")"
    .split(" ") // split via spaces
    .filter((l) => l !== ""); // remove excess spaces
  // find all instances of "INTERVAL" and "QUANTILEWEIGHTED"
  const intervalIndexes = [];
  const quantileweigthedIndexes = [];
  let formatIndex = -1;
  for (let i = 0, pl = pieces.length; i < pl; i++) {
    const piece = pieces[i].toLocaleLowerCase();
    if (piece === "interval") {
      intervalIndexes.push(i);
    }
    if (piece.includes("quantileweighted")) {
      quantileweigthedIndexes.push(i);
    }
    if (piece === "format") formatIndex = i;
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

  // for each instance of quantileweighted, seperately aggregate columns;
  for (const qwIndex of quantileweigthedIndexes) {
    // What if "quantileweighted (", the space between the two could cause an error
    // adjust to "quantileweighted("
    if (pieces[qwIndex + 1] === "(") {
      pieces.splice(qwIndex + 1, 1);
      pieces[qwIndex] = `${pieces[qwIndex]}(`;
    }
    pieces[qwIndex + 3] = `__GET_QUANTILE_GROUP(${pieces[qwIndex + 3]})`;
    pieces[qwIndex + 5] = `__GET_QUANTILE_GROUP(${pieces[qwIndex + 5]})`;
  }

  // if FORMAT exists, grab type and remove it
  let formatType: Format = "JSON";
  if (formatIndex >= 0) {
    // change to new type. revert to JSON if unknown name
    formatType = pieces[formatIndex + 1] as Format;
    if (
      formatType !== "JSON" &&
      formatType !== "JSONEachRow" &&
      formatType !== "TabSeparated"
    ) {
      formatType = "JSON";
    }
    // remove from string
    pieces.splice(formatIndex, 1);
    pieces.splice(formatIndex, 1);
  }

  return [pieces.join(" "), formatType];
}

/** @internal */
export function _format(
  data: ResponseData[] = [],
  format: Format = "JSON"
): string | FormatJSON {
  if (format === "JSON") return _formatJSON(data);
  else if (format === "JSONEachRow") return _formatJSONEachRow(data);
  else return _formatTabSeparated(data);
}

function _formatJSON(data: ResponseData[]): FormatJSON {
  const meta: { [key: string]: MetaType } = {};
  // incase one of the data points might have a null value but another might not
  for (const point of data) {
    for (const [key, value] of Object.entries(point)) {
      if (value !== null) meta[key] = _getType(value);
    }
  }

  return {
    meta,
    data,
    rows: data.length,
  };
}

function _formatJSONEachRow(data: ResponseData[]): string {
  let res = "";

  for (const point of data) {
    res += `${JSON.stringify(point)}\n`;
  }

  return res;
}

function _formatTabSeparated(data: ResponseData[]): string {
  let res = "";

  for (const point of data) {
    res += `${Object.values(point).join("\t")}\n`;
  }

  return res;
}

function _getType(input: number | string): MetaType {
  if (typeof input === "number") return "Float64";
  if (isDate(input)) return "DateTime";
  return "String";
}
