/**
 * 雪茄文本搜索服务
 * 
 * 功能：
 * 1. 用户输入雪茄品牌和名称（文本）
 * 2. 直接查询数据库获取详细信息
 * 3. 如果数据库没有，使用 Gemini API 推理
 */

import { getCigarDetails } from './cigarDatabase';
import { updateRecognitionStats } from './cigarRecognitionStats';
import { searchCigarImageWithGoogle } from '../gemini/googleImageSearch';
import { getAppConfig } from '../firebase/appConfig';
import { analyzeCigarByName } from '../gemini/cigarRecognition';
import type { CigarAnalysisResult } from '../gemini/cigarRecognition';
import { searchCigarWithGroq } from '../groq/cigarSearch';

const COMMON_BRANDS = [
  'Cohiba', 'Montecristo', 'Romeo y Julieta', 'Partagas', 'Davidoff',
  'Padron', 'Arturo Fuente', 'Oliva', 'My Father', 'Drew Estate',
  'Macanudo', 'Rocky Patel', 'Ashton', 'Perdomo', 'CAO',
  'Liga Privada', 'Undercrown', 'Plasencia', 'Alec Bradley', 'Tatuaje'
];

const editDistance = (left: string, right: string): number => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = left[leftIndex - 1] === right[rightIndex - 1]
        ? diagonal
        : Math.min(diagonal, previous[rightIndex - 1], above) + 1;
      diagonal = above;
    }
  }

  return previous[right.length];
};

export function parseCigarSearchInput(inputValue: string): { brand: string; name: string } {
  const input = inputValue.trim().replace(/\s+/g, ' ');
  const parts = input.split(' ');

  if (parts.length === 1) {
    return { brand: '', name: input };
  }

  const exactBrand = [...COMMON_BRANDS]
    .sort((left, right) => right.length - left.length)
    .find(candidate => {
      const prefix = input.slice(0, candidate.length);
      return prefix.toLowerCase() === candidate.toLowerCase()
        && (input.length === candidate.length || input[candidate.length] === ' ');
    });

  if (exactBrand) {
    return {
      brand: exactBrand,
      name: input.slice(exactBrand.length).trim(),
    };
  }

  const firstWord = parts[0];
  const correctedBrand = COMMON_BRANDS
    .filter(candidate => !candidate.includes(' '))
    .map(candidate => ({
      candidate,
      distance: editDistance(firstWord.toLowerCase(), candidate.toLowerCase()),
    }))
    .sort((left, right) => left.distance - right.distance)[0];

  return {
    brand: correctedBrand && correctedBrand.distance <= 2
      ? correctedBrand.candidate
      : firstWord,
    name: parts.slice(1).join(' '),
  };
}

async function finalizeAiSearchResult(
  result: CigarAnalysisResult,
  searchBrand: string,
  searchName: string
): Promise<CigarAnalysisResult> {
  if (!result.imageUrl) {
    const appConfig = await getAppConfig();
    const imageSearchEnabled = appConfig?.aiCigar?.enableImageSearch ?? true;

    if (imageSearchEnabled) {
      try {
        const imageUrl = await searchCigarImageWithGoogle(
          result.brand || searchBrand,
          result.name || searchName
        );
        if (imageUrl) {
          result.imageUrl = imageUrl;
        }
      } catch {
        // Image search does not block the cigar result.
      }
    }
  }

  updateRecognitionStats({
    brand: result.brand,
    name: result.name,
    confidence: result.confidence,
    imageUrlFound: !!result.imageUrl,
    hasDetailedInfo: false
  }).catch(() => {});

  return result;
}

/**
 * 通过文本搜索雪茄信息
 * 
 * @param brandAndName - 用户输入的品牌和名称（例如："Cohiba Robusto"）
 * @returns 雪茄详细信息
 */
