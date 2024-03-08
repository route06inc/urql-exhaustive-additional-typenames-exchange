import type { TypedDocumentNode } from '@urql/core'
import { cacheExchange, createClient, fetchExchange, gql } from '@urql/core'
import type { IntrospectionQuery } from 'graphql'
import { buildSchema, getIntrospectionQuery, graphqlSync } from 'graphql'
import { describe, expect, it } from 'vitest'

import { exhaustiveAdditionalTypenamesExchange } from '..'

const sdlString = /* GraphQL */ `
  interface Node {
    id: ID!
  }

  type Post implements Node {
    id: ID!
    title: String!
    body: String!
    comments: [Comment!]!
  }

  type User implements Node {
    id: ID!
    name: String!
    posts: [Post!]!
  }

  type UserEdge {
    cursor: String!
    node: User
  }

  type UserConnection {
    edges: [UserEdge!]!
    nodes: [User!]!
    pageInfo: PageInfo!
    totalCount: Int!
  }

  type PageInfo {
    endCursor: String
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
  }

  interface Comment {
    body: String!
    likedBy: [User!]!
  }

  type PostComment implements Comment & Node {
    id: ID!
    title: String!
    body: String!
    likedBy: [User!]!
  }

  type Query {
    nodes: [Node!]!
    node(id: ID!): Node
    users: [User!]!
    nullableUsers: [User]
    userConnection(
      after: String
      before: String
      first: Int
      last: Int
    ): UserConnection!
  }
`

// NOTE: graphqlSync()は返却型をGenericsで指定することができないため、asでキャストしている
const introspection = graphqlSync({
  schema: buildSchema(sdlString),
  source: getIntrospectionQuery(),
}).data as unknown as IntrospectionQuery

if (introspection == null) {
  throw new Error('introspection is undefined')
}

const client = createClient({
  url: 'http://localhost:8000/graphql',
  exchanges: [
    cacheExchange,
    exhaustiveAdditionalTypenamesExchange({ schema: introspection }),
    fetchExchange,
  ],
  suspense: true,
})

const run = async (query: TypedDocumentNode) => {
  const { operation } = await client.query(query, {}).toPromise()
  return operation.context.additionalTypenames
}

describe('exhaustiveAdditionalTypenamesExchange', () => {
  it('enumerates the typenames contained in the list of SelectionSet', async () => {
    const queryGql = gql`
      query sampleQuery {
        users {
          id
          name
        }
      }
    `
    const additionalTypenames = await run(queryGql)
    expect(additionalTypenames).toStrictEqual(['User'])
  })

  it('enumerates the typenames in the nested list', async () => {
    const queryGql = gql`
      query sampleQuery {
        users {
          id
          posts {
            id
            title
          }
        }
      }
    `
    const additionalTypenames = await run(queryGql)
    expect(additionalTypenames).toStrictEqual(['User', 'Post'])
  })

  it('enumerates the typenames in nullable lists', async () => {
    const queryGql = gql`
      query sampleQuery {
        nullableUsers {
          id
          name
        }
      }
    `
    const additionalTypenames = await run(queryGql)
    expect(additionalTypenames).toStrictEqual(['User'])
  })

  it('enumerates the typenames contained in the list defined as Fragment', async () => {
    const queryGql = gql`
      fragment UserFragment on User {
        id
        name
        posts {
          title
        }
      }
      query sampleQuery {
        nullableUsers {
          ...UserFragment
        }
      }
    `
    const additionalTypenames = await run(queryGql)
    expect(additionalTypenames).toStrictEqual(['User', 'Post'])
  })

  it('enumerates the typenames with duplicates removed', async () => {
    const queryGql = gql`
      query sampleQuery {
        nullableUsers {
          name
          posts {
            title
          }
        }
        users {
          name
        }
      }
    `
    const additionalTypenames = await run(queryGql)
    expect(additionalTypenames).toStrictEqual(['User', 'Post'])
  })

  it('enumerates the typenames included in Connection type', async () => {
    const queryGql = gql`
      query sampleQuery {
        userConnection(first: 10) {
          edges {
            node {
              name
            }
          }
          nodes {
            name
          }
        }
      }
    `
    const additionalTypenames = await run(queryGql)
    expect(additionalTypenames).toStrictEqual(['UserEdge', 'User'])
  })

  it('enumerates the typenames contained in the inline fragment contained in the list defined as interface', async () => {
    const queryGql = gql`
      query sampleQuery {
        nodes {
          ... on User {
            name
          }
          ... on Post {
            body
          }
        }
      }
    `
    const additionalTypenames = await run(queryGql)
    expect(additionalTypenames).toStrictEqual(['User', 'Post'])
  })

  it('enumerates the typenames contained in the FragmentSpread contained in the interface', async () => {
    const queryGql = gql`
      fragment UserFragment on User {
        posts {
          body
        }
      }

      query sampleQuery {
        node(id: "1") {
          ... on User {
            ...UserFragment
          }
        }
      }
    `
    const additionalTypenames = await run(queryGql)
    expect(additionalTypenames).toStrictEqual(['Post'])
  })

  it('enumerates the typenames contained in the List contained in the interface, contained in the Inline fragment', async () => {
    const queryGql = gql`
      fragment PostFragment on Post {
        comments {
          likedBy {
            name
          }
        }
      }

      query sampleQuery {
        node(id: "1") {
          ... on Post {
            ...PostFragment
          }
        }
      }
    `
    const additionalTypenames = await run(queryGql)
    expect(additionalTypenames).toStrictEqual(['User'])
  })

  it('enumerates the typenames contained in the List contained in the Inline fragment with interface', async () => {
    const queryGql = gql`
      fragment CommentFragment on Comment {
        likedBy {
          name
        }
      }

      query sampleQuery {
        node(id: "1") {
          ... on Comment {
            ...CommentFragment
          }
        }
      }
    `
    const additionalTypenames = await run(queryGql)
    expect(additionalTypenames).toStrictEqual(['User'])
  })

  it('enumerates the typenames contained in the List contained in the FragmentSpread and InlineFragment', async () => {
    const queryGql = gql`
      fragment NodeFragment on Node {
        ... on User {
          name
        }

        ... on Post {
          body
        }
      }

      query sampleQuery {
        nodes {
          ...NodeFragment
        }
      }
    `
    const additionalTypenames = await run(queryGql)
    expect(additionalTypenames).toStrictEqual(['User', 'Post'])
  })

  it('enumerates the typenames with duplicates removed, including user-supplied additionalTypenames', async () => {
    const queryGql = gql`
      query sampleQuery {
        users {
          id
          name
        }
      }
    `
    const { operation } = await client
      .query(queryGql, {}, { additionalTypenames: ['User', 'Post'] })
      .toPromise()
    expect(operation.context.additionalTypenames).toStrictEqual([
      'User',
      'Post',
    ])
  })
})
