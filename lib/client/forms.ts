import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import type { ZodIssue } from 'zod';

/** Show Zod issues under the matching inputs. `map` renames contract fields to form fields. */
export function applyZodErrors<T extends FieldValues>(setError: UseFormSetError<T>, issues: ZodIssue[], map: Record<string, string> = {}): string | null {
  let first: string | null = null;
  for (const i of issues) {
    const k = String(i.path[0] ?? '');
    const name = (map[k] ?? k) as Path<T>;
    setError(name, { type: 'validate', message: i.message });
    first ??= i.message;
  }
  return first;
}
export const lakhToInr = (s: string | undefined): number | undefined => {
  if (s == null || s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100000) : undefined;
};
