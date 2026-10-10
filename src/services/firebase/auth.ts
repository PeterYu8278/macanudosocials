// Firebase认证服务
import { 
  signInWithEmailAndPassword, 
  signOut,
  onAuthStateChanged,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  updatePassword,
  EmailAuthProvider,
  linkWithCredential
} from 'firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import { doc, setDoc, getDoc, getDocFromCache, getDocFromServer, collection, getDocs, query, where, limit, updateDoc, arrayUnion, increment, deleteDoc } from '@/services/firebase/monitoredFirestore';
import { auth, db } from '../../config/firebase';
import type { User } from '../../types';
import { getAppConfig } from './appConfig';
import { sendRecoveryEmail } from './passwordResetEmail';
import { loginPhoneWithPassword } from './phoneLogin';
import { updateMemberPhone } from './memberPhone';
import { updateMemberEmail } from './memberEmail';
import { ensureMemberProfile } from './memberProfile';
import { normalizePhoneNumber, identifyInputType } from '../../utils/phoneNormalization';
import { getUserByMemberId } from '../../utils/memberId';
import { getLoginLandingPath } from '../../utils/loginLanding';


// 用户注册（所有字段都是必需的）
export { registerUser } from './registerMember';

// 用户登录
export const getAuthenticatedLandingPath = async (firebaseUid?: string, firestoreUserId?: string) => {
  const id = firestoreUserId || sessionStorage.getItem('firestoreUserId') || firebaseUid;
  const user = id ? await getUserData(id) : null;
  return getLoginLandingPath(user?.role);
};

export const loginUser = async (email: string, password: string) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: userCredential.user };
  } catch (error) {
    const err = error as any
    const code = err?.code as string | undefined
    const message =
      code === 'auth/user-not-found' ? '账户不存在'
      : code === 'auth/wrong-password' ? '密码错误'
      : code === 'auth/too-many-requests' ? '尝试次数过多，请稍后再试'
      : code === 'auth/invalid-email' ? '邮箱格式不正确'
      : err?.message || '登录失败'
    return { success: false, error: new Error(message), code } as { success: false; error: Error; code?: string };
  }
};

// 允许使用邮箱或手机号 + 密码登录
export const loginWithEmailOrPhone = async (identifier: string, password: string) => {
  try {
    const type = identifyInputType(identifier)
    
    // 未知格式
    if (type === 'unknown') {
      return { success: false, error: new Error('请输入有效的邮箱或手机号') } as { success: false; error: Error }
    }
    
    // 邮箱登录
    if (type === 'email') {
      // 手机号登入不受电邮开关影响，因此不会额外等待配置请求。
      const appConfig = await getAppConfig()
      if (appConfig?.auth?.disableEmailLogin) {
        return { success: false, error: new Error('邮箱登录已被禁用，请使用手机号登录') } as { success: false; error: Error }
      }
      return await loginUser(identifier.trim(), password)
    }
    
    // 手机号登录（即使禁用了电邮登录，手机号登录仍然允许）
    const normalizedPhone = normalizePhoneNumber(identifier)
    
    if (!normalizedPhone) {
      return { success: false, error: new Error('手机号格式无效') } as { success: false; error: Error }
      }
    
    return await loginPhoneWithPassword(normalizedPhone, password)
  } catch (error) {
    const err = error as any
    return { success: false, error: err as Error } as { success: false; error: Error }
  }
};

// ✅ 辅助函数：通过邮箱查找用户
export const findUserByAuthUid = async (uid: string): Promise<{ id: string; data: User } | null> => {
  const direct = await getUserData(uid)
  if (direct) return { id: uid, data: direct }
  const snapshot = await getDocs(query(collection(db, 'users'), where('authUid', '==', uid), limit(2)))
  if (snapshot.docs.length !== 1) return null
  const document = snapshot.docs[0]
  return { id: document.id, data: { ...convertFirestoreTimestamps(document.data()), id: document.id } as User }
}

