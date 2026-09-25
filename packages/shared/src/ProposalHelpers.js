import { isEqual, sortBy } from 'lodash'

// Compare persisted option identity and content, not client-only metadata or
// relation order. PostgreSQL IDs may arrive as numbers or GraphQL strings.
export function proposalOptionsEqual (left = [], right = []) {
  const normalize = options => sortBy(options.map(({ id, text, color, emoji }) => ({
    id: id == null ? null : String(id),
    text,
    color: color || '',
    emoji: emoji || ''
  })), 'id')

  return isEqual(normalize(left), normalize(right))
}