export async function searchCigarByText(brandAndName: string): Promise<CigarAnalysisResult | null> {
  if (!brandAndName || !brandAndName.trim()) {
    return null;
  }
  
  const input = brandAndName.trim();
  const { brand, name } = parseCigarSearchInput(input);
  
  // 1. 查询数据库
  try {
    const dbResult = await getCigarDetails(brand, name);
    if (dbResult) {
      
      // 构建返回结果
      const result: CigarAnalysisResult = {
        brand: dbResult.brand,
        name: dbResult.name,
        origin: '', // 数据库中没有 origin 字段
        brandDescription: '',
        flavorProfile: dbResult.flavorProfile,
        strength: dbResult.strength as any,
        wrapper: dbResult.wrapper || undefined,
        binder: dbResult.binder || undefined,
        filler: dbResult.filler || undefined,
        footTasteNotes: dbResult.footTasteNotes || undefined,
        bodyTasteNotes: dbResult.bodyTasteNotes || undefined,
        headTasteNotes: dbResult.headTasteNotes || undefined,
        description: dbResult.description || '',
        rating: dbResult.rating || undefined,
        ratingSource: dbResult.ratingSource || undefined,
        ratingDate: dbResult.ratingDate || undefined,
        confidence: 1.0, // 数据库数据，置信度100%
        imageUrl: dbResult.imageUrl || undefined,
        hasDetailedInfo: true,
        databaseId: dbResult.id
      };
      
      // 如果数据库没有图片，尝试搜索
      if (!result.imageUrl) {
        const appConfig = await getAppConfig();
        const imageSearchEnabled = appConfig?.aiCigar?.enableImageSearch ?? true;
        
        if (imageSearchEnabled) {
          try {
            const imageUrl = await searchCigarImageWithGoogle(brand, name);
            if (imageUrl) {
              result.imageUrl = imageUrl;
            }
          } catch (error) {
            // Silently fail
          }
        }
      }
      
      // 更新统计
      updateRecognitionStats({
        brand: result.brand,
        name: result.name,
        confidence: 1.0,
        imageUrlFound: !!result.imageUrl,
        hasDetailedInfo: true
      }).catch(() => {});
      
      return result;
    }
  } catch (error) {
    // Database query failed
  }
  
  // 2. 数据库未找到，优先使用 Groq。
  try {
    const groqResult = await searchCigarWithGroq(input);
    return await finalizeAiSearchResult(groqResult, brand, name);
  } catch (groqError) {
    console.warn('[searchCigarByText] Groq search failed, trying Gemini:', groqError);
  }

  // 3. Groq 不可用时回退到 Gemini。
  try {
    const geminiResult = await analyzeCigarByName(name, brand || undefined);
    const result: CigarAnalysisResult = {
      ...geminiResult,
      hasDetailedInfo: false,
      confidence: geminiResult.confidence * 0.9
    };

    return await finalizeAiSearchResult(result, brand, name);
  } catch (geminiError) {
    console.warn('[searchCigarByText] Gemini search failed, using basic result:', geminiError);

    // Both AI providers failed; return the parsed input without duplicating the brand.
    
    const basicResult: CigarAnalysisResult = {
      brand,
      name,
      origin: '',
      brandDescription: '',
      flavorProfile: [],
      strength: 'Unknown',
      description: `${brand} ${name}`.trim(),
      confidence: 0.5, // 文本输入且 API 失败，低置信度
      hasDetailedInfo: false
    };
    
    // 尝试搜索图片
    const appConfig = await getAppConfig();
    const imageSearchEnabled = appConfig?.aiCigar?.enableImageSearch ?? true;
    
    if (imageSearchEnabled) {
      try {
        const imageUrl = await searchCigarImageWithGoogle(brand, name);
        if (imageUrl) {
          basicResult.imageUrl = imageUrl;
        }
      } catch (imgError) {
        // Silently fail
      }
    }
    
    // 更新统计
    updateRecognitionStats({
      brand: basicResult.brand,
      name: basicResult.name,
      confidence: 0.5,
      imageUrlFound: !!basicResult.imageUrl,
      hasDetailedInfo: false
    }).catch(() => {});
    
    return basicResult;
  }
}