export const findUserByEmail = async (email: string): Promise<{ id: string; data: User } | null> => {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', email), limit(1));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      return null;
    }
    
    const userDoc = snap.docs[0];
    const rawData = userDoc.data();
    const data = convertFirestoreTimestamps(rawData);
    return {
      id: userDoc.id,
      data: { id: userDoc.id, ...data } as User
    };
  } catch (error: any) {
    // 策略2: 错误处理
    if (error?.code === 'resource-exhausted') {
      console.warn('[Auth Service] ⚠️ Firestore 配额超限，无法通过邮箱查找用户');
    } else {
      console.error('[Auth Service] findUserByEmail 错误:', error);
    }
    return null;
  }
};

// ✅ 辅助函数：检查资料完整性（姓名、邮箱、手机号）
const isProfileComplete = (userData: User): boolean => {
  return !!(userData.displayName && userData.email && userData.profile?.phone);
};

// 使用 Google 登录（新架构：通过邮箱匹配用户）
export const loginWithGoogle = async () => {
  // 检查是否禁用了 Google 登录
  const appConfig = await getAppConfig()
  if (appConfig?.auth?.disableGoogleLogin) {
    return { success: false, error: new Error('Google 登录已被禁用') } as { success: false; error: Error }
  }
  
  // 检查是否已有 pending 的 redirect
  const hasPending = sessionStorage.getItem('googleRedirectPending');
  if (hasPending) {
    return { success: false, error: new Error('重定向正在进行中，请稍候...') } as { success: false; error: Error };
  }
  
  try {
    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    
    // 检测是否为移动设备（增强检测）
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
                     /Mobile|mobile|Tablet|tablet/i.test(navigator.userAgent) ||
                     ('ontouchstart' in window) ||
                     (navigator.maxTouchPoints > 0);
    
    let credential;
    
    if (isMobile) {
      // 移动端：尝试 popup，失败降级到 redirect
      try {
        credential = await signInWithPopup(auth, provider);
      } catch (mobilePopupError: any) {
        // Popup 失败，降级到 redirect
        sessionStorage.setItem('googleRedirectPending', 'true');
        await signInWithRedirect(auth, provider);
        return { success: true, isRedirecting: true } as any;
      }
    } else {
      // 桌面端：使用 popup
      try {
        credential = await signInWithPopup(auth, provider);
      } catch (popupError: any) {
        // 任何 popup 失败都降级到 redirect
        await signInWithRedirect(auth, provider);
        return { success: true, isRedirecting: true } as any;
      }
    }
    
    const googleUser = credential.user;
    const googleEmail = googleUser.email;

    if (!googleEmail) {
      return { success: false, error: new Error('无法获取 Google 邮箱信息') } as { success: false; error: Error };
    }

    // ✅ 场景 A：通过 Google 邮箱查询系统中是否已存在该邮箱的用户
    const existingUser = await findUserByAuthUid(googleUser.uid) || await findUserByEmail(googleEmail);
    
    if (existingUser) {
      // ✅ 场景 1.a：邮箱存在系统数据中
      // 检查该用户的资料是否完整
      const profileComplete = isProfileComplete(existingUser.data);
      
      if (profileComplete) {
        // ✅ 场景 1.a.1：资料完整，直接登录（使用该用户的 document ID）
        // 需要将 Firebase Auth 用户关联到这个 Firestore 文档
        // 我们通过 sessionStorage 传递该用户的 document ID
        sessionStorage.setItem('firestoreUserId', existingUser.id);
        
        return { 
          success: true, 
          user: googleUser,
          firestoreUserId: existingUser.id,
          needsProfile: false 
        };
      } else {
        // ✅ 场景 1.a.2：资料不完整，跳转到完善资料页面
        sessionStorage.setItem('firestoreUserId', existingUser.id);
        
        return { 
          success: true, 
          user: googleUser,
          firestoreUserId: existingUser.id,
          needsProfile: true 
        };
      }
    } else {
      // ✅ 场景 1.b：邮箱不存在系统数据中，创建新用户（使用 Firestore 自动生成 ID）
      const newUserId = await ensureMemberProfile();
      // 保存新用户的 document ID
      sessionStorage.setItem('firestoreUserId', newUserId);

      // ✅ 场景 1.b.1：跳转到完善资料页面
      return {
        success: true,
        user: googleUser,
        firestoreUserId: newUserId,
        needsProfile: true
      };
    }
  } catch (error) {
    const err = error as any
    return { success: false, error: err as Error } as { success: false; error: Error };
  }
};

