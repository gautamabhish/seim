/**
 * Utility to normalize raw HTTP request paths into parameterized route patterns,
 * preventing cardinality explosion in metrics stores and memory caches.
 */

// Common ID patterns: UUIDv4, MongoDB ObjectId (24 hex), 64-char sha256, numeric IDs, base64url IDs
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONGO_ID_REGEX = /^[0-9a-f]{24}$/i;
const NUMERIC_ID_REGEX = /^\d+$/;
const HEX_HASH_REGEX = /^[0-9a-f]{32,64}$/i;
const JWT_LIKE_REGEX = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/;

/**
 * Normalizes a raw URL path by replacing high-cardinality dynamic segments with ':id' or ':slug'.
 * Example: '/users/123/orders/507f1f77bcf86cd799439011' -> '/users/:id/orders/:id'
 */
export function normalizePath(rawPath: string): string {
  if (!rawPath || rawPath === '/') return '/';

  // Strip query params and hash if present
  const cleanPath = rawPath.split('?')[0].split('#')[0];
  const segments = cleanPath.split('/').filter(Boolean);

  if (segments.length === 0) return '/';

  const normalizedSegments = segments.map((segment, idx) => {
    // Check if segment is a dynamic identifier
    if (
      NUMERIC_ID_REGEX.test(segment) ||
      UUID_REGEX.test(segment) ||
      MONGO_ID_REGEX.test(segment) ||
      HEX_HASH_REGEX.test(segment) ||
      JWT_LIKE_REGEX.test(segment)
    ) {
      return ':id';
    }

    // Heuristic: segment with @ e.g. email / user handle
    if (segment.includes('@') && segment.length > 3) {
      return ':user';
    }

    return segment;
  });

  return '/' + normalizedSegments.join('/');
}
