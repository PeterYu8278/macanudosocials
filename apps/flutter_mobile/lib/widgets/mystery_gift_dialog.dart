import 'package:flutter/material.dart';

import '../models/member_profile.dart';
import '../services/home_repository.dart';
import '../theme/app_theme.dart';

const _milestones = [3, 6, 10, 20, 50];

class MysteryGiftButton extends StatelessWidget {
  const MysteryGiftButton({
    super.key,
    required this.member,
    required this.data,
    required this.repository,
    required this.onClaimed,
  });

  final MemberProfile member;
  final HomeSnapshot data;
  final HomeRepository repository;
  final VoidCallback onClaimed;

  @override
  Widget build(BuildContext context) => _GoldButton(
    icon: Icons.card_giftcard,
    label: 'Redeem Mystery Gift',
    startColor: _hexColor(data.primaryStartColor, AppColors.goldLight),
    endColor: _hexColor(data.primaryEndColor, AppColors.goldDeep),
    onTap: () => showDialog<void>(
      context: context,
      barrierColor: const Color(0xB3000000),
      builder: (context) => _MysteryGiftDialog(
        member: member,
        data: data,
        repository: repository,
        onClaimed: onClaimed,
      ),
    ),
  );
}

class _MysteryGiftDialog extends StatefulWidget {
  const _MysteryGiftDialog({
    required this.member,
    required this.data,
    required this.repository,
    required this.onClaimed,
  });

  final MemberProfile member;
  final HomeSnapshot data;
  final HomeRepository repository;
  final VoidCallback onClaimed;

  @override
  State<_MysteryGiftDialog> createState() => _MysteryGiftDialogState();
}

class _MysteryGiftDialogState extends State<_MysteryGiftDialog> {
  late final Set<int> _redeemed;
  int? _claiming;

  @override
  void initState() {
    super.initState();
    _redeemed = widget.member.redeemedMilestones.toSet();
  }

  Future<void> _claim(int milestone) async {
    setState(() => _claiming = milestone);
    try {
      await widget.repository.claimReferralReward(widget.member.id, milestone);
      if (!mounted) return;
      setState(() => _redeemed.add(milestone));
      widget.onClaimed();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Reward claimed successfully.')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Unable to claim this reward.')),
      );
    } finally {
      if (mounted) setState(() => _claiming = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final start = _hexColor(widget.data.primaryStartColor, AppColors.goldLight);
    final end = _hexColor(widget.data.primaryEndColor, AppColors.goldDeep);

    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 28),
      backgroundColor: const Color(0xFF1A1612),
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: Color(0x4DF4AF25)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 400, maxHeight: 650),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  const Icon(Icons.card_giftcard, color: AppColors.goldLight),
                  const SizedBox(width: 9),
                  const Expanded(
                    child: Text(
                      'Mystery Gift Redemption',
                      style: TextStyle(
                        color: AppColors.goldLight,
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Close',
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close, color: AppColors.muted),
                  ),
                ],
              ),
              const Divider(color: Color(0x33F4AF25)),
              const SizedBox(height: 6),
              const _InformationPanel(),
              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0x08FFFFFF),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        const Icon(
                          Icons.person_add_alt_1,
                          color: AppColors.goldLight,
                          size: 20,
                        ),
                        const SizedBox(width: 8),
                        const Expanded(
                          child: Text(
                            'Referral Rewards',
                            style: TextStyle(
                              color: AppColors.text,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        Text(
                          'Current: ${widget.data.successfulReferrals} friends',
                          style: const TextStyle(
                            color: AppColors.goldLight,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    for (final milestone in _milestones) ...[
                      _MilestoneRow(
                        milestone: milestone,
                        referralCount: widget.data.successfulReferrals,
                        redeemed: _redeemed.contains(milestone),
                        claiming: _claiming == milestone,
                        startColor: start,
                        endColor: end,
                        onClaim: () => _claim(milestone),
                      ),
                      if (milestone != _milestones.last)
                        const SizedBox(height: 13),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'Referral rewards are reviewed and fulfilled by an administrator.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Color(0x66FFFFFF), fontSize: 11),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InformationPanel extends StatelessWidget {
  const _InformationPanel();

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0x08FFFFFF),
      borderRadius: BorderRadius.circular(8),
    ),
    child: const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.info_outline, color: AppColors.goldLight, size: 20),
            SizedBox(width: 8),
            Text(
              'Daily Redemption Limit',
              style: TextStyle(
                color: AppColors.text,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
        SizedBox(height: 8),
        Text(
          '• Base limit: 3 cigars per day\n'
          '• Wait interval: 1 hour between redemptions\n'
          '• Last call: 23:00 PM',
          style: TextStyle(
            color: Color(0xB3FFFFFF),
            fontSize: 12,
            height: 1.65,
          ),
        ),
      ],
    ),
  );
}

class _MilestoneRow extends StatelessWidget {
  const _MilestoneRow({
    required this.milestone,
    required this.referralCount,
    required this.redeemed,
    required this.claiming,
    required this.startColor,
    required this.endColor,
    required this.onClaim,
  });

  final int milestone;
  final int referralCount;
  final bool redeemed;
  final bool claiming;
  final Color startColor;
  final Color endColor;
  final VoidCallback onClaim;

  @override
  Widget build(BuildContext context) {
    final eligible = referralCount >= milestone;
    final progress = (referralCount / milestone).clamp(0.0, 1.0);
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Invite $milestone friends',
                style: TextStyle(
                  color: eligible ? AppColors.goldLight : AppColors.muted,
                  fontSize: 12,
                ),
              ),
            ),
            if (redeemed)
              const Row(
                children: [
                  Icon(
                    Icons.check_circle_outline,
                    color: AppColors.subtle,
                    size: 15,
                  ),
                  SizedBox(width: 4),
                  Text(
                    'Redeemed',
                    style: TextStyle(color: AppColors.subtle, fontSize: 11),
                  ),
                ],
              )
            else
              SizedBox(
                height: 27,
                child: FilledButton(
                  onPressed: eligible && !claiming ? onClaim : null,
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 11),
                    backgroundColor: endColor,
                    disabledBackgroundColor: const Color(0x14FFFFFF),
                    disabledForegroundColor: const Color(0x40FFFFFF),
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(6),
                    ),
                  ),
                  child: Text(
                    claiming ? '...' : 'Claim Reward',
                    style: const TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 5),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: progress,
            minHeight: 5,
            color: redeemed
                ? AppColors.subtle
                : (eligible ? startColor : endColor),
            backgroundColor: const Color(0x0DFFFFFF),
          ),
        ),
      ],
    );
  }
}

class _GoldButton extends StatelessWidget {
  const _GoldButton({
    required this.icon,
    required this.label,
    required this.startColor,
    required this.endColor,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color startColor;
  final Color endColor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: label,
    child: Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Ink(
          width: double.infinity,
          height: 56,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            gradient: LinearGradient(colors: [startColor, endColor]),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: const Color(0xFF111111), size: 21),
              const SizedBox(width: 8),
              Text(
                label,
                style: const TextStyle(
                  color: Color(0xFF111111),
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

Color _hexColor(String value, Color fallback) {
  final normalized = value.replaceFirst('#', '');
  final parsed = int.tryParse(normalized, radix: 16);
  if (parsed == null || normalized.length != 6) return fallback;
  return Color(0xFF000000 | parsed);
}