// 处理 Google 重定向登录结果（新架构：通过邮箱匹配）
export const handleGoogleRedirectResult = async () => {
  // 检查是否禁用了 Google 登录
  const appConfig = await getAppConfig()
  if (appConfig?.auth?.disableGoogleLogin) {
    // 清除可能的 pending 标记
    sessionStorage.removeItem('googleRedirectPending')
    return { success: false, error: new Error('Google 登录已被禁用') } as { success: false; error: Error }
  }
  
  const hasPending = sessionStorage.getItem('googleRedirectPending');
  
  try {
    const result = await getRedirectResult(auth);
    
    // 如果返回 null，等待一下再检查 currentUser
    if (!result && hasPending) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 清除标记
    sessionStorage.removeItem('googleRedirectPending');
    
    if (!result) {
      // 备用方案：检查是否有标记 + 用户已登录
      const currentUser = auth.currentUser;
      
      if (hasPending && currentUser && currentUser.email) {
        const googleEmail = currentUser.email;
        
        // ✅ 通过邮箱查询系统中是否已存在该用户
        const existingUser = await findUserByAuthUid(currentUser.uid) || await findUserByEmail(googleEmail);
        
        if (existingUser) {
          // 邮箱存在，检查资料完整性
          const profileComplete = isProfileComplete(existingUser.data);
          sessionStorage.setItem('firestoreUserId', existingUser.id);
          
          return { 
            success: true, 
            user: currentUser,
            firestoreUserId: existingUser.id,
            needsProfile: !profileComplete 
          };
        } else {
          // 邮箱不存在，创建新用户
          const newUserId = await ensureMemberProfile();
          sessionStorage.setItem('firestoreUserId', newUserId);
          
          return { 
            success: true, 
            user: currentUser,
            firestoreUserId: newUserId,
            needsProfile: true 
          };
        }
      }
      
      return { success: false, noResult: true } as any;
    }
    
    const googleUser = result.user;
    const googleEmail = googleUser.email;

    if (!googleEmail) {
      return { success: false, error: new Error('无法获取 Google 邮箱信息') } as { success: false; error: Error };
    }

    // ✅ 通过邮箱查询系统中是否已存在该用户
    const existingUser = await findUserByAuthUid(googleUser.uid) || await findUserByEmail(googleEmail);
    
    if (existingUser) {
      // 邮箱存在，检查资料完整性
      const profileComplete = isProfileComplete(existingUser.data);
      sessionStorage.setItem('firestoreUserId', existingUser.id);
      
      return { 
        success: true, 
        user: googleUser,
        firestoreUserId: existingUser.id,
        needsProfile: !profileComplete 
      };
    } else {
      // 邮箱不存在，创建新用户
      const newUserId = await ensureMemberProfile();
      sessionStorage.setItem('firestoreUserId', newUserId);

      return {
        success: true,
        user: googleUser,
        firestoreUserId: newUserId,
        needsProfile: true
      };
    }
  } catch (error) {
    const err = error as any;
    return { success: false, error: err as Error } as { success: false; error: Error };
  }
};

// ✅ 辅助函数：通过电话查找用户
const findUserByPhone = async (phone: string): Promise<{ id: string; data: User } | null> => {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('profile.phone', '==', phone), limit(1));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      return null;
    }
    
    const userDoc = snap.docs[0];
    return {
      id: userDoc.id,
      data: { id: userDoc.id, ...userDoc.data() } as User
    };
  } catch (error) {
    return null;
  }
};

// ✅ 辅助函数：删除用户文档
const deleteUserDocument = async (userId: string): Promise<boolean> => {
  try {
    const userRef = doc(db, 'users', userId);
    await deleteDoc(userRef);
    return true;
  } catch (error) {
    return false;
  }
};

