const { ApiError } = require('../core/errors.js');
function businessDateRange({ from, to, required = false }) {
  const parse = (value, name) => {
    if (value === undefined && !required) return undefined;
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value.startsWith('0000')
    )
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `${name} must be YYYY-MM-DD.`,
      );
    const utc = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(+utc) || utc.toISOString().slice(0, 10) !== value)
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `${name} must be a valid calendar day.`,
      );
    return new Date(value + 'T00:00:00+07:00');
  };
  const start = parse(from, 'from'),
    end = parse(to, 'to');
  if (start && end && start >= end)
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'to must be after from (exclusive).',
    );
  return { ...(start ? { $gte: start } : {}), ...(end ? { $lt: end } : {}) };
}
module.exports = { businessDateRange };
