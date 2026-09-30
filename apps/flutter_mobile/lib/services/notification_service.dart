import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _channel = AndroidNotificationChannel(
  'macanudo_default',
  'Macanudo Socials',
  description: 'Events, announcements and membership reminders',
  importance: Importance.max,
  playSound: true,
  enableVibration: true,
);

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

class NotificationService {
  NotificationService._();
  static final instance = NotificationService._();

  final _local = FlutterLocalNotificationsPlugin();

  Future<void> initialize() async {
    const initialization = InitializationSettings(
      android: AndroidInitializationSettings('notification_badge'),
    );
    await _local.initialize(settings: initialization);
    await _local
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.createNotificationChannel(_channel);

    FirebaseMessaging.onMessage.listen((message) {
      final notification = message.notification;
      if (notification == null) return;
      _local.show(
        id: notification.hashCode,
        title: notification.title ?? 'Macanudo Socials',
        body: notification.body ?? '',
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails(
            'macanudo_default',
            'Macanudo Socials',
            channelDescription:
                'Events, announcements and membership reminders',
            importance: Importance.max,
            priority: Priority.high,
            icon: 'notification_badge',
            color: Color(0xFFD6A63C),
          ),
        ),
      );
    });
  }

  Future<bool> permissionGranted() async {
    final settings = await FirebaseMessaging.instance.getNotificationSettings();
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  Future<void> register(User user) async {
    final settings = await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (settings.authorizationStatus != AuthorizationStatus.authorized &&
        settings.authorizationStatus != AuthorizationStatus.provisional) {
      throw StateError('Notification permission was not granted.');
    }
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null || token.isEmpty) {
      throw StateError('This device did not return an FCM token.');
    }

    final preferences = await SharedPreferences.getInstance();
    var deviceId = preferences.getString('macanudo-flutter-device-id');
    if (deviceId == null) {
      deviceId = 'flutter-${DateTime.now().millisecondsSinceEpoch}';
      await preferences.setString('macanudo-flutter-device-id', deviceId);
    }
    await FirebaseFirestore.instance
        .doc('users/${user.uid}/fcmTokens/$deviceId')
        .set({
          'token': token,
          'deviceId': deviceId,
          'active': true,
          'provider': 'fcm',
          'platform': Platform.isAndroid ? 'android' : 'ios',
          'device': 'native',
          'lastUsed': FieldValue.serverTimestamp(),
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
  }

  Future<void> disable(User user) async {
    final preferences = await SharedPreferences.getInstance();
    final deviceId = preferences.getString('macanudo-flutter-device-id');
    if (deviceId == null) return;
    await FirebaseFirestore.instance
        .doc('users/${user.uid}/fcmTokens/$deviceId')
        .set({
          'active': false,
          'updatedAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));
  }
}
