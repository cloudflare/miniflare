export default async function () {
  const module = await import("./text.txt");
  return module.default;
}
