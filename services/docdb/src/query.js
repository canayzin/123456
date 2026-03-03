const ALLOWED_ORDER_FIELDS = new Set(['created_at', 'updated_at', 'id']);
const ALLOWED_OPS = new Set(['==', '!=']);

export function buildStructuredQuery(input) {
  if (!input?.collection || typeof input.collection !== 'string') {
    throw new Error('invalid_collection');
  }

  const where = Array.isArray(input.where) ? input.where : [];
  const clauses = [];
  const args = [];

  for (const filter of where) {
    if (!filter?.field || typeof filter.field !== 'string') throw new Error('invalid_filter_field');
    if (!ALLOWED_OPS.has(filter.op || '==')) throw new Error('invalid_filter_op');

    const op = filter.op || '==';
    const sqlOp = op === '!=' ? '!=' : '=';
    clauses.push(`json_extract(data, '$.${filter.field}') ${sqlOp} ?`);
    args.push(filter.value);
  }

  const orderBy = ALLOWED_ORDER_FIELDS.has(input.orderBy) ? input.orderBy : 'updated_at';
  const direction = (input.direction || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(Number(input.limit || 20), 1), 200);
  const offset = Math.max(Number(input.offset || 0), 0);

  return {
    collection: input.collection,
    clauses,
    args,
    orderBy,
    direction,
    limit,
    offset
  };
}
