import 'package:cloud_firestore/cloud_firestore.dart';

class MemberProfile {
  const MemberProfile({
    required this.id,
    required this.name,
    required this.email,
    required this.memberId,
    required this.role,
    required this.status,
    required this.phone,
    required this.points,
    required this.avatarUrl,
    required this.redeemedMilestones,
  });

  final String id;
  final String name;
  final String email;
  final String memberId;
  final String role;
  final String status;
  final String phone;
  final num points;
  final String avatarUrl;
  final List<int> redeemedMilestones;

  bool get isActive =>
      status.toLowerCase() == 'active' || status.toLowerCase() == 'activated';

  factory MemberProfile.fromSnapshot(
    DocumentSnapshot<Map<String, dynamic>> snapshot, {
    String fallbackEmail = '',
  }) {
    final data = snapshot.data() ?? const <String, dynamic>{};
    final profile = data['profile'] is Map
        ? Map<String, dynamic>.from(data['profile'] as Map)
        : const <String, dynamic>{};
    final membership = data['membership'] is Map
        ? Map<String, dynamic>.from(data['membership'] as Map)
        : const <String, dynamic>{};
    return MemberProfile(
      id: snapshot.id,
      name: (data['displayName'] ?? data['name'] ?? 'Member').toString(),
      email: (data['email'] ?? fallbackEmail).toString(),
      memberId: (data['memberId'] ?? 'MEMBER').toString(),
      role: (data['role'] ?? 'member').toString(),
      status: (data['status'] ?? 'inactive').toString(),
      phone: (profile['phone'] ?? data['phone'] ?? '').toString(),
      points: membership['points'] is num
          ? membership['points'] as num
          : (data['points'] is num ? data['points'] as num : 0),
      avatarUrl: (profile['avatar'] ?? data['photoURL'] ?? '').toString(),
      redeemedMilestones: _integerList(
        data['referral'] is Map
            ? (data['referral'] as Map)['redeemedMilestones']
            : null,
      ),
    );
  }

  static List<int> _integerList(Object? value) {
    if (value is! List) return const [];
    return value.whereType<num>().map((item) => item.toInt()).toList();
  }
}
