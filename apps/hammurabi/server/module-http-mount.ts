import express, { type Express } from 'express'
import type { HammurabiParserDeclaration } from '../src/types/module-manifest.js'

export function mountDeclaredBodyParsers(
  app: Express,
  parsers: readonly HammurabiParserDeclaration[],
): void {
  for (const parser of parsers) {
    if (parser.kind !== 'json') {
      continue
    }

    app.use(parser.mount, express.json({
      ...(parser.limit ? { limit: parser.limit } : {}),
    }))
  }
}
