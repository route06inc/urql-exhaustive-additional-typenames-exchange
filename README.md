# urql-exhaustive-additional-typenames-exchange

[![npm version](https://badge.fury.io/js/urql-exhaustive-additional-typenames-exchange.svg)](https://badge.fury.io/js/urql-exhaustive-additional-typenames-exchange)
[![ci](https://github.com/route06inc/urql-exhaustive-additional-typenames-exchange/actions/workflows/ci.yml/badge.svg)](https://github.com/route06inc/urql-exhaustive-additional-typenames-exchange/actions/workflows/ci.yml)

`urql-exhaustive-additional-typenames-exchange` add all list fields in an operation to additionalTypenames.  
This is useful if your project is more about avoiding the risk of bugs from cache operations than cache efficiency.

## Motivation

When working with the document cache, you need to consider which types to add to additionalTypenames. As mentioned in [Document Cache Gotchas](https://commerce.nearform.com/open-source/urql/docs/basics/document-caching/#document-cache-gotchas), in situations where the response data for a list field is empty, that type should be added. However, attempting to do this rigorously can make it difficult to enumerate the type correctly, as it is often only apparent at runtime. Therefore, the basic policy for this custom exchange is to "add all list fields in the operation to additionalTypenames". This approach may reduce cache efficiency, but we do not see this as a problem if the priority is to minimize the risk of bugs.

related: https://github.com/urql-graphql/urql/discussions/3440

## Installation

```sh
pnpm add urql-exhaustive-additional-typenames-exchange
```

## Usage

```ts
import { Client, cacheExchange, fetchExchange } from "urql";
import { exhaustiveAdditionalTypenamesExchange } from "urql-exhaustive-additional-typenames-exchange";
import schema from "./generated/minified.json";

const client = new Client({
  url: "http://localhost:3000/graphql",
  exchanges: [
    cacheExchange,
    exhaustiveAdditionalTypenamesExchange({ schema }),
    fetchExchange,
  ],
});
```

### Providing schema

You may have noticed that `schema` is passed. This exchange requires a schema definition to identify the types included in the operation at runtime.  
It is similar to that used in [Schema Awareness](https://commerce.nearform.com/open-source/urql/docs/graphcache/schema-awareness/) in GraphCache.

Here is how to get a minified schema using [GraphQL Code Generator](https://the-guild.dev/graphql/codegen) and the [@urql/introspection](https://www.npmjs.com/package/@urql/introspection) package provided by urql.

```sh
pnpm add -D @graphql-codegen/cli @graphql-codegen/introspection @urql/introspection
```

```js
//lib/minifyIntrospection.mjs

#!/usr/bin/env node
import { minifyIntrospectionQuery } from '@urql/introspection'
import * as fs from 'fs'

const main = () => {
  const json = fs.readFileSync('./generated/introspection.json', 'utf8')
  const minified = minifyIntrospectionQuery(JSON.parse(json))

  fs.writeFileSync('./generated/minified.json', JSON.stringify(minified))
}

main()
```

```ts
// codegen.ts
import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
  schema: `http://localhost:3000/graphql`,
  generates: {
    ["/generated/introspection.json"]: {
      plugins: ["introspection"],
      config: {
        minify: true,
      },
      hooks: {
        afterOneFileWrite: ["node lib/minifyIntrospection.mjs"],
      },
    },
  },
};

export default config;
```

### Options

| Input  | Description                                                      |
| ------ | ---------------------------------------------------------------- |
| schema | A serialized GraphQL schema that is used by detect list fields.  |
| debug  | If true, the detected list fields will be logged to the console. |

## Contributing

If you'd like to contribute, please fork the repository and use a feature branch. Pull requests are warmly welcome.

## License

MIT

## Related articles

- [urqlのDocument Cachingを安全に運用する - ROUTE06 Tech Blog](https://tech.route06.co.jp/entry/2024/03/13/134852)
