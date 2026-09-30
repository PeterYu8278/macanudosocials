import type { SharedUserProfile } from '@macanudo/shared';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { auth, db } from '@/lib/firebase';

interface SessionContextValue {
  user: User | null;
  profile: SharedUserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

async function readProfile(user: User): Promise<SharedUserProfile> {
  const snapshot = await getDoc(doc(db, 'users', user.uid));
  return {
    id: user.uid,
    email: user.email ?? undefined,
    ...(snapshot.exists() ? snapshot.data() : {}),
  } as SharedUserProfile;
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<SharedUserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) {
      setProfile(null);
      return;
    }
    setProfile(await readProfile(auth.currentUser));
  }, []);

  useEffect(
    () =>
      onAuthStateChanged(auth, (nextUser) => {
        setUser(nextUser);
        if (!nextUser) {
          setProfile(null);
          setLoading(false);
          return;
        }

        void readProfile(nextUser)
          .then(setProfile)
          .catch(() =>
            setProfile({ id: nextUser.uid, email: nextUser.email ?? undefined }),
          )
          .finally(() => setLoading(false));
      }),
    [],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      profile,
      loading,
      signIn: async (email, password) => {
        setLoading(true);
        try {
          await signInWithEmailAndPassword(auth, email.trim(), password);
        } finally {
          setLoading(false);
        }
      },
      signOut: () => firebaseSignOut(auth),
      refreshProfile,
    }),
    [loading, profile, refreshProfile, user],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
