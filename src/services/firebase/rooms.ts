import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy,
  Timestamp,
  runTransaction
} from '@/services/firebase/monitoredFirestore';
import { db } from '../../config/firebase';
import { convertFirestoreTimestamps } from './auth';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import { calculateBookingPayment } from '../../utils/roomBookingFees';

const ROOMS_COLLECTION = 'rooms';
const ROOM_BOOKINGS_COLLECTION = 'roomBookings';

export interface Room {
  id?: string;
  storeId: string;
  name: string;
  status: 'active' | 'inactive';
  timeslots: string[]; // e.g. ["09:00 - 12:00", "12:00 - 15:00"]
  bookingStart?: string; // e.g. "10:00"
  bookingEnd?: string;   // e.g. "22:00"
  fee: number; // Booking fee
  minBookingHours?: number; // Minimum booking duration
  unavailablePeriods?: { start: string; end: string }[]; // Blocked periods
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RoomBooking {
  id?: string;
  roomId: string;
  roomName: string;
  storeId: string;
  userId: string;
  userName?: string;
  date: string; // YYYY-MM-DD
  timeslot: string; // e.g. "10:00 - 14:00"
  fee: number; // Total fee
  paidFee?: number; // Amount already paid (deposit or full payment)
  paymentMode?: 'deposit' | 'full';
  visitSessionId?: string;
  status: 'confirmed' | 'cancelled' | 'checked_in';
  createdAt?: Date;
  updatedAt?: Date;
}

// Helper to convert "HH:mm" or "h:mm am/pm" to minutes since midnight
export const timeToMinutes = (timeStr: string): number => {
  const cleanStr = timeStr.trim().toLowerCase();
  let hours = 0;
  let minutes = 0;
  
  if (cleanStr.includes('am') || cleanStr.includes('pm')) {
    const match = cleanStr.match(/(\d+)(?::(\d+))?\s*(am|pm)/);
    if (match) {
      hours = parseInt(match[1], 10);
      minutes = match[2] ? parseInt(match[2], 10) : 0;
      const ampm = match[3];
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
    }
  } else {
    const parts = cleanStr.split(':').map(Number);
    hours = parts[0] || 0;
    minutes = parts[1] || 0;
  }
  return hours * 60 + minutes;
};

// Check if range [s1, e1] overlaps with [s2, e2]
export const checkTimeOverlap = (range1: string, range2: string): boolean => {
  const r1Parts = range1.split('-').map(s => s.trim());
  const r2Parts = range2.split('-').map(s => s.trim());
  if (r1Parts.length < 2 || r2Parts.length < 2) return false;
  
  const start1 = timeToMinutes(r1Parts[0]);
  const end1 = timeToMinutes(r1Parts[1]);
  const start2 = timeToMinutes(r2Parts[0]);
  const end2 = timeToMinutes(r2Parts[1]);
  
  return start1 < end2 && start2 < end1;
};

// 过滤掉 undefined 的字段，防止 Firestore 报错
const stripUndefined = (obj: Record<string, any>): Record<string, any> => {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
};

export const getAllRooms = async (storeId?: string) => {
  try {
    let q;
    if (storeId) {
      q = query(collection(db, ROOMS_COLLECTION), where('storeId', '==', storeId));
    } else {
      q = query(collection(db, ROOMS_COLLECTION));
    }
    const querySnapshot = await getDocs(q);
    const rooms = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...convertFirestoreTimestamps(doc.data())
    })) as Room[];
    return rooms.sort((a, b) => {
      const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tB - tA;
    });
  } catch (error) {
    console.error('[Rooms Service] getAllRooms error:', error);
    return [];
  }
};

/**
 * 获取活跃房间/包厢
 */
export const getActiveRooms = async () => {
  try {
    const q = query(
      collection(db, ROOMS_COLLECTION),
      where('status', '==', 'active')
    );
    const querySnapshot = await getDocs(q);
    const rooms = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...convertFirestoreTimestamps(doc.data())
    })) as Room[];
    return rooms.sort((a, b) => {
      const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tB - tA;
    });
  } catch (error) {
    console.error('[Rooms Service] getActiveRooms error:', error);
    return [];
  }
};

/**
 * 创建房间/包厢
 */
