import { describe, expect, it } from 'vitest';
import { inventoryOperatorName } from './inventoryOperator';

const labels = { system: 'System', historical: 'Historical Import', unknown: 'Unknown User' };

describe('inventory operator names', () => {
  it('displays resolved names rather than document IDs', () => {
    expect(inventoryOperatorName('operator-id', { 'operator-id': '  Alice  ' }, labels)).toBe('Alice');
  });

  it('preserves known legacy name values', () => {
    expect(inventoryOperatorName('Alice', { Alice: 'Alice' }, labels)).toBe('Alice');
  });

  it('uses a label instead of exposing unresolved IDs', () => {
    expect(inventoryOperatorName('unresolved-document-id', {}, labels)).toBe('Unknown User');
    expect(inventoryOperatorName('operator-id', { 'operator-id': '' }, labels)).toBe('Unknown User');
    expect(inventoryOperatorName('constructor', {}, labels)).toBe('Unknown User');
  });

  it('distinguishes system, historical and empty operators', () => {
    expect(inventoryOperatorName('system', {}, labels)).toBe('System');
    expect(inventoryOperatorName('legacy_migration', {}, labels)).toBe('Historical Import');
    expect(inventoryOperatorName(undefined, {}, labels)).toBe('-');
    expect(inventoryOperatorName('', {}, labels)).toBe('-');
  });
});
