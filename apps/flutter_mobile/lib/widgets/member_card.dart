import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../models/member_profile.dart';
import '../theme/app_theme.dart';

class MemberCard extends StatefulWidget {
  const MemberCard({super.key, required this.member});

  final MemberProfile member;

  @override
  State<MemberCard> createState() => _MemberCardState();
}

class _MemberCardState extends State<MemberCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _flip;

  String get _referralUrl =>
      'https://macanudosocials.com/register?ref=${widget.member.memberId}';

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _flip = CurvedAnimation(
      parent: _controller,
      curve: const Cubic(0.4, 0, 0.2, 1),
    );
  }

  void _toggleCard() {
    if (_controller.isAnimating) return;
    if (_controller.value < 0.5) {
      _controller.forward();
    } else {
      _controller.reverse();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _showQrCode() {
    showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: const Color(0xFF1A1612),
        shape: RoundedRectangleBorder(
          side: const BorderSide(color: Color(0x667D5F0A)),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Member QR Code',
                style: TextStyle(
                  color: AppColors.goldLight,
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 18),
              Container(
                width: 210,
                height: 210,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: QrImageView(
                  data: _referralUrl,
                  padding: EdgeInsets.zero,
                ),
              ),
              const SizedBox(height: 14),
              Text(
                widget.member.memberId,
                style: const TextStyle(
                  color: AppColors.text,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 2,
                ),
              ),
              const SizedBox(height: 5),
              const Text(
                'Scan to join Macanudo Socials',
                style: TextStyle(color: AppColors.muted, fontSize: 12),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => GestureDetector(
    behavior: HitTestBehavior.opaque,
    onTap: _toggleCard,
    onHorizontalDragEnd: (details) {
      if ((details.primaryVelocity ?? 0).abs() > 120) _toggleCard();
    },
    child: AnimatedBuilder(
      animation: _flip,
      builder: (context, _) {
        final angle = _flip.value * math.pi;
        final showBack = angle >= math.pi / 2;
        return Transform(
          alignment: Alignment.center,
          transform: Matrix4.identity()
            ..setEntry(3, 2, 0.0012)
            ..rotateY(angle),
          child: showBack
              ? Transform(
                  alignment: Alignment.center,
                  transform: Matrix4.identity()..rotateY(math.pi),
                  child: _buildBack(),
                )
              : _buildFront(),
        );
      },
    ),
  );

  Widget _buildFront() => AspectRatio(
    aspectRatio: 85.6 / 54,
    child: Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0x40D4AF37)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x66000000),
            blurRadius: 20,
            offset: Offset(0, 10),
          ),
          BoxShadow(color: Color(0x1FD4AF37), blurRadius: 18),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: CustomPaint(
        painter: _MemberCardPainter(),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _GoldText('Macanudo Socials', size: 22),
                        SizedBox(height: 4),
                        Text(
                          'CIGAR World',
                          style: TextStyle(
                            color: AppColors.goldDeep,
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 2,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Semantics(
                    button: true,
                    label: 'Open member QR code',
                    child: GestureDetector(
                      onTap: _showQrCode,
                      child: Container(
                        width: 54,
                        height: 54,
                        padding: const EdgeInsets.all(5),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(7),
                        ),
                        child: QrImageView(
                          data: _referralUrl,
                          padding: EdgeInsets.zero,
                          eyeStyle: const QrEyeStyle(
                            color: Colors.black,
                            eyeShape: QrEyeShape.square,
                          ),
                          dataModuleStyle: const QrDataModuleStyle(
                            color: Colors.black,
                            dataModuleShape: QrDataModuleShape.square,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const Spacer(),
              Row(
                children: [
                  _Avatar(member: widget.member),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.member.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: AppColors.text,
                            fontSize: 20,
                            fontWeight: FontWeight.w800,
                            height: 1.05,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          _titleCase(widget.member.role),
                          style: const TextStyle(
                            color: AppColors.goldDeep,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        widget.member.memberId,
                        style: const TextStyle(
                          color: AppColors.text,
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 2,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _formatPoints(widget.member.points),
                        style: const TextStyle(
                          color: AppColors.goldDeep,
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        widget.member.isActive ? 'Active' : 'Not Activated',
                        style: TextStyle(
                          color: widget.member.isActive
                              ? AppColors.success
                              : AppColors.subtle,
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    ),
  );

  Widget _buildBack() => AspectRatio(
    aspectRatio: 85.6 / 54,
    child: Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0x66D4AF37)),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1A1A1A), Color(0xFF0A0A0A)],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x66000000),
            blurRadius: 20,
            offset: Offset(0, 10),
          ),
          BoxShadow(color: Color(0x33D4AF37), blurRadius: 24),
        ],
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          CustomPaint(painter: _MemberCardPainter(), size: Size.infinite),
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Transform.scale(
                scale: 1.75,
                child: _Avatar(member: widget.member),
              ),
              const SizedBox(height: 26),
              Text(
                widget.member.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: AppColors.text,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 5),
              const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.touch_app_outlined,
                    color: AppColors.goldDeep,
                    size: 14,
                  ),
                  SizedBox(width: 5),
                  Text(
                    'Tap or swipe to view member card',
                    style: TextStyle(color: AppColors.muted, fontSize: 10),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ),
  );
}

class _Avatar extends StatelessWidget {
  const _Avatar({required this.member});

  final MemberProfile member;

  @override
  Widget build(BuildContext context) => Container(
    width: 56,
    height: 56,
    padding: const EdgeInsets.all(2),
    decoration: const BoxDecoration(
      shape: BoxShape.circle,
      gradient: LinearGradient(
        colors: [AppColors.goldLight, AppColors.goldDeep],
      ),
    ),
    child: ClipOval(
      child: ColoredBox(
        color: const Color(0xFF1B1811),
        child: member.avatarUrl.isEmpty
            ? Center(
                child: Text(
                  member.name.characters.first.toUpperCase(),
                  style: const TextStyle(
                    color: AppColors.goldLight,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              )
            : Image.network(
                member.avatarUrl,
                fit: BoxFit.cover,
                errorBuilder: (_, error, stackTrace) => Center(
                  child: Text(
                    member.name.characters.first.toUpperCase(),
                    style: const TextStyle(
                      color: AppColors.goldLight,
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
      ),
    ),
  );
}

class _MemberCardPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final background = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [Color(0xFF1A1A1A), Color(0xFF0A0A0A)],
      ).createShader(rect);
    canvas.drawRect(rect, background);

    final glow = Paint()
      ..shader = const RadialGradient(
        center: Alignment(-0.75, -0.8),
        radius: 1.1,
        colors: [Color(0x22D4AF37), Color(0x00000000)],
      ).createShader(rect);
    canvas.drawRect(rect, glow);

    final pattern = Paint()..color = const Color(0x0DD4AF37);
    canvas.save();
    canvas.rotate(math.pi / 4);
    for (double y = -size.width; y < size.height * 1.5; y += 14) {
      for (double x = -size.height; x < size.width * 1.5; x += 14) {
        canvas.drawRect(Rect.fromLTWH(x, y, 6, 6), pattern);
      }
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _GoldText extends StatelessWidget {
  const _GoldText(this.text, {required this.size});

  final String text;
  final double size;

  @override
  Widget build(BuildContext context) => ShaderMask(
    blendMode: BlendMode.srcIn,
    shaderCallback: (bounds) =>
        const LinearGradient(colors: [Color(0xFFF0E68C), Color(0xFFD4AF37)])
            .createShader(bounds),
    child: Text(
      text,
      style: TextStyle(
        fontSize: size,
        fontWeight: FontWeight.w900,
        height: 1.05,
      ),
    ),
  );
}

String _titleCase(String value) {
  if (value.isEmpty) return 'Member';
  return '${value[0].toUpperCase()}${value.substring(1)}';
}

String _formatPoints(num value) {
  if (value % 1 == 0) return value.toInt().toString();
  return value.toStringAsFixed(1);
}
