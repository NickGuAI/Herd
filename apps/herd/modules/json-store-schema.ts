export const JSON_STORE_SCHEMA_VERSION = 1

export type JsonStoreSchemaVersion = typeof JSON_STORE_SCHEMA_VERSION

export type JsonStoreSchemaPayload<T extends object> = Omit<T, 'schemaVersion'> & {
  schemaVersion: JsonStoreSchemaVersion
}

export function withJsonStoreSchema<T extends object>(
  payload: T,
): JsonStoreSchemaPayload<T> {
  const rest = { ...payload } as Omit<T, 'schemaVersion'> & { schemaVersion?: unknown }
  delete rest.schemaVersion
  return {
    schemaVersion: JSON_STORE_SCHEMA_VERSION,
    ...rest,
  } as JsonStoreSchemaPayload<T>
}
