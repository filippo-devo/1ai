import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Licznik powtórzeń' }} />
        <Stack.Screen name="workout" options={{ title: 'Trening' }} />
        <Stack.Screen name="summary" options={{ title: 'Podsumowanie', headerBackVisible: false }} />
      </Stack>
    </>
  );
}
