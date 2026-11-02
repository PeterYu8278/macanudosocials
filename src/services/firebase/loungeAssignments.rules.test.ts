// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('reserves browser lounge assignment changes for global administrators', () => {
  const rules = readFileSync('firestore.rules', 'utf8');
  expect(rules).toContain("&& (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['storeId', 'storeIds'])");
  expect(rules).toContain("|| hasRole('superAdmin') || hasRole('developer'))");
  expect(rules).toContain("hasAny(['role', 'status', 'storeId', 'storeIds'])");
});
