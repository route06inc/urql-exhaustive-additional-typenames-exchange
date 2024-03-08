import type { Operation } from '@urql/core'
import { contextExchange } from '@urql/exchange-context'
import {
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  Kind,
  buildClientSchema,
} from 'graphql'
import type {
  FieldNode,
  FragmentDefinitionNode,
  FragmentSpreadNode,
  GraphQLField,
  GraphQLNamedType,
  GraphQLOutputType,
  GraphQLSchema,
  InlineFragmentNode,
  IntrospectionQuery,
  SelectionNode,
} from 'graphql'

/**
 * getFields() を呼び出せる型
 */
type TypeWithFields = GraphQLObjectType | GraphQLInterfaceType

const isTypeWithFields = (
  type: GraphQLNamedType | undefined
): type is TypeWithFields => {
  return (
    type instanceof GraphQLObjectType || type instanceof GraphQLInterfaceType
  )
}

/**
 * リスト型の判定 NonNullでラップされていることがある
 */
const isListType = (
  type: GraphQLOutputType
): type is GraphQLList<GraphQLOutputType> => {
  if (type instanceof GraphQLNonNull) {
    return isListType(type.ofType)
  }

  return type instanceof GraphQLList
}

/**
 *
 * GraphQLOutputType から GraphQLNamedType を取り出す
 * GraphQLOutputTypeには GraphQLList と GraphQLNonNull があるので、それを取り除きたい
 */
const getNamedType = (type: GraphQLOutputType): GraphQLNamedType => {
  if (type instanceof GraphQLNonNull || type instanceof GraphQLList) {
    return getNamedType(type.ofType)
  }
  return type
}

class AdditionalTypenamesDetector {
  private readonly schema: GraphQLSchema
  private readonly operation: Operation
  private readonly additionalTypenames: Set<string>

  constructor(schema: GraphQLSchema, operation: Operation) {
    this.schema = schema
    this.operation = operation
    this.additionalTypenames = new Set(operation.context.additionalTypenames)
  }

  public getAdditionalTypenames(): string[] {
    const queryType = this.schema.getQueryType()
    if (!queryType) return []

    for (const definition of this.operation.query.definitions) {
      if (definition.kind !== Kind.OPERATION_DEFINITION) continue

      for (const selection of definition.selectionSet.selections) {
        this.exploreSelections(selection, queryType, false)
      }
    }

    return Array.from(this.additionalTypenames)
  }

  private addListFieldToAdditionalTypenames(
    field: GraphQLField<unknown, unknown>
  ) {
    if (!isListType(field.type)) return

    const fieldType = getNamedType(field.type.ofType)
    this.additionalTypenames.add(fieldType.name)
  }

  /**
   * 下記のような単純なフィールド定義を辿る
   * ```graphql
   * query { users { name }
   * ```
   */
  private exploreField(fieldNode: FieldNode, parentType: GraphQLNamedType) {
    if (!isTypeWithFields(parentType)) return

    const fieldName = fieldNode.name.value
    const field = parentType.getFields()[fieldName]
    if (!field) return

    const fieldType = getNamedType(field.type)
    if (!(fieldType instanceof GraphQLInterfaceType)) {
      this.addListFieldToAdditionalTypenames(field)
    }

    const fieldIsList = isListType(field.type)

    for (const s of fieldNode.selectionSet?.selections || []) {
      this.exploreSelections(s, fieldType, fieldIsList)
    }
  }

  /**
   * 下記のようなスプレッド構文のFragmentを辿る
   * ```graphql
   * fragment UserFragment on User { name }
   * query getUsers { users { ...UserFragment } }
   * ```
   */
  private exploreFragmentSpread(
    fragmentSpreadNode: FragmentSpreadNode,
    isList: boolean
  ) {
    const foundFragment = this.resolveFragment(fragmentSpreadNode.name.value)
    if (!foundFragment) return

    const fragmentOnType = this.schema.getType(
      foundFragment.typeCondition.name.value
    )
    if (!isTypeWithFields(fragmentOnType)) return

    for (const s of foundFragment.selectionSet?.selections || []) {
      this.exploreSelections(s, fragmentOnType, isList)
    }
  }

  /**
   * 下記のようなインラインのFragmentを辿る
   * ```graphql
   * query { node(id: "1") { ... on User { name } } }
   * ```
   */
  private exploreInlineFragment(
    inlineFragmentNode: InlineFragmentNode,
    isList: boolean
  ) {
    if (inlineFragmentNode.typeCondition?.name.value === undefined) return

    const fieldType = this.schema.getType(
      inlineFragmentNode.typeCondition.name.value
    )
    if (!isTypeWithFields(fieldType)) return

    if (isList) {
      this.additionalTypenames.add(fieldType.name)
    }

    for (const s of inlineFragmentNode.selectionSet?.selections || []) {
      this.exploreSelections(s, fieldType, false)
    }
  }

  private exploreSelections(
    selectionNode: SelectionNode,
    parentType: GraphQLNamedType,
    isList: boolean
  ) {
    switch (selectionNode.kind) {
      case 'Field':
        this.exploreField(selectionNode, parentType)
        break
      case 'FragmentSpread':
        this.exploreFragmentSpread(selectionNode, isList)
        break
      case 'InlineFragment':
        this.exploreInlineFragment(selectionNode, isList)
        break
    }
  }

  private resolveFragment(
    fragmentName: string
  ): FragmentDefinitionNode | undefined {
    const fragments = this.operation.query.definitions.filter(
      (definition) => definition.kind === Kind.FRAGMENT_DEFINITION
    ) as FragmentDefinitionNode[]
    const fragmentMap = new Map(
      fragments.map((definition) => [definition.name.value, definition])
    )
    return fragmentMap.get(fragmentName)
  }
}

// urqlのgraphcacheで定義している型を参考
// @see: https://github.com/urql-graphql/urql/blob/8ff4e3e449b7eece8a64566f54b04dfdb534eccb/exchanges/graphcache/src/ast/schema.ts?plain=1#L42
interface PartialIntrospectionSchema {
  queryType: { name: string; kind?: unknown }
  mutationType?: { name: string; kind?: unknown } | null
  subscriptionType?: { name: string; kind?: unknown } | null
  types?: readonly unknown[]
}

type IntrospectionData =
  | IntrospectionQuery
  | { __schema: PartialIntrospectionSchema }

type ExhaustiveAdditionalTypenamesExchangeOptions = {
  /**
   * A serialized GraphQL schema that is used by detect list fields.
   */
  schema: IntrospectionData
  /**
   * If true, the detected list fields will be logged to the console.
   */
  debug?: boolean
}

export const exhaustiveAdditionalTypenamesExchange = ({
  schema: _schema,
  debug,
}: ExhaustiveAdditionalTypenamesExchangeOptions) => {
  // PartialIntrospectionSchemaなので型は合わない
  // ちゃんとやるならurqlのgraphcacheのようにbuildClientSchemaを自前で実装する必要がある
  // @see: https://github.com/urql-graphql/urql/blob/8ff4e3e449b7eece8a64566f54b04dfdb534eccb/exchanges/graphcache/src/ast/schema.ts?plain=1#L46
  // @ts-expect-error
  const schema = buildClientSchema(_schema)

  return contextExchange({
    getContext: (operation) => {
      const detector = new AdditionalTypenamesDetector(schema, operation)
      const additionalTypenames = detector.getAdditionalTypenames()

      if (debug) {
        console.info('[DEBUG] exhaustiveAdditionalTypenamesExchange:', {
          operation,
          additionalTypenames,
        })
      }

      return {
        ...operation.context,
        additionalTypenames,
      }
    },
  })
}
