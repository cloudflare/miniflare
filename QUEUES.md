# Queues in Miniflare Example

TODO: These are some temporary instructions for running the current working
Queues example, not meant for the final PR.

## Configuration

### myworker (Fetch handler + Publisher)

See `myworker/wrangler.toml` and `myworker/src/index.mjs`.

`myworker` has a binding that allows it to publish messages to `queue1` in
response to fetch requests.

### consumer (Queue handler)

See `consumer/wrangler.toml` and `consumer/src/index.mjs`.

`consumer` is configured to subscribe from `queue1` with a custom batch size and
max wait time.

## Run the example

Build miniflare and start the server.

```bash
npm install
npm run build
npx miniflare --modules --mount myworker=./myworker --mount consumer=./consumer
```

The publisher worker (`myworker`) is configured to handle `fetch()` requests and
send messages to the queue. Messages will be delivered after a full batch is
reached, or after the timeout.

```bash
curl http://127.0.0.1:8787/test
```

Output:

```
myworker fetch!
GET /test 200 OK (12.28ms)
consumer.queue() received batch from queue "queue1":
        hello queue1: 1
        hello queue1: 2
        hello queue1: 3
[mf:inf:consumer] queue1 (3 Messages) OK
```