// 完善 Google 登录用户的信息（新架构：支持电话号码绑定旧账户）
export const completeGoogleUserProfile = async (
  currentFirestoreUserId: string,  // 当前临时用户的 Firestore document ID
  displayName: string,
  phone: string,
  password: string,
  referralCode?: string
) => {
  try {
    // 验证必需字段
    if (!currentFirestoreUserId || !displayName || !phone || !password) {
      return { success: false, error: new Error('所有字段都是必需的') } as { success: false; error: Error }
    }
    
    // 标准化手机号
    const normalizedPhone = normalizePhoneNumber(phone)
    if (!normalizedPhone) {
      return { success: false, error: new Error('手机号格式无效') } as { success: false; error: Error }
    }
    
    // 获取当前 Firebase Auth 用户
    const currentAuthUser = auth.currentUser;
    if (!currentAuthUser || !currentAuthUser.email) {
      return { success: false, error: new Error('无法获取用户邮箱信息') } as { success: false; error: Error }
    }
    
    const googleEmail = currentAuthUser.email;
    
    // ✅ 场景 1.b.2：检查该电话号码是否存在系统数据中
    const existingPhoneUser = await findUserByPhone(normalizedPhone);
    
    if (existingPhoneUser) {
      // 电话号码已存在
      const existingUserEmail = existingPhoneUser.data.email;
      
      if (!existingUserEmail || existingUserEmail === '') {
        // ✅ 场景 1.b.2.1：电话号码存在，但该用户没有邮箱
        // 将 Google 邮箱写入该旧用户的数据，并删除临时文档
        
        // 验证引荐码（如果提供）
    let referrer: any = null;
    if (referralCode) {
      const referralResult = await getUserByMemberId(referralCode.trim());
      if (!referralResult.success) {
        return { success: false, error: new Error(referralResult.error || '引荐码无效') } as { success: false; error: Error }
      }
      referrer = referralResult.user;
    }
    
        await updateMemberPhone(existingPhoneUser.id, normalizedPhone);
        await updateMemberEmail(existingPhoneUser.id, 'sync');
        // 更新旧用户的数据
        const oldUserRef = doc(db, 'users', existingPhoneUser.id);
        const updateData: any = {
          displayName,
          updatedAt: new Date(),
        };
        
        // 如果有引荐人，更新引荐信息（不再赠送积分）
        if (referrer) {
          updateData.referral = {
            referredBy: referrer.memberId,
            referredByUserId: referrer.id,
            referralDate: new Date(),
            referrals: existingPhoneUser.data.referral?.referrals || [],
            totalReferred: existingPhoneUser.data.referral?.totalReferred || 0,
            activeReferrals: existingPhoneUser.data.referral?.activeReferrals || 0,
          };
        }
        
        await setDoc(oldUserRef, updateData, { merge: true });
        
        // 删除临时创建的新用户文档
        if (currentFirestoreUserId !== existingPhoneUser.id) {
          await deleteUserDocument(currentFirestoreUserId);
        }
        
        // 更新 sessionStorage，指向旧用户的 ID
        sessionStorage.setItem('firestoreUserId', existingPhoneUser.id);
    
        // 为用户设置密码
        try {
          const credential = EmailAuthProvider.credential(googleEmail, password);
          await linkWithCredential(currentAuthUser, credential);
        } catch (linkError: any) {
          if (linkError.code === 'auth/provider-already-linked') {
            await updatePassword(currentAuthUser, password);
          } else {
            throw linkError;
          }
        }
        
        // 更新 Firebase Auth displayName
        await updateProfile(currentAuthUser, { displayName });
        
        // 如果有引荐人，更新引荐人的数据（不再赠送积分）
        if (referrer) {
          try {
            // 获取引荐人的当前 referrals 数组
            const referrerDoc = await getDoc(doc(db, 'users', referrer.id));
            const referrerData = referrerDoc.exists() ? referrerDoc.data() as User : null;
            const existingReferrals = referrerData?.referral?.referrals || [];
            
            // 检查是否已存在该用户
            const exists = existingReferrals.some((r: any) => 
              (typeof r === 'string' ? r === existingPhoneUser.id : r.userId === existingPhoneUser.id)
            );
            
            if (!exists) {
              // 获取被引荐用户信息
              const referredUserDoc = await getDoc(doc(db, 'users', existingPhoneUser.id));
              const referredUserData = referredUserDoc.exists() ? referredUserDoc.data() as User : null;
              
              // 添加新的引荐记录（对象格式）
              const newReferral = {
                userId: existingPhoneUser.id,
                userName: referredUserData?.displayName || '',
                memberId: referredUserData?.memberId || null
              };
              
              await updateDoc(doc(db, 'users', referrer.id), {
                'referral.referrals': arrayUnion(newReferral),
                'referral.totalReferred': increment(1),
                updatedAt: new Date()
              });
            }
          } catch (error) {
            // 静默失败
          }
        }
        
        return { 
          success: true, 
          mergedUserId: existingPhoneUser.id,
          message: '账户已成功关联' 
        };
      } else {
        // ✅ 场景 1.b.2.2：电话号码存在，且该用户已有邮箱
        return { success: false, error: new Error('该手机号已被其他用户使用') } as { success: false; error: Error }
    }
    } else {
      // ✅ 场景 1.b.2.1（电话不存在）：完成新用户的资料
      
      // 验证引荐码（如果提供）
      let referrer: any = null;
      if (referralCode) {
        const referralResult = await getUserByMemberId(referralCode.trim());
        if (!referralResult.success) {
          return { success: false, error: new Error(referralResult.error || '引荐码无效') } as { success: false; error: Error }
        }
        referrer = referralResult.user;
      }
      
      await updateMemberPhone(currentFirestoreUserId, normalizedPhone);
      await updateMemberEmail(currentFirestoreUserId, 'sync');
      // 更新当前用户文档
      const userRef = doc(db, 'users', currentFirestoreUserId);
    const updateData: any = {
      displayName,
      updatedAt: new Date(),
    };
    
      // 如果有引荐人，更新引荐信息（不再赠送积分）
    if (referrer) {
      updateData.referral = {
        referredBy: referrer.memberId,
        referredByUserId: referrer.id,
        referralDate: new Date(),
        referrals: [],
        totalReferred: 0,
        activeReferrals: 0,
      };
    }
    
    await setDoc(userRef, updateData, { merge: true });

      // 为用户设置密码
        try {
        const credential = EmailAuthProvider.credential(googleEmail, password);
        await linkWithCredential(currentAuthUser, credential);
        } catch (linkError: any) {
          if (linkError.code === 'auth/provider-already-linked') {
          await updatePassword(currentAuthUser, password);
          } else {
            throw linkError;
        }
      }
      
      // 更新 Firebase Auth displayName
      await updateProfile(currentAuthUser, { displayName });
    
      // 如果有引荐人，更新引荐人的数据（不再赠送积分）
    if (referrer) {
      try {
        // 获取引荐人的当前 referrals 数组
        const referrerDoc = await getDoc(doc(db, 'users', referrer.id));
        const referrerData = referrerDoc.exists() ? referrerDoc.data() as User : null;
        const existingReferrals = referrerData?.referral?.referrals || [];
        
        // 检查是否已存在该用户
        const exists = existingReferrals.some((r: any) => 
          (typeof r === 'string' ? r === currentFirestoreUserId : r.userId === currentFirestoreUserId)
        );
        
        if (!exists) {
          // 获取被引荐用户信息
          const referredUserDoc = await getDoc(doc(db, 'users', currentFirestoreUserId));
          const referredUserData = referredUserDoc.exists() ? referredUserDoc.data() as User : null;
          
          // 添加新的引荐记录（对象格式）
          const newReferral = {
            userId: currentFirestoreUserId,
            userName: referredUserData?.displayName || displayName,
            memberId: referredUserData?.memberId || null
          };
          
          await updateDoc(doc(db, 'users', referrer.id), {
            'referral.referrals': arrayUnion(newReferral),
            'referral.totalReferred': increment(1),
            updatedAt: new Date()
          });
        }
      } catch (error) {
          // 静默失败
      }
    }

    return { success: true };
    }
  } catch (error) {
    const err = error as any;
    const message = 
      err?.code === 'auth/weak-password' ? '密码强度不足（至少6位）'
      : err?.code === 'auth/requires-recent-login' ? '请重新登录后再试'
      : err?.message || '信息保存失败';
    return { success: false, error: new Error(message) } as { success: false; error: Error };
  }
};

