import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { Announcement } from '../../types';

const COL = GLOBAL_COLLECTIONS.ANNOUNCEMENTS;

const fromFirestore = (id: string, data: any): Announcement => ({
  id,
  title: data.title,
  content: data.content,
  type: data.type,
  status: data.status,
  pinned: data.pinned ?? false,
  image: data.image,
  publishedAt: data.publishedAt?.toDate?.() ?? null,
  expiresAt: data.expiresAt?.toDate?.() ?? null,
  createdBy: data.createdBy,
  createdAt: data.createdAt?.toDate?.() ?? new Date(),
  updatedAt: data.updatedAt?.toDate?.() ?? new Date(),
});

const toFirestore = (data: Partial<Announcement>) => {
  const payload: Record<string, unknown> = {
    ...data,
    updatedAt: Timestamp.fromDate(new Date()),
  };

  if (data.publishedAt !== undefined) {
    payload.publishedAt = data.publishedAt ? Timestamp.fromDate(data.publishedAt) : null;
  }
  if (data.expiresAt !== undefined) {
    payload.expiresAt = data.expiresAt ? Timestamp.fromDate(data.expiresAt) : null;
  }
  if (data.createdAt) {
    payload.createdAt = Timestamp.fromDate(data.createdAt);
  }

  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) delete payload[key];
  }

  return payload;
};

export const getAnnouncements = async (): Promise<Announcement[]> => {
  const q = query(collection(db, COL), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => fromFirestore(d.id, d.data()));
};

export const createAnnouncement = async (
  data: Omit<Announcement, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> => {
  const now = new Date();
  const ref = await addDoc(collection(db, COL), toFirestore({
    ...data,
    createdAt: now,
    updatedAt: now,
  }));
  return ref.id;
};

export const updateAnnouncement = async (
  id: string,
  data: Partial<Omit<Announcement, 'id' | 'createdAt'>>
): Promise<void> => {
  await updateDoc(doc(db, COL, id), toFirestore(data));
};

export const deleteAnnouncement = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, COL, id));
};
