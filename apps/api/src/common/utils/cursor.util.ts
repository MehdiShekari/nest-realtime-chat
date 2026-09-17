export interface CursorPayload {
  createdAt: string;
  id: string;
}

/**
 * Opaque cursor for keyset pagination over `(createdAt DESC, id DESC)`.
 * Carrying both fields means two messages written in the same millisecond
 * never get skipped or duplicated across page boundaries.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as CursorPayload).createdAt !== 'string' ||
      typeof (parsed as CursorPayload).id !== 'string'
    ) {
      return null;
    }

    const candidate = parsed as CursorPayload;
    if (Number.isNaN(Date.parse(candidate.createdAt))) {
      return null;
    }

    return candidate;
  } catch {
    return null;
  }
}