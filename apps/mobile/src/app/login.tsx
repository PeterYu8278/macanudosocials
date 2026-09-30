import { Image } from 'expo-image';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { GoldButton } from '@/components/gold-button';
import { Screen } from '@/components/screen';
import { useSession } from '@/providers/session-provider';
import { colors, radius, spacing } from '@/theme/tokens';

export default function LoginScreen() {
  const { user, signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Redirect href="/(tabs)" />;

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing details', 'Enter your email and password.');
      return;
    }
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (error) {
      Alert.alert('Unable to sign in', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen scroll={false} contentStyle={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <View style={styles.brand}>
          <Image source={require('@/assets/images/app-logo-512.png')} contentFit="contain" style={styles.logo} />
          <Text style={styles.title}>Macanudo Socials</Text>
          <Text style={styles.subtitle}>Member access</Text>
        </View>
        <View style={styles.form}>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={email}
          />
          <TextInput
            autoComplete="current-password"
            onChangeText={setPassword}
            onSubmitEditing={handleLogin}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            style={styles.input}
            value={password}
          />
          <GoldButton label="Sign In" loading={submitting} onPress={handleLogin} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  keyboard: { gap: spacing.xl },
  brand: { alignItems: 'center', gap: spacing.sm },
  logo: { width: 116, height: 116 },
  title: { color: colors.goldLight, fontSize: 30, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 15 },
  form: { gap: spacing.md },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
  },
});
