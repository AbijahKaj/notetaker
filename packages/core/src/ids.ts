import { nanoid } from "nanoid";

export function newSessionId(): string {
  return `sess_${nanoid(16)}`;
}

export function newSegmentId(): string {
  return `seg_${nanoid(16)}`;
}

export function newSourceId(prefix: string): string {
  return `${prefix}_${nanoid(8)}`;
}
