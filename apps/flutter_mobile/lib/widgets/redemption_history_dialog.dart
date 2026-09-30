import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../services/home_repository.dart';
import '../theme/app_theme.dart';

Future<void> showRedemptionHistoryDialog({
  required BuildContext context,
  required HomeRepository repository,
  required String userId,
}) => showDialog<void>(
  context: context,
  barrierColor: const Color(0xB3000000),
  builder: (context) =>
      _RedemptionHistoryDialog(repository: repository, userId: userId),
);

class _RedemptionHistoryDialog extends StatefulWidget {
  const _RedemptionHistoryDialog({
    required this.repository,
    required this.userId,
  });

  final HomeRepository repository;
  final String userId;

  @override
  State<_RedemptionHistoryDialog> createState() =>
      _RedemptionHistoryDialogState();
}

class _RedemptionHistoryDialogState extends State<_RedemptionHistoryDialog> {
  late final Future<List<RedemptionHistoryItem>> _history;

  @override
  void initState() {
    super.initState();
    _history = widget.repository.loadRedemptionHistory(widget.userId);
  }

  @override
  Widget build(BuildContext context) => Dialog(
    insetPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 28),
    backgroundColor: const Color(0xFF1A1612),
    shape: RoundedRectangleBorder(
      side: const BorderSide(color: Color(0x4DF4AF25)),
      borderRadius: BorderRadius.circular(16),
    ),
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 500, maxHeight: 650),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                const Icon(Icons.card_giftcard, color: AppColors.goldLight),
                const SizedBox(width: 9),
                const Expanded(
                  child: Text(
                    'Redemption History',
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
            Flexible(
              child: FutureBuilder<List<RedemptionHistoryItem>>(
                future: _history,
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(
                      child: CircularProgressIndicator(color: AppColors.gold),
                    );
                  }
                  if (snapshot.hasError) {
                    return const _EmptyState(
                      icon: Icons.error_outline,
                      message: 'Unable to load redemption history.',
                    );
                  }
                  final history = snapshot.data ?? const [];
                  if (history.isEmpty) {
                    return const _EmptyState(
                      icon: Icons.card_giftcard_outlined,
                      message: 'No redemption history yet.',
                    );
                  }
                  return ListView.separated(
                    shrinkWrap: true,
                    itemCount: history.length,
                    separatorBuilder: (_, index) => const SizedBox(height: 10),
                    itemBuilder: (context, index) =>
                        _HistoryCard(item: history[index]),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _HistoryCard extends StatelessWidget {
  const _HistoryCard({required this.item});

  final RedemptionHistoryItem item;

  @override
  Widget build(BuildContext context) {
    final completed = item.status == 'completed';
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0x26F4AF25)),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0x0DFFFFFF), Color(0x05FFFFFF)],
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        children: [
          Container(
            width: 68,
            height: 82,
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0x17F4AF25), Color(0x08FFFFFF)],
              ),
              border: Border(right: BorderSide(color: Color(0x40F4AF25))),
            ),
            child: const Icon(
              Icons.image_outlined,
              color: Color(0x80FDE08D),
              size: 27,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.schedule,
                      color: Color(0x80F4AF25),
                      size: 11,
                    ),
                    const SizedBox(width: 5),
                    Text(
                      DateFormat('yyyy-MM-dd HH:mm').format(item.redeemedAt),
                      style: const TextStyle(
                        color: Color(0x73FFFFFF),
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                Text(
                  item.cigarName.isEmpty
                      ? 'Pending cigar choice'
                      : item.cigarName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.text,
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  'x${item.quantity}',
                  style: const TextStyle(
                    color: AppColors.goldLight,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 7,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: completed
                        ? const Color(0x26D4AF37)
                        : const Color(0x261890FF),
                    borderRadius: BorderRadius.circular(4),
                    border: Border.all(
                      color: completed
                          ? const Color(0x66D4AF37)
                          : const Color(0x661890FF),
                    ),
                  ),
                  child: Text(
                    completed ? 'Completed' : 'Pending',
                    style: TextStyle(
                      color: completed
                          ? AppColors.goldLight
                          : const Color(0xFF1890FF),
                      fontSize: 10,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.icon, required this.message});

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 52),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: const Color(0x1AFFFFFF), size: 38),
          const SizedBox(height: 12),
          Text(message, style: const TextStyle(color: Color(0x40FFFFFF))),
        ],
      ),
    ),
  );
}
