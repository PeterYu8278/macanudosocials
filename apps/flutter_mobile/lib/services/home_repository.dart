import 'package:cloud_firestore/cloud_firestore.dart';

class RedemptionHistoryItem {
  const RedemptionHistoryItem({
    required this.id,
    required this.cigarName,
    required this.quantity,
    required this.status,
    required this.redeemedAt,
  });

  final String id;
  final String cigarName;
  final int quantity;
  final String status;
  final DateTime redeemedAt;
}

class HomeSnapshot {
  const HomeSnapshot({
    this.activeCheckIn,
    this.lastCheckIn,
    this.totalHours = 0,
    this.dailyCount = 0,
    this.totalCount = 0,
    this.dailyLimit = 3,
    this.totalLimit = 25,
    this.successfulReferrals = 0,
    this.appName = 'MS',
    this.logoUrl = '',
    this.primaryStartColor = '#FDE08D',
    this.primaryEndColor = '#C48D3A',
  });

  final DateTime? activeCheckIn;
  final DateTime? lastCheckIn;
  final double totalHours;
  final int dailyCount;
  final int totalCount;
  final int dailyLimit;
  final int totalLimit;
  final int successfulReferrals;
  final String appName;
  final String logoUrl;
  final String primaryStartColor;
  final String primaryEndColor;
}

class HomeRepository {
  HomeRepository(this.db);
  final FirebaseFirestore db;

  Future<HomeSnapshot> load(String userId) async {
    final results = await Future.wait([
      db
          .collection('visitSessions')
          .where('userId', isEqualTo: userId)
          .limit(200)
          .get(),
      db
          .collection('redemptionRecords')
          .where('userId', isEqualTo: userId)
          .limit(500)
          .get(),
      db.doc('redemptionConfig/default').get(),
      db.doc('app_config/default').get(),
      db
          .collection('users/$userId/referrals')
          .where('membershipActivatedAt', isNull: false)
          .get(),
    ]);
    final sessions = results[0] as QuerySnapshot<Map<String, dynamic>>;
    final redemptions = results[1] as QuerySnapshot<Map<String, dynamic>>;
    final config = results[2] as DocumentSnapshot<Map<String, dynamic>>;
    final appConfig = results[3] as DocumentSnapshot<Map<String, dynamic>>;
    final referrals = results[4] as QuerySnapshot<Map<String, dynamic>>;

    DateTime? active;
    DateTime? last;
    var totalHours = 0.0;
    for (final document in sessions.docs) {
      final data = document.data();
      final checkedIn = _toDate(data['checkInAt']);
      if (checkedIn != null && (last == null || checkedIn.isAfter(last))) {
        last = checkedIn;
      }
      if (data['status'] == 'pending' &&
          checkedIn != null &&
          (active == null || checkedIn.isAfter(active))) {
        active = checkedIn;
      }
      if (data['status'] == 'completed' && data['checkInType'] != 'daypass') {
        totalHours += (data['durationHours'] as num?)?.toDouble() ?? 0;
      }
    }

    final today = DateTime.now().toUtc().toIso8601String().substring(0, 10);
    var dailyCount = 0;
    var totalCount = 0;
    for (final document in redemptions.docs) {
      final items = document.data()['redemptions'];
      if (items is! List) continue;
      for (final raw in items) {
        if (raw is! Map) continue;
        final quantity = (raw['quantity'] as num?)?.toInt() ?? 0;
        if (raw['dayKey'] == today) dailyCount += quantity;
        if (raw['isDayPass'] != true) totalCount += quantity;
      }
    }

    final configData = config.data() ?? const <String, dynamic>{};
    final appConfigData = appConfig.data() ?? const <String, dynamic>{};
    final colorTheme = appConfigData['colorTheme'] is Map
        ? Map<String, dynamic>.from(appConfigData['colorTheme'] as Map)
        : const <String, dynamic>{};
    final primaryButton = colorTheme['primaryButton'] is Map
        ? Map<String, dynamic>.from(colorTheme['primaryButton'] as Map)
        : const <String, dynamic>{};
    return HomeSnapshot(
      activeCheckIn: active,
      lastCheckIn: last,
      totalHours: totalHours,
      dailyCount: dailyCount,
      totalCount: totalCount,
      dailyLimit: (configData['dailyLimit'] as num?)?.toInt() ?? 3,
      totalLimit: (configData['totalLimit'] as num?)?.toInt() ?? 25,
      successfulReferrals: referrals.docs.length,
      appName: (appConfigData['appName'] ?? 'MS').toString(),
      logoUrl: (appConfigData['logoUrl'] ?? '').toString(),
      primaryStartColor: (primaryButton['startColor'] ?? '#FDE08D').toString(),
      primaryEndColor: (primaryButton['endColor'] ?? '#C48D3A').toString(),
    );
  }

  Future<void> claimReferralReward(String userId, int milestone) async {
    await db.doc('users/$userId').update({
      'referral.redeemedMilestones': FieldValue.arrayUnion([milestone]),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<List<RedemptionHistoryItem>> loadRedemptionHistory(
    String userId,
  ) async {
    final snapshot = await db
        .collection('redemptionRecords')
        .where('userId', isEqualTo: userId)
        .limit(500)
        .get();
    final history = <RedemptionHistoryItem>[];

    for (final document in snapshot.docs) {
      final items = document.data()['redemptions'];
      if (items is! List) continue;
      for (final raw in items) {
        if (raw is! Map || raw['isDayPass'] == true) continue;
        final redeemedAt = _toDate(raw['redeemedAt']);
        if (redeemedAt == null) continue;
        history.add(
          RedemptionHistoryItem(
            id: (raw['id'] ?? '${document.id}-${history.length}').toString(),
            cigarName: (raw['cigarName'] ?? '').toString(),
            quantity: (raw['quantity'] as num?)?.toInt() ?? 0,
            status: (raw['status'] ?? 'completed').toString(),
            redeemedAt: redeemedAt,
          ),
        );
      }
    }

    history.sort((a, b) => b.redeemedAt.compareTo(a.redeemedAt));
    return history;
  }

  DateTime? _toDate(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    return DateTime.tryParse(value?.toString() ?? '');
  }
}
