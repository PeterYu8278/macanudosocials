// Netlify Function: 更新 Netlify 环境变量并触发部署
import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from './_shared/firestoreMonitoring';

const ADMIN_ROLES = new Set(['developer', 'superAdmin']);

const initializeAdmin = () => {
  if (getApps().length) return;
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT not configured');
  initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
};

const verifyAdminCaller = async (authorization: string | undefined): Promise<void> => {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) throw new Error('UNAUTHENTICATED');
  initializeAdmin();
  const decoded = await getAuth().verifyIdToken(token);
  const db = getFirestore();
  let snap = await db.collection('users').doc(decoded.uid).get();
  if (!snap.exists && decoded.email) {
    const q = await db.collection('users').where('email', '==', decoded.email.toLowerCase()).limit(1).get();
    snap = q.docs[0] || snap;
  }
  const role = (decoded.role as string | undefined) || snap.data()?.role;
  if (!role || !ADMIN_ROLES.has(role)) throw new Error('FORBIDDEN');
};

interface EnvVar {
  key: string;
  value: string;
  scopes?: string[];
}

interface DeployStatus {
  id: string;
  state: string;
  url?: string;
}

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

/**
 * 更新 Netlify 环境变量
 */
async function updateEnvVars(
  accessToken: string,
  siteId: string,
  envVars: EnvVar[]
): Promise<void> {
  const url = `https://api.netlify.com/api/v1/sites/${siteId}/env`;
  
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(envVars)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update environment variables: ${response.status} ${errorText}`);
  }
}

/**
 * 触发 Netlify 部署
 */
async function triggerDeploy(
  accessToken: string,
  siteId: string,
  clearCache: boolean = false
): Promise<DeployStatus> {
  const url = `https://api.netlify.com/api/v1/sites/${siteId}/deploys`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      clear_cache: clearCache
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to trigger deploy: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * 获取部署状态
 */
async function getDeployStatus(
  accessToken: string,
  siteId: string,
  deployId: string
): Promise<DeployStatus> {
  const url = `https://api.netlify.com/api/v1/sites/${siteId}/deploys/${deployId}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get deploy status: ${response.status} ${errorText}`);
  }

  return await response.json();
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
    await verifyAdminCaller(event.headers['authorization']);
  } catch {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { accessToken, siteId, envVars, triggerDeploy: shouldDeploy, clearCache, action, deployId } = body;

    // 验证必需参数
    if (!accessToken || !siteId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Missing required parameters: accessToken, siteId' 
        })
      };
    }

    // 如果是获取部署状态
    if (action === 'getDeployStatus' && deployId) {
      const deployStatus = await getDeployStatus(accessToken, siteId, deployId);
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          deploy: {
            id: deployStatus.id,
            state: deployStatus.state,
            url: deployStatus.url
          }
        })
      };
    }

    // 更新环境变量
    if (!envVars || !Array.isArray(envVars)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Missing required parameters: envVars' 
        })
      };
    }

    await updateEnvVars(accessToken, siteId, envVars);

    let deployStatus: DeployStatus | null = null;

    // 如果需要触发部署
    if (shouldDeploy) {
      deployStatus = await triggerDeploy(accessToken, siteId, clearCache || false);
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Environment variables updated successfully',
        deploy: deployStatus ? {
          id: deployStatus.id,
          state: deployStatus.state,
          url: deployStatus.url
        } : null
      })
    };
  } catch (error: any) {
    console.error('[update-netlify-env] Error:', error);
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
