// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export default function handleRequest(request) {
  return new Response(`webpack:${request.url}`);
}