export const createRoom = async (roomData: Omit<Room, 'id' | 'createdAt' | 'updatedAt'>) => {
  try {
    const now = new Date();
    const docRef = await addDoc(collection(db, ROOMS_COLLECTION), {
      ...stripUndefined(roomData as Record<string, any>),
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now)
    });
    return { success: true, id: docRef.id };
  } catch (error: any) {
    console.error('[Rooms Service] createRoom error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 更新房间/包厢
 */
export const updateRoom = async (roomId: string, roomData: Partial<Omit<Room, 'id' | 'createdAt' | 'updatedAt'>>) => {
  try {
    const docRef = doc(db, ROOMS_COLLECTION, roomId);
    await updateDoc(docRef, {
      ...stripUndefined(roomData as Record<string, any>),
      updatedAt: Timestamp.fromDate(new Date())
    });
    return { success: true };
  } catch (error: any) {
    console.error('[Rooms Service] updateRoom error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 删除房间/包厢
 */
export const deleteRoom = async (roomId: string) => {
  try {
    const docRef = doc(db, ROOMS_COLLECTION, roomId);
    await deleteDoc(docRef);
    return { success: true };
  } catch (error: any) {
    console.error('[Rooms Service] deleteRoom error:', error);
    return { success: false, error: error.message };
  }
};

// ========== Room Bookings ==========

/**
 * 获取指定日期的所有预订（用于判断时段是否已被预订）
 */
export const getBookingsByDate = async (date: string, roomId?: string) => {
  try {
    let q;
    if (roomId) {
      q = query(
        collection(db, ROOM_BOOKINGS_COLLECTION),
        where('date', '==', date),
        where('roomId', '==', roomId)
      );
    } else {
      q = query(
        collection(db, ROOM_BOOKINGS_COLLECTION),
        where('date', '==', date)
      );
    }
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...convertFirestoreTimestamps(doc.data())
    })) as RoomBooking[];
  } catch (error) {
    console.error('[Rooms Service] getBookingsByDate error:', error);
    return [];
  }
};

export const getAllBookings = async () => {
  try {
    const q = query(collection(db, ROOM_BOOKINGS_COLLECTION));
    const querySnapshot = await getDocs(q);
    const bookings = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...convertFirestoreTimestamps(doc.data())
    })) as RoomBooking[];
    return bookings.sort((a, b) => b.date.localeCompare(a.date));
  } catch (error) {
    console.error('[Rooms Service] getAllBookings error:', error);
    return [];
  }
};

export const getUserBookings = async (userId: string) => {
  try {
    const q = query(
      collection(db, ROOM_BOOKINGS_COLLECTION),
      where('userId', '==', userId)
    );
    const querySnapshot = await getDocs(q);
    const bookings = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...convertFirestoreTimestamps(doc.data())
    })) as RoomBooking[];
    return bookings.sort((a, b) => b.date.localeCompare(a.date));
  } catch (error) {
    console.error('[Rooms Service] getUserBookings error:', error);
    return [];
  }
};

