/* eslint-disable @typescript-eslint/ban-types */
// Copy of internal `chain.ts` file. used for creating a custom `describe`
// function that pushes/pops stacked storage on entry/exit.

/*!
 * https://github.com/vitest-dev/vitest/blob/69d55bc19c8ca6e1dfb28724eb55a45aefc37562/packages/vitest/src/runtime/chain.ts
 *
 * MIT License
 *
 * Copyright (c) 2021-Present Anthony Fu <https://github.com/antfu>
 * Copyright (c) 2021-Present Matias Capeletto <https://github.com/patak-dev>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export type ChainableFunction<
  T extends string,
  Args extends any[],
  R = any,
  E = {}
> = {
  (...args: Args): R;
} & {
  [x in T]: ChainableFunction<T, Args, R, E>;
} & {
  fn: (this: Record<T, boolean | undefined>, ...args: Args) => R;
} & E;

export function createChainable<
  T extends string,
  Args extends any[],
  R = any,
  E = {}
>(
  keys: T[],
  fn: (this: Record<T, boolean | undefined>, ...args: Args) => R
): ChainableFunction<T, Args, R, E> {
  function create(context: Record<T, boolean | undefined>) {
    const chain = function (this: any, ...args: Args) {
      return fn.apply(context, args);
    };
    Object.assign(chain, fn);
    chain.withContext = () => chain.bind(context);
    for (const key of keys) {
      Object.defineProperty(chain, key, {
        get() {
          return create({ ...context, [key]: true });
        },
      });
    }
    return chain;
  }

  const chain = create({} as any) as any;
  chain.fn = fn;
  return chain;
}
