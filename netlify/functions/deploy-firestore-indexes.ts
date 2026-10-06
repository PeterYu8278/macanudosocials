// Netlify Function: 部署 Firebase Firestore 索引
import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { GoogleAuth } from 'google-auth-library';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface IndexDefinition {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{
    fieldPath: string;
    order: string;
  }>;
}

interface IndexDeploymentResult {
  index: IndexDefinition;
  success: boolean;
  message: string;
  operationName?: string;
  error?: string;
}

/**
 * 获取 OAuth Access Token
 */
async function getAccessToken(serviceAccount: any): Promise<string> {
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  
  const client = await auth.getClient();
  const accessToken = await client.getAccessToken();
  
  if (!accessToken) {
    throw new Error('Failed to get access token');
  }
  
  return accessToken.token || accessToken as string;
}

/**
 * 创建单个 Firestore 索引
 */
async function createIndex(
  projectId: string,
  collectionGroup: string,
  indexDefinition: IndexDefinition,
  accessToken: string
): Promise<{ success: boolean; operationName?: string; error?: string }> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/${collectionGroup}/indexes`;
  
  // 转换索引定义格式以匹配 API 要求
  const apiPayload = {
    queryScope: indexDefinition.queryScope,
    fields: indexDefinition.fields.map(field => ({
      fieldPath: field.fieldPath,
      order: field.order
    }))
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(apiPayload)
    });
    
    const responseData = await response.json();
    
    if (!response.ok) {
      // 检查是否是因为索引已存在
      if (response.status === 409 || responseData.error?.message?.includes('already exists')) {
        return {
          success: true,
          operationName: 'already_exists',
          error: 'Index already exists'
        };
      }
      
      // 检查权限错误
      if (response.status === 403) {
        const errorMsg = responseData.error?.message || 'Permission denied';
        return {
          success: false,
          error: `${errorMsg}. 请确保 Service Account 具有 'Cloud Datastore Index Admin' 权限。`
        };
      }
      
      // 检查认证错误
      if (response.status === 401) {
        return {
          success: false,
          error: 'Authentication failed. 请检查 FIREBASE_SERVICE_ACCOUNT 环境变量是否正确配置。'
        };
      }
      
      throw new Error(responseData.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }
    
    // API 返回操作名称（索引创建是异步的）
    return {
      success: true,
      operationName: responseData.name
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error'
    };
  }
}

/**
 * 部署所有 Firestore 索引
 */
async function deployIndexes(
  projectId: string,
  indexes: IndexDefinition[],
  serviceAccount: any
): Promise<{
  success: boolean;
  message: string;
  results: IndexDeploymentResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
}> {
  // 获取 OAuth Access Token
  const accessToken = await getAccessToken(serviceAccount);
  
  const results: IndexDeploymentResult[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  
  // 逐个创建索引
  for (const index of indexes) {
    const result = await createIndex(
      projectId,
      index.collectionGroup,
      index,
      accessToken
    );
    
    if (result.success) {
      if (result.operationName === 'already_exists') {
        skipped++;
        results.push({
          index,
          success: true,
          message: '索引已存在，跳过',
          operationName: result.operationName
        });
      } else {
        succeeded++;
        results.push({
          index,
          success: true,
          message: '索引创建请求已提交',
          operationName: result.operationName
        });
      }
    } else {
      failed++;
      results.push({
        index,
        success: false,
        message: '索引创建失败',
        error: result.error
      });
    }
  }
  
  const summary = {
    total: indexes.length,
    succeeded,
    failed,
    skipped
  };
  
  let message = '';
  if (failed === 0) {
    message = `成功部署 ${succeeded} 个索引${skipped > 0 ? `，跳过 ${skipped} 个已存在的索引` : ''}`;
  } else {
    message = `部署完成：成功 ${succeeded} 个，失败 ${failed} 个${skipped > 0 ? `，跳过 ${skipped} 个` : ''}`;
  }
  
  return {
    success: failed === 0,
    message,
    results,
    summary
  };
}

export const eventHandler: Handler = async (event) => {
  // 处理 CORS 预检请求
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  // 只允许 POST 请求
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { projectId } = body;

    // 验证必需参数
    if (!projectId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Missing required parameter: projectId' 
        })
      };
    }

    // 获取 Service Account
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountStr) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'FIREBASE_SERVICE_ACCOUNT environment variable is not set. Please configure it in Netlify environment variables.' 
        })
      };
    }

    let serviceAccount: any;
    try {
      serviceAccount = JSON.parse(serviceAccountStr);
    } catch (e) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid FIREBASE_SERVICE_ACCOUNT format. It should be a valid JSON string.' 
        })
      };
    }

    // 读取索引定义
    // 优先从请求体读取，否则使用内置的默认索引定义
    let indexesData: { indexes: IndexDefinition[] };
    
    if (body.indexes && Array.isArray(body.indexes)) {
      indexesData = { indexes: body.indexes };
    } else {
      // 使用内置的默认索引定义（从 firestore.indexes.json）
      indexesData = {
        indexes: [
          {
            collectionGroup: "visitSessions",
            queryScope: "COLLECTION",
            fields: [
              { fieldPath: "userId", order: "ASCENDING" },
              { fieldPath: "status", order: "ASCENDING" },
              { fieldPath: "checkInAt", order: "DESCENDING" }
            ]
          },
          {
            collectionGroup: "visitSessions",
            queryScope: "COLLECTION",
            fields: [
              { fieldPath: "status", order: "ASCENDING" },
              { fieldPath: "checkInAt", order: "DESCENDING" }
            ]
          },
          {
            collectionGroup: "visitSessions",
            queryScope: "COLLECTION",
            fields: [
              { fieldPath: "status", order: "ASCENDING" },
              { fieldPath: "checkInAt", order: "ASCENDING" }
            ]
          },
          {
            collectionGroup: "visitSessions",
            queryScope: "COLLECTION",
            fields: [
              { fieldPath: "userId", order: "ASCENDING" },
              { fieldPath: "checkInAt", order: "DESCENDING" }
            ]
          },
          {
            collectionGroup: "redemptionRecords",
            queryScope: "COLLECTION",
            fields: [
              { fieldPath: "userId", order: "ASCENDING" },
              { fieldPath: "dayKey", order: "ASCENDING" },
              { fieldPath: "redeemedAt", order: "ASCENDING" }
            ]
          },
          {
            collectionGroup: "redemptionRecords",
            queryScope: "COLLECTION",
            fields: [
              { fieldPath: "userId", order: "ASCENDING" },
              { fieldPath: "hourKey", order: "ASCENDING" },
              { fieldPath: "redeemedAt", order: "ASCENDING" }
            ]
          },
          {
            collectionGroup: "redemptionRecords",
            queryScope: "COLLECTION",
            fields: [
              { fieldPath: "userId", order: "ASCENDING" },
              { fieldPath: "redeemedAt", order: "ASCENDING" }
            ]
          },
          {
            collectionGroup: "reloadRecords",
            queryScope: "COLLECTION",
            fields: [
              { fieldPath: "userId", order: "ASCENDING" },
              { fieldPath: "status", order: "ASCENDING" },
              { fieldPath: "createdAt", order: "DESCENDING" }
            ]
          },
          {
            collectionGroup: "membershipFeeRecords",
            queryScope: "COLLECTION",
            fields: [
              { fieldPath: "status", order: "ASCENDING" },
              { fieldPath: "dueDate", order: "ASCENDING" }
            ]
          },
          {
            collectionGroup: "pointsRecords",
            queryScope: "COLLECTION",
            fields: [
              { fieldPath: "userId", order: "ASCENDING" },
              { fieldPath: "createdAt", order: "DESCENDING" }
            ]
          }
        ]
      };
    }

    if (!indexesData.indexes || !Array.isArray(indexesData.indexes)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid indexes format' 
        })
      };
    }

    // 部署索引
    const deploymentResult = await deployIndexes(
      projectId,
      indexesData.indexes,
      serviceAccount
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: deploymentResult.success,
        projectId,
        indexCount: indexesData.indexes.length,
        message: deploymentResult.message,
        summary: deploymentResult.summary,
        results: deploymentResult.results,
        // 保留 Firebase Console 链接作为备用
        consoleUrl: `https://console.firebase.google.com/project/${projectId}/firestore/indexes`
      })
    };
  } catch (error: any) {
    console.error('[deploy-firestore-indexes] Error:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error.message || 'Internal server error'
      })
    };
  }
};

export default toWebFunction(eventHandler)
