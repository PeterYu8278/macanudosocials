import 'package:flutter/material.dart';

abstract final class AppColors {
  static const background = Color(0xFF0A0A0A);
  static const surface = Color(0xFF1A1A1A);
  static const surfaceRaised = Color(0xFF2D2D2D);
  static const border = Color(0xFF6F5712);
  static const gold = Color(0xFFFFD700);
  static const goldLight = Color(0xFFFDE08D);
  static const goldDeep = Color(0xFFC48D3A);
  static const text = Color(0xFFF8F8F8);
  static const muted = Color(0xFFC0C0C0);
  static const subtle = Color(0xFF999999);
  static const success = Color(0xFF52C41A);
  static const danger = Color(0xFFFF4D4F);
}

ThemeData buildAppTheme() => ThemeData(
  brightness: Brightness.dark,
  scaffoldBackgroundColor: AppColors.background,
  colorScheme: const ColorScheme.dark(
    primary: AppColors.gold,
    surface: AppColors.surface,
    error: AppColors.danger,
  ),
  fontFamily: 'Roboto',
  textTheme: const TextTheme(
    headlineSmall: TextStyle(
      color: AppColors.goldLight,
      fontWeight: FontWeight.w800,
    ),
    titleLarge: TextStyle(color: AppColors.text, fontWeight: FontWeight.w700),
    bodyMedium: TextStyle(color: AppColors.muted),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: AppColors.surfaceRaised,
    hintStyle: const TextStyle(color: AppColors.subtle),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8),
      borderSide: const BorderSide(color: AppColors.border),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8),
      borderSide: const BorderSide(color: AppColors.border),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8),
      borderSide: const BorderSide(color: AppColors.gold),
    ),
  ),
);
