import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/member_profile.dart';
import '../services/admin_navigation_service.dart';
import '../services/home_repository.dart';
import '../theme/app_theme.dart';
import '../widgets/member_card.dart';
import '../widgets/mystery_gift_dialog.dart';
import '../widgets/redemption_history_dialog.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.user});
  final User user;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final HomeRepository _repository;
  late Future<HomeSnapshot> _homeData;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _repository = HomeRepository(FirebaseFirestore.instance);
    _homeData = _repository.load(widget.user.uid);
    _refreshTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) {
        setState(() => _homeData = _repository.load(widget.user.uid));
      }
    });
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    final next = _repository.load(widget.user.uid);
    setState(() => _homeData = next);
    await next;
  }

  @override
  Widget build(BuildContext context) =>
      StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: FirebaseFirestore.instance
            .doc('users/${widget.user.uid}')
            .snapshots(),
        builder: (context, memberSnapshot) {
          if (!memberSnapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final member = MemberProfile.fromSnapshot(
            memberSnapshot.data!,
            fallbackEmail: widget.user.email ?? '',
          );
          return FutureBuilder<HomeSnapshot>(
            future: _homeData,
            builder: (context, homeSnapshot) {
              final data = homeSnapshot.data ?? const HomeSnapshot();
              return SafeArea(
                bottom: false,
                child: RefreshIndicator(
                  onRefresh: _refresh,
                  color: AppColors.gold,
                  backgroundColor: AppColors.surface,
                  child: ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 108),
                    children: [
                      _WelcomeMemberPanel(member: member, data: data),
                      const SizedBox(height: 12),
                      _VisitPanel(
                        data: data,
                        userId: member.id,
                        repository: _repository,
                      ),
                      const SizedBox(height: 16),
                      MysteryGiftButton(
                        member: member,
                        data: data,
                        repository: _repository,
                        onClaimed: _refresh,
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      );
}

class _WelcomeMemberPanel extends StatelessWidget {
  const _WelcomeMemberPanel({required this.member, required this.data});
  final MemberProfile member;
  final HomeSnapshot data;

  @override
  Widget build(BuildContext context) => _Panel(
    radius: 20,
    borderWidth: 2,
    gradient: const LinearGradient(
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
      colors: [Color(0xE61A1A1A), Color(0xCC2D2D2D)],
    ),
    child: Column(
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: _GoldText(
              'Welcome to ${data.appName.isEmpty ? 'MS' : data.appName}',
              size: 22,
            ),
          ),
        ),
        const SizedBox(height: 9),
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            const Expanded(
              flex: 16,
              child: Text(
                'Explore world-class cigars, join professional gatherings, and share tasting experiences with fellow enthusiasts.',
                style: TextStyle(
                  color: AppColors.muted,
                  fontSize: 12,
                  height: 1.4,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              flex: 8,
              child: _AppLogo(url: data.logoUrl, member: member),
            ),
          ],
        ),
        const SizedBox(height: 10),
        MemberCard(member: member),
      ],
    ),
  );
}

class _AppLogo extends StatelessWidget {
  const _AppLogo({required this.url, required this.member});
  final String url;
  final MemberProfile member;

  bool get _canAccessAdmin => const {
    'developer',
    'superadmin',
    'admin',
    'storeadmin',
  }.contains(member.role.toLowerCase());

  Future<void> _openAdmin(BuildContext context) async {
    try {
      await AdminNavigationService.openAdminPortal();
    } catch (_) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Unable to open the admin portal.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final fallback = Image.asset(
      'assets/images/app-logo-192.png',
      fit: BoxFit.contain,
    );
    final logo = url.isEmpty
        ? fallback
        : Image.network(
            url,
            fit: BoxFit.contain,
            errorBuilder: (_, error, stackTrace) => fallback,
          );
    return Semantics(
      button: _canAccessAdmin,
      label: _canAccessAdmin ? 'Open administration portal' : 'App logo',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: _canAccessAdmin ? () => _openAdmin(context) : null,
          child: SizedBox(height: 64, child: logo),
        ),
      ),
    );
  }
}

class _VisitPanel extends StatelessWidget {
  const _VisitPanel({
    required this.data,
    required this.userId,
    required this.repository,
  });
  final HomeSnapshot data;
  final String userId;
  final HomeRepository repository;

