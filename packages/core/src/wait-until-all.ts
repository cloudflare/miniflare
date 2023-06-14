/** This function is like Promise.all, but also handles nested changes to the promises array */
export async function waitUntilAll<WaitUntil extends any[] = unknown[]>(
  promises: Promise<any>[]
): Promise<WaitUntil> {
  let len = 0;
  let last: WaitUntil = [] as unknown as WaitUntil;
  // when the length of the array changes, there has been a nested call to waitUntil
  // and we should await the promises again
  while (len !== promises.length) {
    len = promises.length;
    last = (await Promise.all(promises)) as WaitUntil;
  }
  return last;
}