export const createBooking = async (bookingData: Omit<RoomBooking, 'id' | 'createdAt' | 'updatedAt'>) => {
  try {
    const now = new Date();
    
    // Deterministic ID to prevent concurrent double-booking of exact slot
    const bookingDocId = `${bookingData.roomId}_${bookingData.date}_${bookingData.timeslot.replace(/[\s:-]+/g, '_')}`;
    const bookingDocRef = doc(db, ROOM_BOOKINGS_COLLECTION, bookingDocId);
    
    const userDocRef = doc(db, GLOBAL_COLLECTIONS.USERS, bookingData.userId);
    const dailyDocId = `${bookingData.roomId}_${bookingData.date}`;
    const dailyDocRef = doc(db, 'roomDailyBookings', dailyDocId);
    
    const result = await runTransaction(db, async (transaction) => {
      // 1. Check if user already has a confirmed booking for this room on this date that overlaps
      let myOldBookingId: string | null = null;
      let myOldBookingTimeslot: string | null = null;
      let myOldBookingPaidFee = 0;
      
      const dailySnap = await transaction.get(dailyDocRef);
      const currentRanges = dailySnap.exists() ? (dailySnap.data().bookedRanges || []) : [];
      
      for (const range of currentRanges) {
        if (range.status === 'confirmed') {
          const isOverlap = checkTimeOverlap(range.timeslot, bookingData.timeslot);
          if (isOverlap) {
            if (range.userId === bookingData.userId) {
              // This is the user's own existing booking! We will extend/merge it.
              myOldBookingId = range.bookingId;
              myOldBookingTimeslot = range.timeslot;
            } else {
              // Conflict with someone else's booking
              throw new Error('该时间段已被预订 (This time slot overlaps with an existing booking)');
            }
          }
        }
      }
      
      // 2. Fetch user points
      const userSnap = await transaction.get(userDocRef);
      if (!userSnap.exists()) {
        throw new Error('用户不存在');
      }
      
      const userData = userSnap.data();
      const currentPoints = userData.membership?.points || 0;
      const currentVisitSessionId = userData.membership?.currentVisitSessionId as string | undefined;
      let hasActiveVisitSession = false;

      if (currentVisitSessionId) {
        const visitSessionRef = doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, currentVisitSessionId);
        const visitSessionSnap = await transaction.get(visitSessionRef);
        hasActiveVisitSession = visitSessionSnap.exists()
          && visitSessionSnap.data().userId === bookingData.userId
          && visitSessionSnap.data().status === 'pending';
      }
      
      // If we are replacing/extending an existing booking:
      if (myOldBookingId) {
        const oldBookingDocRef = doc(db, ROOM_BOOKINGS_COLLECTION, myOldBookingId);
        const oldBookingSnap = await transaction.get(oldBookingDocRef);
        if (oldBookingSnap.exists()) {
          const oldData = oldBookingSnap.data();
          myOldBookingPaidFee = oldData.paidFee ?? calculateBookingPayment(oldData.fee || 0, false);
        }
      }
      
      const newPaidFee = calculateBookingPayment(bookingData.fee || 0, hasActiveVisitSession);
      const netFee = newPaidFee - myOldBookingPaidFee;
      
      if (netFee > 0 && currentPoints < netFee) {
        throw new Error('积分余额不足');
      }
      
      const newPoints = currentPoints - netFee;
      
      // 3. Update user points (deduct or refund net amount)
      transaction.update(userDocRef, {
        'membership.points': newPoints,
        updatedAt: Timestamp.fromDate(now)
      });
      
      // 4. Create points record if there's any points change or it's an extension
      const pointsRecordRef = doc(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS));
      if (myOldBookingId) {
        if (netFee !== 0) {
          const pointsRecordData = {
            userId: bookingData.userId,
            userName: bookingData.userName || userData.displayName || '',
            type: netFee >= 0 ? 'spend' : 'earn',
            amount: Math.abs(netFee),
            source: 'visit',
            description: `延长房间预订 (${hasActiveVisitSession ? '已驻店，补付全额差额' : '补付 50% 订金差额'}): ${bookingData.roomName} (由 ${myOldBookingTimeslot} 变更为 ${bookingData.timeslot})`,
            relatedId: bookingDocId,
            balance: newPoints,
            createdAt: Timestamp.fromDate(now)
          };
          transaction.set(pointsRecordRef, pointsRecordData);
        }
      } else {
        const pointsRecordData = {
          userId: bookingData.userId,
          userName: bookingData.userName || userData.displayName || '',
          type: 'spend',
          amount: newPaidFee,
          source: 'visit',
          description: `房间预订 (${hasActiveVisitSession ? '已驻店，扣除 100% 房费' : '扣除 50% 订金'}): ${bookingData.roomName} (${bookingData.date} ${bookingData.timeslot})`,
          relatedId: bookingDocId,
          balance: newPoints,
          createdAt: Timestamp.fromDate(now)
        };
        transaction.set(pointsRecordRef, pointsRecordData);
      }
      
      // 5. Delete the old booking document if it exists
      if (myOldBookingId) {
        const oldBookingDocRef = doc(db, ROOM_BOOKINGS_COLLECTION, myOldBookingId);
        transaction.delete(oldBookingDocRef);
      }
      
      // 6. Create the new booking document
      const bookingDocData = {
        ...stripUndefined(bookingData as Record<string, any>),
        paidFee: newPaidFee,
        paymentMode: hasActiveVisitSession ? 'full' : 'deposit',
        ...(hasActiveVisitSession && currentVisitSessionId ? { visitSessionId: currentVisitSessionId } : {}),
        status: 'confirmed',
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now)
      };
      transaction.set(bookingDocRef, bookingDocData);
      
      // 7. Update the daily summary document
      const filteredRanges = currentRanges.filter((r: any) => r.bookingId !== myOldBookingId && r.bookingId !== bookingDocId);
      const updatedRanges = [
        ...filteredRanges,
        {
          bookingId: bookingDocId,
          timeslot: bookingData.timeslot,
          userId: bookingData.userId,
          status: 'confirmed'
        }
      ];
      
      transaction.set(dailyDocRef, {
        roomId: bookingData.roomId,
        date: bookingData.date,
        bookedRanges: updatedRanges,
        updatedAt: Timestamp.fromDate(now)
      }, { merge: true });
      
      return { success: true, id: bookingDocId };
    });
    
    return result;
  } catch (error: any) {
    console.error('[Rooms Service] createBooking error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 取消预订 (不退还已支付积分)
 */
export const cancelBooking = async (bookingId: string) => {
  try {
    const bookingDocRef = doc(db, ROOM_BOOKINGS_COLLECTION, bookingId);
    
    const result = await runTransaction(db, async (transaction) => {
      // --- READS FIRST ---
      
      // 1. Get booking
      const bookingSnap = await transaction.get(bookingDocRef);
      if (!bookingSnap.exists()) {
        throw new Error('预订记录不存在');
      }
      
      const bookingData = bookingSnap.data() as RoomBooking;
      if (bookingData.status === 'cancelled') {
        return { success: true };
      }
      
      // 2. Get daily summary
      const dailyDocId = `${bookingData.roomId}_${bookingData.date}`;
      const dailyDocRef = doc(db, 'roomDailyBookings', dailyDocId);
      const dailySnap = await transaction.get(dailyDocRef);
      
      // --- WRITES SECOND ---
      
      // 1. Update booking status
      transaction.update(bookingDocRef, {
        status: 'cancelled',
        updatedAt: Timestamp.fromDate(new Date())
      });
      
      // 2. Remove from roomDailyBookings summary
      if (dailySnap.exists()) {
        const dailyData = dailySnap.data();
        const bookedRanges = dailyData.bookedRanges || [];
        const updatedRanges = bookedRanges.map((r: any) => {
          if (r.bookingId === bookingId) {
            return { ...r, status: 'cancelled' };
          }
          return r;
        });
        transaction.update(dailyDocRef, {
          bookedRanges: updatedRanges,
          updatedAt: Timestamp.fromDate(new Date())
        });
      }
      
      return { success: true };
    });
    
    return result;
  } catch (error: any) {
    console.error('[Rooms Service] cancelBooking error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 办理签到入座 (扣除尚未支付的余额)
 */
export const checkInBooking = async (bookingId: string, operatorId: string = 'admin') => {
  try {
    const bookingDocRef = doc(db, ROOM_BOOKINGS_COLLECTION, bookingId);
    
    const result = await runTransaction(db, async (transaction) => {
      // --- READS FIRST ---
      
      // 1. Get booking
      const bookingSnap = await transaction.get(bookingDocRef);
      if (!bookingSnap.exists()) {
        throw new Error('预订记录不存在');
      }
      
      const bookingData = bookingSnap.data() as RoomBooking;
      if (bookingData.status !== 'confirmed') {
        throw new Error('只能对已确认的预订办理签到');
      }
      
      // 2. Get user
      const userDocRef = doc(db, GLOBAL_COLLECTIONS.USERS, bookingData.userId);
      const userSnap = await transaction.get(userDocRef);
      if (!userSnap.exists()) {
        throw new Error('预订用户不存在');
      }
      
      const userData = userSnap.data();
      const currentPoints = userData.membership?.points || 0;
      
      // Calculate any unpaid balance. Fully paid bookings have no balance.
      const remainingFee = bookingData.fee - (bookingData.paidFee || 0);
      if (remainingFee > 0 && currentPoints < remainingFee) {
        throw new Error(`用户积分不足，签到失败。还需扣除 ${remainingFee} 积分。`);
      }
      
      const newPoints = currentPoints - remainingFee;
      
      // --- WRITES SECOND ---
      
      // 1. Update user points
      transaction.update(userDocRef, {
        'membership.points': newPoints,
        updatedAt: Timestamp.fromDate(new Date())
      });
      
      // 2. Create a points record only when an unpaid balance remains.
      if (remainingFee > 0) {
        const pointsRecordRef = doc(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS));
        const pointsRecordData = {
          userId: bookingData.userId,
          userName: userData.displayName || '',
          type: 'spend',
          amount: remainingFee,
          source: 'visit',
          description: `包厢签到扣除余款: ${bookingData.roomName} (${bookingData.date} ${bookingData.timeslot})`,
          relatedId: bookingId,
          balance: newPoints,
          createdAt: Timestamp.fromDate(new Date()),
          createdBy: operatorId
        };
        transaction.set(pointsRecordRef, pointsRecordData);
      }
      
      // 3. Update booking status and paidFee
      transaction.update(bookingDocRef, {
        status: 'checked_in',
        paidFee: bookingData.fee,
        updatedAt: Timestamp.fromDate(new Date())
      });
      
      return { success: true };
    });
    
    return result;
  } catch (error: any) {
    console.error('[Rooms Service] checkInBooking error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 获取所有房间预订记录
 */
export const getAllRoomBookings = async (storeId?: string): Promise<RoomBooking[]> => {
  try {
    let q;
    if (storeId) {
      q = query(collection(db, ROOM_BOOKINGS_COLLECTION), where('storeId', '==', storeId));
    } else {
      q = query(collection(db, ROOM_BOOKINGS_COLLECTION));
    }
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...convertFirestoreTimestamps(doc.data())
    })) as RoomBooking[];
  } catch (error) {
    console.error('[Rooms Service] getAllRoomBookings error:', error);
    return [];
  }
};
