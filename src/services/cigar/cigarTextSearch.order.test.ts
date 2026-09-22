import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCigarDetails: vi.fn(),
  searchCigarWithGroq: vi.fn(),
  analyzeCigarByName: vi.fn(),
  updateRecognitionStats: vi.fn(),
}));

vi.mock('./cigarDatabase', () => ({
  getCigarDetails: mocks.getCigarDetails,
}));

vi.mock('./cigarRecognitionStats', () => ({
  updateRecognitionStats: mocks.updateRecognitionStats,
}));

vi.mock('../gemini/googleImageSearch', () => ({
  searchCigarImageWithGoogle: vi.fn(),
}));

vi.mock('../firebase/appConfig', () => ({
  getAppConfig: vi.fn().mockResolvedValue({
    aiCigar: { enableImageSearch: false },
  }),
}));

vi.mock('../gemini/cigarRecognition', () => ({
  analyzeCigarByName: mocks.analyzeCigarByName,
}));

vi.mock('../groq/cigarSearch', () => ({
  searchCigarWithGroq: mocks.searchCigarWithGroq,
}));

import { searchCigarByText } from './cigarTextSearch';

const result = {
  brand: 'Cohiba',
  name: 'Siglo II',
  origin: 'Cuba',
  flavorProfile: [],
  strength: 'Medium' as const,
  description: 'Cohiba Siglo II',
  confidence: 0.9,
};

describe('searchCigarByText provider order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCigarDetails.mockResolvedValue(null);
    mocks.updateRecognitionStats.mockResolvedValue(undefined);
  });

  it('uses Groq before Gemini when the database has no match', async () => {
    mocks.searchCigarWithGroq.mockResolvedValue(result);

    await expect(searchCigarByText('Cohiba Siglo II')).resolves.toMatchObject(result);
    expect(mocks.searchCigarWithGroq).toHaveBeenCalledWith('Cohiba Siglo II');
    expect(mocks.analyzeCigarByName).not.toHaveBeenCalled();
  });

  it('falls back to Gemini only when Groq fails', async () => {
    mocks.searchCigarWithGroq.mockRejectedValue(new Error('Groq unavailable'));
    mocks.analyzeCigarByName.mockResolvedValue(result);

    await expect(searchCigarByText('Cohiba Siglo II')).resolves.toMatchObject({
      brand: 'Cohiba',
      name: 'Siglo II',
    });
    expect(mocks.searchCigarWithGroq).toHaveBeenCalledTimes(1);
    expect(mocks.analyzeCigarByName).toHaveBeenCalledWith('Siglo II', 'Cohiba');
  });
});