// 用户登出
export const logoutUser = async () => {
  try {
    await signOut(auth);
    return { success: true };
  } catch (error) {
    return { success: false, error: error as Error };
  }
};

// 获取当前用户信息
export const getCurrentUser = (): FirebaseUser | null => {
  return auth.currentUser;
};

// 监听认证状态变化
export const onAuthStateChange = (callback: (user: FirebaseUser | null) => void) => {
  return onAuthStateChanged(auth, (user) => {
    callback(user)
  });
};

// 获取用户完整信息
export const convertFirestoreTimestamps = (value: any): any => {
  if (!value) return value;
  if (typeof value?.toDate === 'function') {
    return value.toDate();
  }
  if (Array.isArray(value)) {
    return value.map((item) => convertFirestoreTimestamps(item));
  }
  if (typeof value === 'object') {
    return Object.keys(value).reduce((acc, key) => {
      acc[key] = convertFirestoreTimestamps(value[key]);
      return acc;
    }, {} as Record<string, any>);
  }
  return value;
};

export const getUserData = async (uid: string, useCache: boolean = true): Promise<User | null> => {
  const userDocRef = doc(db, 'users', uid);

  const fetchFromFirestore = async (): Promise<User | null> => {
    let userDoc;
    if (useCache) {
      try {
        userDoc = await getDocFromCache(userDocRef);
        // A cached "missing" result can be stale while registration is writing
        // the new user document. Confirm it with the server before returning null.
        if (!userDoc.exists()) {
          userDoc = await getDocFromServer(userDocRef);
        }
      } catch {
        userDoc = await getDocFromServer(userDocRef);
      }
    } else {
      userDoc = await getDocFromServer(userDocRef);
    }
    if (!userDoc.exists()) return null;
    const data = convertFirestoreTimestamps(userDoc.data());
    return { id: uid, ...data } as User;
  };

  try {
    return await fetchFromFirestore();
  } catch (error: any) {
    // 注册时存在竞态：onAuthStateChanged 比 setDoc 先触发，此时文档尚未写入。
    // 静默等待后重试一次，给 registerUser 的 setDoc 时间完成。
    if (error?.code === 'permission-denied' || error?.code === 'PERMISSION_DENIED') {
      await new Promise(r => setTimeout(r, 1500));
      try {
        return await fetchFromFirestore();
      } catch {
        return null;
      }
    }
    // 策略2: 错误处理与降级
    if (error?.code === 'resource-exhausted') {
      console.warn('[Auth Service] ⚠️ Firestore 配额超限，尝试使用缓存数据');
      // 尝试从缓存读取作为降级方案
      try {
        const cachedDoc = await getDocFromCache(userDocRef);
        if (cachedDoc.exists()) {
          const rawData = cachedDoc.data();
          const data = convertFirestoreTimestamps(rawData);
          console.info('[Auth Service] ✅ 使用缓存数据作为降级方案');
          return { id: uid, ...data } as User;
        }
      } catch (cacheError) {
        // 缓存也不存在，返回 null
      }
      return null;
    }
    console.error('[Auth Service] ❌ getUserData 错误:', error);
    return null;
  }
};

