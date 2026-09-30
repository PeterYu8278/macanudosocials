import { ACTIVE_MEMBER_STATUSES } from '@macanudo/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Clock3, Gift, QrCode, ShoppingCart } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { useSession } from '@/providers/session-provider';
import { colors, radius, spacing } from '@/theme/tokens';

export default function HomeScreen() {
  const { profile } = useSession();
  const active = ACTIVE_MEMBER_STATUSES.has(profile?.status?.toLowerCase() ?? '');
  const displayName = profile?.displayName || profile?.name || 'Member';

  return (
    <Screen>
      <View style={styles.welcomePanel}>
        <View style={styles.heading}>
          <View style={styles.welcomeCopy}>
            <Text style={styles.title}>Welcome to Macanudo Socials</Text>
            <Text style={styles.subtitle}>Explore world-class cigars, join professional gatherings, and share tasting experiences with fellow enthusiasts.</Text>
          </View>
          <View style={styles.logoFrame}><Image source={require('@/assets/images/app-logo-192.png')} contentFit="contain" style={styles.logo} /></View>
        </View>

        <LinearGradient colors={['#332d1f', '#1a1917', '#11110f']} style={styles.memberCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardBrand}>Macanudo Socials</Text>
              <Text style={styles.cardEdition}>CIGAR WORLD</Text>
            </View>
            <View style={styles.qrTile}><QrCode color={colors.black} size={39} strokeWidth={2.4} /></View>
          </View>
          <View style={styles.cardBody}>
            <View style={styles.identity}>
              <LinearGradient colors={[colors.goldLight, colors.goldDeep]} style={styles.avatar}>
                <Text style={styles.avatarText}>{displayName.slice(0, 1).toUpperCase()}</Text>
              </LinearGradient>
              <View>
                <Text style={styles.memberName}>{displayName}</Text>
                <Text style={styles.memberRole}>{profile?.role || 'Member'}</Text>
              </View>
            </View>
            <View style={styles.cardRight}>
              <Text style={styles.memberId}>{profile?.memberId || 'MEMBER'}</Text>
              <Text style={[styles.status, { color: active ? colors.text : colors.textMuted }]}>
                {active ? 'Active' : 'Not Activated'}
              </Text>
            </View>
          </View>
        </LinearGradient>
      </View>

      <View style={styles.visitContainer}>
        <View style={styles.visitPanel}>
          <View style={styles.visitInfo}>
            <View style={styles.lastCheckIn}><Text style={styles.labelStrong}>Last Check In</Text><Text style={styles.muted}>--</Text></View>
            <Text style={styles.timer}>00:00:00</Text>
            <View style={styles.timerLabel}><Clock3 color={colors.textMuted} size={15} /><Text style={styles.muted}>Stay Duration Timer</Text></View>
          </View>
          <View style={styles.redeemBlock}>
            <LinearGradient colors={[colors.goldLight, colors.goldDeep]} style={styles.redeemButton}>
              <ShoppingCart color={colors.black} size={20} /><Text style={styles.redeemText}>Redeem</Text>
            </LinearGradient>
            <Text style={styles.limit}>Daily Limit: 0/3</Text>
          </View>
        </View>

        <View style={styles.rewardCard}>
          <View style={styles.rewardHeader}><Text style={styles.sectionTitle}>Complimentary Cigars</Text><Text style={styles.history}>History &gt;</Text></View>
          <View style={styles.rewardStats}>
            <Metric icon={<Clock3 color={colors.goldDeep} size={21} />} label="Accumulated Hours" value="0" />
            <View style={styles.divider} />
            <Metric icon={<Gift color={colors.goldDeep} size={21} />} label="Cigars" value="0 / 25" />
          </View>
        </View>
      </View>

      <Pressable style={({ pressed }) => pressed && styles.pressed}>
        <LinearGradient colors={[colors.goldLight, colors.goldDeep]} style={styles.giftButton}>
          <Gift color={colors.black} size={20} />
          <Text style={styles.giftButtonText}>Redeem Mystery Gift</Text>
        </LinearGradient>
      </Pressable>
    </Screen>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.metric}>
      {icon}
      <View><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  welcomePanel: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.md },
  heading: { minHeight: 94, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  welcomeCopy: { flex: 1, gap: spacing.sm },
  title: { color: colors.goldLight, fontSize: 20, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  logoFrame: { width: 74, height: 74, borderRadius: radius.md, overflow: 'hidden', borderWidth: 1, borderColor: '#4a421d', backgroundColor: '#15130e' },
  logo: { width: 74, height: 74 },
  memberCard: { width: '100%', aspectRatio: 1.7, maxHeight: 222, borderRadius: 16, borderWidth: 1, borderColor: '#544515', padding: 20, justifyContent: 'space-between', overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardBrand: { color: colors.goldLight, fontSize: 20, fontWeight: '700' },
  cardEdition: { color: colors.goldDeep, fontSize: 11, letterSpacing: 2, fontWeight: '700', marginTop: 4 },
  qrTile: { width: 48, height: 48, borderRadius: 6, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  cardBody: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.goldLight },
  avatarText: { color: colors.black, fontWeight: '800', fontSize: 20 },
  memberName: { color: colors.text, fontSize: 18, fontWeight: '700', maxWidth: 180 },
  memberRole: { color: colors.goldDeep, fontSize: 12, textTransform: 'capitalize', fontWeight: '700' },
  cardRight: { alignItems: 'flex-end', gap: spacing.xs },
  memberId: { color: colors.text, fontSize: 15, fontWeight: '700' },
  status: { fontSize: 12, fontWeight: '700' },
  visitContainer: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#4a421d', borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  visitPanel: { minHeight: 104, flexDirection: 'row', justifyContent: 'space-between' },
  visitInfo: { flex: 1, gap: spacing.sm },
  lastCheckIn: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  labelStrong: { color: colors.text, fontSize: 13, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 12 },
  timer: { color: colors.text, fontSize: 26, fontWeight: '600' },
  timerLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  redeemBlock: { alignItems: 'center', gap: spacing.sm },
  redeemButton: { minWidth: 112, height: 48, borderRadius: radius.md, flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  redeemText: { color: colors.black, fontSize: 16, fontWeight: '700' },
  limit: { color: colors.text, fontSize: 12, fontWeight: '600' },
  rewardCard: { backgroundColor: '#171717', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, gap: spacing.lg },
  rewardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  history: { color: colors.goldDeep, fontWeight: '700' },
  rewardStats: { flexDirection: 'row', alignItems: 'stretch' },
  divider: { width: StyleSheet.hairlineWidth, backgroundColor: '#4a421d' },
  metric: { flex: 1, minHeight: 68, flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  metricValue: { color: colors.goldLight, fontSize: 18, fontWeight: '700' },
  metricLabel: { color: colors.textMuted, fontSize: 11 },
  giftButton: { height: 56, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  giftButtonText: { color: colors.black, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.82 },
});