  String _duration(DateTime? start) {
    if (start == null) return '00:00:00';
    final value = DateTime.now().difference(start);
    return '${value.inHours.toString().padLeft(2, '0')}:'
        '${(value.inMinutes % 60).toString().padLeft(2, '0')}:'
        '${(value.inSeconds % 60).toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) => _Panel(
    child: Column(
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Text(
                        'Last Check In',
                        style: TextStyle(
                          color: AppColors.text,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          data.lastCheckIn == null
                              ? '--'
                              : DateFormat('yyyy-MM-dd HH:mm')
                                    .format(data.lastCheckIn!),
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.muted,
                            fontSize: 11,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  StreamBuilder<int>(
                    stream: Stream.periodic(
                      const Duration(seconds: 1),
                      (value) => value,
                    ),
                    builder: (context, snapshot) => Text(
                      _duration(data.activeCheckIn),
                      style: const TextStyle(
                        color: AppColors.text,
                        fontSize: 29,
                        fontWeight: FontWeight.w600,
                        height: 1.15,
                      ),
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Row(
                    children: [
                      Icon(Icons.schedule, color: AppColors.muted, size: 17),
                      SizedBox(width: 5),
                      Text(
                        'Stay Duration Timer',
                        style: TextStyle(color: AppColors.muted, fontSize: 12),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              children: [
                _GradientButton(
                  icon: Icons.shopping_cart_outlined,
                  label: 'Redeem',
                  onTap: () => _showMessage(
                    context,
                    data.activeCheckIn == null
                        ? 'Please check in before redeeming.'
                        : 'Redemption is available for this visit.',
                  ),
                ),
                const SizedBox(height: 7),
                Text(
                  'Daily Limit: ${data.dailyCount}/${data.dailyLimit}',
                  style: const TextStyle(
                    color: AppColors.text,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF171717),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Flexible(
                    child: Text(
                      'Complimentary Cigars',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: AppColors.text,
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () => showRedemptionHistoryDialog(
                      context: context,
                      repository: repository,
                      userId: userId,
                    ),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.goldDeep,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 4,
                        vertical: 8,
                      ),
                      minimumSize: const Size(44, 44),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: const Text(
                      'History >',
                      style: TextStyle(fontWeight: FontWeight.w800),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              Row(
                children: [
                  Expanded(
                    child: _Metric(
                      icon: Icons.schedule,
                      value: data.totalHours.toStringAsFixed(
                        data.totalHours % 1 == 0 ? 0 : 1,
                      ),
                      label: 'Accumulated Hours',
                    ),
                  ),
                  Container(
                    width: 1,
                    height: 66,
                    color: const Color(0xFF4A421D),
                  ),
                  Expanded(
                    child: _Metric(
                      icon: Icons.card_giftcard,
                      value: '${data.totalCount} / ${data.totalLimit}',
                      label: 'Cigars',
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _Panel extends StatelessWidget {
  const _Panel({
    required this.child,
    this.radius = 12,
    this.borderWidth = 1,
    this.gradient,
  });
  final Widget child;
  final double radius;
  final double borderWidth;
  final Gradient? gradient;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: gradient == null ? AppColors.surface : null,
      gradient: gradient,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: AppColors.border, width: borderWidth),
    ),
    child: child,
  );
}

class _GoldText extends StatelessWidget {
  const _GoldText(this.text, {required this.size});
  final String text;
  final double size;

  @override
  Widget build(BuildContext context) => ShaderMask(
    blendMode: BlendMode.srcIn,
    shaderCallback: (bounds) =>
        const LinearGradient(colors: [AppColors.goldLight, AppColors.goldDeep])
            .createShader(bounds),
    child: Text(
      text,
      maxLines: 1,
      style: TextStyle(
        fontSize: size,
        fontWeight: FontWeight.w900,
        height: 1.3,
      ),
    ),
  );
}

class _GradientButton extends StatelessWidget {
  const _GradientButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.transparent,
    child: InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap,
      child: Ink(
        width: 124,
        height: 54,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          gradient: const LinearGradient(
            colors: [AppColors.goldLight, AppColors.goldDeep],
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: Colors.black, size: 21),
            const SizedBox(width: 8),
            Text(
              label,
              style: const TextStyle(
                color: Colors.black,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _Metric extends StatelessWidget {
  const _Metric({required this.icon, required this.value, required this.label});
  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      Icon(icon, color: AppColors.goldDeep, size: 22),
      const SizedBox(width: 9),
      Flexible(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              value,
              maxLines: 1,
              style: const TextStyle(
                color: AppColors.goldLight,
                fontSize: 18,
                fontWeight: FontWeight.w800,
              ),
            ),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: AppColors.muted, fontSize: 10.5),
            ),
          ],
        ),
      ),
    ],
  );
}

void _showMessage(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}