/**
 * 为已有 Firebase Auth 账号但缺少 Firestore 文档的用户创建补救文档
 * 在 onAuthStateChanged 中当 getUserData 返回 null 时调用
 */
export const createMissingUserDocument = async (_firebaseUser: FirebaseUser): Promise<User | null> => {
  try {
    const userId = await ensureMemberProfile();
    return await getUserData(userId, false);
  } catch (error) {
    console.error('[Auth Service] Profile recovery failed:', error instanceof Error ? error.message : 'service-unavailable');
    return null;
  }
};

// 管理员触发密码重置邮件
export const sendPasswordResetEmailFor = async (email: string) => {
  try {
    // WhatsApp recovery has its own server endpoint that generates a real Auth action link.
    await sendRecoveryEmail(email)
    return { success: true }
  } catch (error) {
    return { success: false, error: error as Error }
  }
}

type ResetPasswordByPhoneCoreResult = {
  success: boolean;
  error?: string;
  normalizedPhone?: string;
  userDisplayName?: string;
  tempPassword?: string;
  message?: string;
  userId?: string;
};

/**
 * 重置密码核心逻辑：
 * - 校验手机号
 * - 查找用户
 * - 生成临时密码
 * - 通过 Netlify Function 更新 Firebase Auth 密码
 * - 构造 WhatsApp 消息文案
 *
 * 不负责真正发送 WhatsApp 消息，便于复用（发送 / 手动复制）。
 */
