import { Bell, BellOff, LogOut, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';

import { GoldButton } from '@/components/gold-button';
import { Screen } from '@/components/screen';
import { disableNativePushToken, getPushPermissionGranted, registerNativePushToken } from '@/lib/notifications';
import { useSession } from '@/providers/session-provider';
import { colors, radius, spacing } from '@/theme/tokens';

export default function ProfileScreen() {
  const { profile, signOut, user } = useSession();
  const [pushEnabled, setPushEnabled] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    void getPushPermissionGranted().then(setPushEnabled).catch(() => setPushEnabled(false));
  }, []);

  const changePush = async (enabled: boolean) => {
    if (!user) return;
    setUpdating(true);
    try {
      if (enabled) {
        await registerNativePushToken(user.uid);
        Alert.alert('Notifications enabled', 'This device is ready to receive Macanudo Socials updates.');
      } else {
        await disableNativePushToken(user.uid);
      }
      setPushEnabled(enabled);
    } catch (error) {
      Alert.alert('Notification setup failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Screen>
      <View style={styles.heading}>
        <View style={styles.avatar}><UserRound color={colors.black} size={38} /></View>
        <Text style={styles.name}>{profile?.displayName || profile?.name || 'Member'}</Text>
        <Text style={styles.memberId}>Member ID: {profile?.memberId || user?.uid.slice(0, 8)}</Text>
      </View>

      <Text style={styles.sectionTitle}>Personal Information</Text>
      <View style={styles.section}>
        <ProfileRow icon={<Mail color={colors.gold} size={20} />} label="Email" value={profile?.email || user?.email || '-'} />
        <ProfileRow icon={<Phone color={colors.gold} size={20} />} label="Phone" value={profile?.phone || '-'} />
        <ProfileRow icon={<ShieldCheck color={colors.gold} size={20} />} label="Role" value={profile?.role || 'member'} />
      </View>

      <Text style={styles.sectionTitle}>Notifications</Text>
      <View style={styles.notificationRow}>
        {pushEnabled ? <Bell color={colors.gold} size={22} /> : <BellOff color={colors.textMuted} size={22} />}
        <View style={styles.notificationCopy}>
          <Text style={styles.rowLabel}>Push notifications</Text>
          <Text style={styles.rowDescription}>Event, announcement and membership reminders</Text>
        </View>
        <Switch
          disabled={updating}
          onValueChange={changePush}
          thumbColor={colors.text}
          trackColor={{ false: '#4c4a45', true: colors.gold }}
          value={pushEnabled}
        />
      </View>

      <View style={styles.signOutWrap}><LogOut color={colors.danger} size={19} /><View style={styles.signOutButton}><GoldButton label="Sign Out" onPress={() => void signOut()} /></View></View>
    </Screen>
  );
}

function ProfileRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.row}>
      {icon}
      <View style={styles.rowCopy}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue}>{value}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { marginTop: spacing.sm, alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.surface },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.goldLight, borderWidth: 3, borderColor: colors.goldDeep, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.goldLight, fontSize: 22, fontWeight: '700' },
  memberId: { color: colors.textMuted, fontSize: 13 },
  sectionTitle: { color: colors.goldLight, fontSize: 16, fontWeight: '700', marginTop: spacing.sm },
  section: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  row: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#4a4437' },
  rowCopy: { flex: 1, gap: 2 },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowValue: { color: colors.textMuted, fontSize: 13, textTransform: 'capitalize' },
  notificationRow: { minHeight: 90, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing.md },
  notificationCopy: { flex: 1, gap: spacing.xs },
  rowDescription: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  signOutWrap: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  signOutButton: { flex: 1 },
});
