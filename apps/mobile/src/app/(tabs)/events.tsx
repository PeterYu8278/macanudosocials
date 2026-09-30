import type { SharedEvent } from '@macanudo/shared';
import { Image } from 'expo-image';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { CalendarDays, Clock3, MapPin } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { db } from '@/lib/firebase';
import { colors, radius, spacing } from '@/theme/tokens';

export default function EventsScreen() {
  const [events, setEvents] = useState<SharedEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = await getDocs(query(collection(db, 'events'), where('status', '==', 'published')));
      const next = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as SharedEvent);
      next.sort((a, b) => eventTime(a) - eventTime(b));
      setEvents(next);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void loadEvents(), [loadEvents]);

  return (
    <Screen>
      <View style={styles.heading}>
        <Text style={styles.title}>Events</Text>
        <Text style={styles.subtitle}>Discover gatherings, announcements and member experiences.</Text>
      </View>
      {loading && events.length === 0 ? (
        <ActivityIndicator color={colors.gold} size="large" style={styles.loader} />
      ) : events.length === 0 ? (
        <View style={styles.empty}><CalendarDays color={colors.gold} size={34} /><Text style={styles.emptyText}>No published events yet.</Text></View>
      ) : (
        <View style={styles.list}>
          {events.map((event) => <EventCard event={event} key={event.id} />)}
        </View>
      )}
    </Screen>
  );
}

function asDate(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate() as Date;
  }
  const parsed = value ? new Date(value as string | number) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function eventTime(event: SharedEvent) {
  return asDate(event.schedule?.startDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}

function EventCard({ event }: { event: SharedEvent }) {
  const startsAt = asDate(event.schedule?.startDate);
  const dateLabel = startsAt
    ? startsAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'Date to be announced';
  const location = event.location?.name || event.location?.address;
  const image = event.image || event.coverImage;
  return (
    <View style={styles.card}>
      {image ? (
        <Image source={{ uri: image }} contentFit="cover" style={styles.cover} transition={180} />
      ) : (
        <LinearFallback />
      )}
      <View style={styles.statusPill}><Text style={styles.statusText}>UPCOMING</Text></View>
      <View style={styles.cardContent}>
        <Text style={styles.eventTitle}>{event.title}</Text>
        <View style={styles.detail}><Clock3 color={colors.goldDeep} size={16} /><Text style={styles.detailText}>{dateLabel}</Text></View>
        {!!location && <View style={styles.detail}><MapPin color={colors.goldDeep} size={16} /><Text style={styles.detailText}>{location}</Text></View>}
        {!!event.description && <Text numberOfLines={3} style={styles.description}>{event.description}</Text>}
      </View>
    </View>
  );
}

function LinearFallback() {
  return <View style={styles.coverFallback}><CalendarDays color={colors.goldDeep} size={46} /></View>;
}

const styles = StyleSheet.create({
  heading: { marginTop: spacing.sm, gap: spacing.xs, marginBottom: spacing.sm },
  title: { color: colors.goldLight, fontSize: 28, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  loader: { marginTop: 60 },
  list: { gap: spacing.md },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderSoft, backgroundColor: colors.surface, overflow: 'hidden', position: 'relative' },
  cover: { width: '100%', aspectRatio: 1.8, backgroundColor: colors.surfaceRaised },
  coverFallback: { width: '100%', aspectRatio: 1.8, backgroundColor: '#242117', alignItems: 'center', justifyContent: 'center' },
  statusPill: { position: 'absolute', top: 12, right: 12, borderRadius: 20, backgroundColor: colors.goldDeep, paddingHorizontal: 11, paddingVertical: 5 },
  statusText: { color: colors.black, fontSize: 10, fontWeight: '800' },
  cardContent: { padding: spacing.md, gap: spacing.sm },
  eventTitle: { color: colors.goldLight, fontSize: 20, fontWeight: '700' },
  detail: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailText: { color: colors.textMuted, flex: 1 },
  description: { color: colors.textMuted, lineHeight: 20, marginTop: spacing.xs },
  empty: { minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  emptyText: { color: colors.textMuted },
});