const resetPasswordByPhoneCore = async (phone: string): Promise<ResetPasswordByPhoneCoreResult> => {
  try {
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      return { success: false, error: '手机号格式无效' };
    }

    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('profile.phone', '==', normalizedPhone), limit(1));
    const snap = await getDocs(q);

    if (snap.empty) {
      return { success: false, error: '未找到绑定该手机号的账户' };
    }

    const userDoc = snap.docs[0];
    const userData = userDoc.data() as User;
    const uid = userDoc.id;
    const email = userData.email;

    const tempPassword = generateTempPassword();

    try {
      const requestBody: { uid?: string; email?: string; phoneNumber?: string; newPassword: string } = {
        newPassword: tempPassword,
      };

      if (uid) {
        requestBody.uid = uid;
      } else if (email) {
        requestBody.email = email;
      } else {
        requestBody.phoneNumber = normalizedPhone;
      }

      const response = await fetch('/.netlify/functions/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await auth.currentUser?.getIdToken() || ''}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '重置密码失败' }));
        return { success: false, error: errorData.error || '重置密码失败' };
      }
    } catch (netlifyError: any) {
      console.warn('[resetPasswordByPhone] Netlify Function 不可用，尝试直接更新:', netlifyError);
      return { success: false, error: '重置密码服务暂时不可用，请稍后重试' };
    }

    const appConfig = await getAppConfig();
    const appName = appConfig?.appName || 'MS';
    const displayName = (userData as any).displayName || '用户';

    const message = `[${appName}] 重置密码
您好 ${displayName}，您的密码已重置。

临时密码：${tempPassword}

请尽快登录并修改密码。如非本人操作，请立即联系管理员。`;

    return {
      success: true,
      normalizedPhone,
      userDisplayName: displayName,
      tempPassword,
      message,
      userId: uid,
    };
  } catch (error: any) {
    return { success: false, error: error.message || '重置密码失败' };
  }
};

/**
 * 通过后端向绑定手机号发送 WhatsApp 重置链接，不立即修改密码
 */
export const resetPasswordByPhone = async (phone: string) => {
  const { requestPhonePasswordReset } = await import('./phonePasswordReset');
  return requestPhonePasswordReset(phone);
};

/**
 * 通过手机号重置密码，但不发送 WhatsApp，只返回生成的消息内容
 * 适用于「复制重置内容手动发送」场景
 */
export const generateResetPasswordMessageByPhone = async (phone: string) => {
  const coreResult = await resetPasswordByPhoneCore(phone);

  if (!coreResult.success) {
    return { success: false, error: coreResult.error || '重置密码失败' };
  }

  return {
    success: true,
    message: coreResult.message,
    normalizedPhone: coreResult.normalizedPhone,
    userDisplayName: coreResult.userDisplayName,
    tempPassword: coreResult.tempPassword,
  };
};

/**
 * 生成临时密码（8位随机数字+字母）
 */
const generateTempPassword = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}
