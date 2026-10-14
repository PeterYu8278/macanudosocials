import { collection, documentId, getDocs, limit, orderBy, query, startAfter,
  type DocumentData, type QueryDocumentSnapshot } from './monitoredFirestore'
import { db } from '../../config/firebase'
import type { CollectionName } from '../../config/globalCollections'
import { convertFirestoreTimestamps } from './core/sanitize'

// Reports need raw, complete records, including documents missing business dates.
export async function getReportRecords<T extends { id: string }>(name: CollectionName): Promise<T[]> {
  const records: T[] = []
  let cursor: QueryDocumentSnapshot<DocumentData> | undefined
  while (true) {
    const snapshot = await getDocs(query(collection(db, name), orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []), limit(1000)))
    records.push(...snapshot.docs.map(document => ({ ...convertFirestoreTimestamps(document.data()), id: document.id } as T)))
    if (snapshot.docs.length < 1000) return records
    cursor = snapshot.docs[snapshot.docs.length - 1]
  }
}
