// Split conversion to RegExps and testing to allow RegExps to be serialised
// into Workers Sites KV namespace script. This will apply filtering, before
// passing back to Miniflare's loopback server for storage access.
export interface MatcherRegExps {
  include: RegExp[];
  exclude: RegExp[];
}

export interface SerialisableMatcherRegExps {
  include: string[];
  exclude: string[];
}

export function testRegExps(matcher: MatcherRegExps, value: string): boolean {
  for (const exclude of matcher.exclude) if (exclude.test(value)) return false;
  for (const include of matcher.include) if (include.test(value)) return true;
  return false;
}

function serialiseRegExp(regExp: RegExp): string {
  const str = regExp.toString();
  return str.substring(str.indexOf("/") + 1, str.lastIndexOf("/"));
}

export function serialiseRegExps(
  matcher: MatcherRegExps
): SerialisableMatcherRegExps {
  return {
    include: matcher.include.map(serialiseRegExp),
    exclude: matcher.exclude.map(serialiseRegExp),
  };
}

export function deserialiseRegExps(
  matcher: SerialisableMatcherRegExps
): MatcherRegExps {
  return {
    include: matcher.include.map((regExp) => new RegExp(regExp)),
    exclude: matcher.exclude.map((regExp) => new RegExp(regExp)),
  };
}
