export function triggerPromise<T>(): [
  trigger: (result: T) => void,
  promise: Promise<T>
] {
  let trigger: (result: T) => void = () => {};
  const promise = new Promise<T>((resolve) => (trigger = resolve));
  return [trigger, promise];
}
