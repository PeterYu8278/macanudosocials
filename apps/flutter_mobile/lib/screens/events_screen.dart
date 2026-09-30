import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../theme/app_theme.dart';

class EventsScreen extends StatelessWidget {
  const EventsScreen({super.key, required this.user});
  final User user;

  DateTime? _date(Object? value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    return DateTime.tryParse(value?.toString() ?? '');
  }

  @override
  Widget build(BuildContext context) => SafeArea(
    child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('events')
          .where('status', isEqualTo: 'published')
          .snapshots(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting &&
            !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final events = [...?snapshot.data?.docs]
          ..sort((a, b) {
            final aSchedule = a.data()['schedule'] is Map
                ? Map<String, dynamic>.from(a.data()['schedule'] as Map)
                : const <String, dynamic>{};
            final bSchedule = b.data()['schedule'] is Map
                ? Map<String, dynamic>.from(b.data()['schedule'] as Map)
                : const <String, dynamic>{};
            return (_date(aSchedule['startDate']) ?? DateTime(2100)).compareTo(
              _date(bSchedule['startDate']) ?? DateTime(2100),
            );
          });
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 18, 16, 108),
          children: [
            const Text(
              'Events',
              style: TextStyle(
                color: AppColors.goldLight,
                fontSize: 28,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 5),
            const Text(
              'Discover gatherings, announcements and member experiences.',
              style: TextStyle(color: AppColors.muted, fontSize: 13),
            ),
            const SizedBox(height: 18),
            if (events.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 80),
                child: Column(
                  children: [
                    Icon(
                      Icons.calendar_month_outlined,
                      color: AppColors.goldDeep,
                      size: 46,
                    ),
                    SizedBox(height: 12),
                    Text(
                      'No published events yet.',
                      style: TextStyle(color: AppColors.muted),
                    ),
                  ],
                ),
              )
            else
              ...events.map(
                (event) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: _EventCard(data: event.data(), toDate: _date),
                ),
              ),
          ],
        );
      },
    ),
  );
}

class _EventCard extends StatelessWidget {
  const _EventCard({required this.data, required this.toDate});
  final Map<String, dynamic> data;
  final DateTime? Function(Object?) toDate;

  @override
  Widget build(BuildContext context) {
    final schedule = data['schedule'] is Map
        ? Map<String, dynamic>.from(data['schedule'] as Map)
        : const <String, dynamic>{};
    final location = data['location'] is Map
        ? Map<String, dynamic>.from(data['location'] as Map)
        : const <String, dynamic>{};
    final start = toDate(schedule['startDate']);
    final image = (data['image'] ?? data['imageUrl'] ?? data['coverImage'])
        ?.toString();
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF333333)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Stack(
            children: [
              SizedBox(
                width: double.infinity,
                height: 180,
                child: image != null && image.isNotEmpty
                    ? Image.network(
                        image,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) =>
                            const _EventPlaceholder(),
                      )
                    : const _EventPlaceholder(),
              ),
              Positioned(
                top: 12,
                right: 12,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 11,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.goldDeep,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text(
                    'UPCOMING',
                    style: TextStyle(
                      color: Colors.black,
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  (data['title'] ?? 'Event').toString(),
                  style: const TextStyle(
                    color: AppColors.goldLight,
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                _Detail(
                  icon: Icons.schedule,
                  text: start == null
                      ? 'Date to be announced'
                      : DateFormat('MMM d, yyyy · h:mm a').format(start),
                ),
                const SizedBox(height: 7),
                _Detail(
                  icon: Icons.location_on_outlined,
                  text: (location['name'] ?? location['address'] ?? '-')
                      .toString(),
                ),
                if ((data['description'] ?? '').toString().isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(
                    data['description'].toString(),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: AppColors.muted, height: 1.4),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EventPlaceholder extends StatelessWidget {
  const _EventPlaceholder();
  @override
  Widget build(BuildContext context) => const ColoredBox(
    color: Color(0xFF242117),
    child: Center(
      child: Icon(
        Icons.calendar_month_outlined,
        color: AppColors.goldDeep,
        size: 52,
      ),
    ),
  );
}

class _Detail extends StatelessWidget {
  const _Detail({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(icon, color: AppColors.goldDeep, size: 17),
      const SizedBox(width: 8),
      Expanded(
        child: Text(
          text,
          style: const TextStyle(color: AppColors.muted, fontSize: 13),
        ),
      ),
    ],
  );
}
