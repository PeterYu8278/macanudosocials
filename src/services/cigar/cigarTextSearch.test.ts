import { describe, expect, it } from 'vitest';
import { parseCigarSearchInput } from './cigarTextSearch';

describe('parseCigarSearchInput', () => {
  it('separates a known brand from the cigar name', () => {
    expect(parseCigarSearchInput('Cohiba Siglo II')).toEqual({
      brand: 'Cohiba',
      name: 'Siglo II',
    });
  });

  it('corrects a close single-word brand misspelling', () => {
    expect(parseCigarSearchInput('cihiba siglo II')).toEqual({
      brand: 'Cohiba',
      name: 'siglo II',
    });
  });

  it('handles multi-word brands before single-word parsing', () => {
    expect(parseCigarSearchInput('Romeo y Julieta Churchill')).toEqual({
      brand: 'Romeo y Julieta',
      name: 'Churchill',
    });
  });

  it('does not duplicate a one-word query', () => {
    expect(parseCigarSearchInput('Cohiba')).toEqual({
      brand: '',
      name: 'Cohiba',
    });
  });
});
