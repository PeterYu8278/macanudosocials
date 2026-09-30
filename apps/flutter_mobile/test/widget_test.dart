import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:macanudo_socials/theme/app_theme.dart';

void main() {
  testWidgets('Macanudo theme renders member access shell', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAppTheme(),
        home: const Scaffold(body: Center(child: Text('Macanudo Socials'))),
      ),
    );

    expect(find.text('Macanudo Socials'), findsOneWidget);
    expect(
      Theme.of(tester.element(find.text('Macanudo Socials')))
          .scaffoldBackgroundColor,
      AppColors.background,
    );
  });
}
