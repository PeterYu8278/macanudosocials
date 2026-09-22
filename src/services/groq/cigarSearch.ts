import { auth } from '../../config/firebase';
import type { CigarAnalysisResult } from '../gemini/cigarRecognition';

interface GroqCigarSearchResponse {
  success: boolean;
  result?: CigarAnalysisResult;
  error?: string;
}

export async function searchCigarWithGroq(query: string): Promise<CigarAnalysisResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Groq search requires an authenticated user');
  }

  const idToken = await currentUser.getIdToken();
  const response = await fetch('/.netlify/functions/groq-cigar-search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });

  const payload = await response.json().catch(() => ({})) as GroqCigarSearchResponse;
  if (!response.ok || !payload.success || !payload.result) {
    throw new Error(payload.error || `Groq search failed (${response.status})`);
  }

  return {
    ...payload.result,
    hasDetailedInfo: false,
    confidence: Math.max(0, Math.min(1, Number(payload.result.confidence) || 0)),
  };
}
