# 🔑 Variables and Secrets

## Bindings

Variable and secrets are bound as follows:

```shell
$ miniflare --binding KEY1=value1 --binding KEY2=value2 # or -b
```

```toml
# wrangler.toml
[vars]
KEY1 = "value1"
KEY2 = "value2"
```

```js
const mf = new Miniflare({
  bindings: {
    KEY1: "value1",
    KEY2: "value2",
  },
});
```

## `.env` Files

Variables and secrets are automatically loaded from a `.env` file in the current
directory. This is especially useful for secrets if your `.env` file is
`.gitignore`d. `.env` files look something like this:

```properties
KEY1=value1
# Woah, comments!
KEY2=value2
```

You can also specify the path to a custom `.env` file:

```shell
$ miniflare --env .env.test # or -e
```

```toml
# wrangler.toml
[miniflare]
env_path = ".env.test"
```

```js
const mf = new Miniflare({
  envPath: ".env.test",
});
```
