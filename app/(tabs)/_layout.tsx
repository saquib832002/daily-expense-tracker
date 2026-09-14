import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';

import { t, useLanguage } from '@/i18n';
import { useTheme } from '@/theme';

/** Emoji stand in for icons until the icon set lands in Phase 2. */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const theme = useTheme();
  // The tab bar mounts once and sits above every screen, so nothing else ever
  // re-renders it. Without this subscription the five tab labels keep the
  // language the app launched in no matter what the user picks.
  useLanguage();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textDim,
        tabBarStyle: {
          backgroundColor: theme.surface,
          borderTopColor: theme.border,
        },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.home'),
          tabBarIcon: ({ color }) => <TabIcon glyph="🏠" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('tab.history'),
          tabBarIcon: ({ color }) => <TabIcon glyph="🧾" color={color} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: t('tab.add'),
          tabBarIcon: ({ color }) => <TabIcon glyph="➕" color={color} />,
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: t('tab.budget'),
          tabBarIcon: ({ color }) => <TabIcon glyph="🎯" color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t('tab.more'),
          tabBarIcon: ({ color }) => <TabIcon glyph="⋯" color={color} />,
        }}
      />
    </Tabs>
  );
}
