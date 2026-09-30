import 'package:flutter/services.dart';

abstract final class AdminNavigationService {
  static const _channel = MethodChannel('com.macanudosocials.app/navigation');

  static Future<void> openAdminPortal() =>
      _channel.invokeMethod<void>('openAdminPortal');
}
