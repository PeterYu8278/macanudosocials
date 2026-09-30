export type UserRole = 'member' | 'admin' | 'developer' | 'superadmin' | 'superAdmin';

export type NotificationType =
  | 'announcement_published'
  | 'event_published'
  | 'event_reminder'
  | 'vip_expiry_reminder';

export interface SharedUserProfile {
  id: string;
  name?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  memberId?: string;
  role?: UserRole;
  status?: string;
  points?: number;
  annualPassExpiry?: string;
}

export interface SharedEvent {
  id: string;
  title: string;
  description?: string;
  location?: {
    name?: string;
    address?: string;
  };
  image?: string;
  coverImage?: string;
  schedule?: {
    startDate?: unknown;
    endDate?: unknown;
    registrationDeadline?: unknown;
  };
  status?: string;
}

export const ACTIVE_MEMBER_STATUSES = new Set(['active', 'activated']);

export const APP_ROUTES = {
  home: '/',
  events: '/events',
  profile: '/profile',
} as const;
