import { Redirect, Tabs } from 'expo-router';
import { CalendarDays, Home, UserRound } from 'lucide-react-native';

import { useSession } from '@/providers/session-provider';
import { colors } from '@/theme/tokens';

export default function TabsLayout() {
  const { loading, user } = useSession();
  if (!loading && !user) return <Redirect href="/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.goldLight,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: 8,
          height: 64,
          paddingTop: 6,
          paddingBottom: 7,
          backgroundColor: '#111217',
          borderTopColor: colors.border,
          borderTopWidth: 1,
          borderWidth: 1,
          borderColor: '#4b3b0b',
          borderRadius: 28,
          elevation: 12,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <Home color={color} size={21} /> }} />
      <Tabs.Screen name="events" options={{ title: 'Events', tabBarIcon: ({ color }) => <CalendarDays color={color} size={21} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <UserRound color={color} size={21} /> }} />
    </Tabs>
  );
}
