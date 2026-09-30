import { arrayUnion, doc, updateDoc } from 'firebase/firestore';
import { CheckCircle2, Gift, UserRoundPlus, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { db } from '@/lib/firebase';
import { colors, radius, spacing } from '@/theme/tokens';

const MILESTONES = [3, 6, 10, 20, 50] as const;

interface MysteryGiftModalProps {
  open: boolean;
  onClose: () => void;
  userId?: string;
  referrals: number;
  initialRedeemed?: number[];
}

export function MysteryGiftModal({ open, onClose, userId, referrals, initialRedeemed = [] }: MysteryGiftModalProps) {
  const [redeemed, setRedeemed] = useState(initialRedeemed);
  const [claiming, setClaiming] = useState<number | null>(null);
  const redeemedSet = useMemo(() => new Set(redeemed), [redeemed]);

  const claim = async (target: number) => {
    if (!userId || referrals < target || redeemedSet.has(target)) return;
    setClaiming(target);
    try {
      await updateDoc(doc(db, 'users', userId), {
        'referral.redeemedMilestones': arrayUnion(target),
        updatedAt: new Date(),
      });
      setRedeemed((current) => [...current, target]);
      Alert.alert('Reward claimed', 'Your referral reward is ready for redemption review.');
    } catch (error) {
      Alert.alert('Unable to claim reward', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setClaiming(null);
    }
  };

  return (
    <Modal animationType="fade" transparent visible={open} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.titleRow}><Gift color={colors.goldLight} size={21} /><Text style={styles.title}>Mystery Gift Redemption</Text></View>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.close}><X color={colors.text} size={20} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>Daily redemption</Text>
              <Text style={styles.infoText}>Base limit: 3 cigars per day</Text>
              <Text style={styles.infoText}>Wait interval: 1 hour between redemptions</Text>
              <Text style={styles.infoText}>Last call: 11:00 PM</Text>
            </View>

            <View style={styles.referralHeader}>
              <View style={styles.titleRow}><UserRoundPlus color={colors.goldLight} size={19} /><Text style={styles.infoTitle}>Referral rewards</Text></View>
              <Text style={styles.current}>Current: {referrals}</Text>
            </View>

            {MILESTONES.map((target) => {
              const eligible = referrals >= target;
              const isRedeemed = redeemedSet.has(target);
              const progress = Math.min(100, (referrals / target) * 100);
              return (
                <View key={target} style={styles.milestone}>
                  <View style={styles.milestoneRow}>
                    <Text style={[styles.milestoneText, eligible && styles.eligible]}>Invite {target} friends</Text>
                    {isRedeemed ? (
                      <View style={styles.redeemed}><CheckCircle2 color={colors.textSubtle} size={14} /><Text style={styles.redeemedText}>Redeemed</Text></View>
                    ) : (
                      <Pressable disabled={!eligible || claiming === target} onPress={() => void claim(target)} style={[styles.claim, !eligible && styles.claimDisabled]}>
                        {claiming === target ? <ActivityIndicator color={colors.black} size="small" /> : <Text style={[styles.claimText, !eligible && styles.claimTextDisabled]}>Claim</Text>}
                      </Pressable>
                    )}
                  </View>
                  <View style={styles.track}><View style={[styles.progress, { width: `${progress}%` }]} /></View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.82)', alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  sheet: { width: '100%', maxWidth: 430, maxHeight: '82%', backgroundColor: '#1a1612', borderRadius: 16, borderWidth: 1, borderColor: '#705b20', overflow: 'hidden' },
  header: { minHeight: 60, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#55451e' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { color: colors.goldLight, fontSize: 17, fontWeight: '700' },
  close: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.md, gap: spacing.md },
  infoBox: { backgroundColor: 'rgba(255,255,255,0.035)', borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  infoTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  infoText: { color: colors.textMuted, fontSize: 12 },
  referralHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  current: { color: colors.goldLight, fontSize: 12, fontWeight: '700' },
  milestone: { gap: spacing.sm },
  milestoneRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  milestoneText: { color: colors.textMuted, fontSize: 12 },
  eligible: { color: colors.goldLight },
  track: { height: 5, borderRadius: 3, backgroundColor: '#302d27', overflow: 'hidden' },
  progress: { height: '100%', borderRadius: 3, backgroundColor: colors.goldDeep },
  claim: { minWidth: 62, height: 30, borderRadius: radius.sm, backgroundColor: colors.goldLight, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  claimDisabled: { backgroundColor: '#302d27' },
  claimText: { color: colors.black, fontSize: 11, fontWeight: '700' },
  claimTextDisabled: { color: colors.textSubtle },
  redeemed: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  redeemedText: { color: colors.textSubtle, fontSize: 11 },
});
