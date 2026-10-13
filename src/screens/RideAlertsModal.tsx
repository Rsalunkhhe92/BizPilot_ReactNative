/**
 * RideAlertsModal.tsx
 * Capture screen for ride-hailing app notifications (Rapido, Ola, Uber).
 *
 * Lists the raw notifications those apps post on this phone, exactly as received, so their
 * wording can be studied before any matching rules are written. Read-only: nothing here
 * accepts, rejects or answers a ride.
 */

import React, { useEffect, useState } from 'react';
import { Alert, AppState, Modal, PermissionsAndroid, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { TranslationKey } from '../../i18n';
import {
  RideNotification,
  clearRideNotifications,
  isRideNotificationAccessGranted,
  isRideNotificationsAvailable,
  openRideNotificationAccessSettings,
  postTestRideNotification,
  readRideNotifications,
} from '../../modules/ride-notifications';

const REFRESH_MS = 5000;

interface Props {
  visible: boolean;
  onClose: () => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

function appLabel(packageName: string) {
  const lower = packageName.toLowerCase();
  if (lower.includes('(test)')) return 'Test';
  if (lower.includes('rapido')) return 'Rapido';
  if (lower.includes('olacabs')) return 'Ola';
  if (lower.includes('ubercab')) return 'Uber';
  return packageName;
}

export default function RideAlertsModal({ visible, onClose, t }: Props) {
  const [granted, setGranted] = useState(false);
  const [items, setItems] = useState<RideNotification[]>([]);

  async function refresh() {
    try {
      const access = await isRideNotificationAccessGranted();
      setGranted(access);
      setItems(access ? await readRideNotifications() : []);
    } catch (e) {
      console.error('Error reading ride notifications:', e);
    }
  }

  // Refresh while open, and when coming back from the Settings screen
  useEffect(() => {
    if (!visible || !isRideNotificationsAvailable) return;
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      appState.remove();
    };
  }, [visible]);

  // Posts a real notification from this app; if capture is working it shows up in the list
  // below within a few seconds, exactly as a ride app's alert would.
  async function handleSendTest() {
    try {
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert(t('common_error'), t('ride_testNeedsPermission'));
          return;
        }
      }
      await postTestRideNotification('Rapido (test): New ride request', 'Pickup: MG Road, 1.2 km away. Drop: Railway Station. Fare ₹85');
      setTimeout(refresh, 1500);
    } catch (e) {
      console.error('Error sending test ride alert:', e);
      Alert.alert(t('common_error'), t('ride_testFailed'));
    }
  }

  function handleShare() {
    const lines = items.map(
      n => `[${new Date(n.date).toLocaleString()}] ${n.packageName}\nTitle: ${n.title}\nText: ${n.text}${n.actions ? `\nButtons: ${n.actions}` : ''}`,
    );
    Share.share({ message: lines.join('\n\n') }).catch(() => {});
  }

  function handleClear() {
    Alert.alert(t('ride_clearTitle'), t('ride_clearConfirm'), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('common_delete'),
        style: 'destructive',
        onPress: async () => {
          await clearRideNotifications();
          refresh();
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <Text style={styles.heading}>🚖 {t('ride_title')}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          {!isRideNotificationsAvailable ? (
            <Text style={styles.hint}>{t('ride_needsBuild')}</Text>
          ) : !granted ? (
            <>
              <Text style={styles.hint}>{t('ride_accessHint')}</Text>
              <Pressable onPress={() => openRideNotificationAccessSettings()} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>{t('ride_openSettings')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.hint}>{t('ride_listHint', { count: items.length })}</Text>
              <Pressable onPress={handleSendTest} style={[styles.primaryBtn, { marginTop: 10 }]}>
                <Text style={styles.primaryBtnText}>{t('ride_sendTest')}</Text>
              </Pressable>
              <View style={styles.btnRow}>
                <Pressable onPress={handleShare} disabled={items.length === 0} style={[styles.outlineBtn, items.length === 0 && { opacity: 0.5 }]}>
                  <Text style={styles.outlineBtnText}>{t('ride_share')}</Text>
                </Pressable>
                <Pressable onPress={handleClear} disabled={items.length === 0} style={[styles.outlineBtn, items.length === 0 && { opacity: 0.5 }]}>
                  <Text style={[styles.outlineBtnText, { color: palette.red }]}>{t('ride_clear')}</Text>
                </Pressable>
              </View>
              <ScrollView style={{ marginTop: 10 }} showsVerticalScrollIndicator={false}>
                {items.length === 0 && <Text style={[styles.hint, { textAlign: 'center', marginTop: 20 }]}>{t('ride_empty')}</Text>}
                {items.map(n => (
                  <View key={n.id} style={styles.item}>
                    <View style={styles.itemHeader}>
                      <Text style={styles.itemApp}>{appLabel(n.packageName)}</Text>
                      <Text style={styles.itemTime}>
                        {new Date(n.date).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </Text>
                    </View>
                    {!!n.title && <Text style={styles.itemTitle} selectable>{n.title}</Text>}
                    {!!n.text && <Text style={styles.itemText} selectable>{n.text}</Text>}
                    {!!n.actions && <Text style={styles.itemMeta} selectable>{t('ride_buttons', { buttons: n.actions })}</Text>}
                    <Text style={styles.itemMeta} selectable>{n.packageName}</Text>
                  </View>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// Mirrors the palette in App.tsx.
const palette = {
  brand: '#4F46E5',
  brandBg: '#EEF2FF',
  navy: '#0F172A',
  slate: '#334155',
  muted: '#64748B',
  border: '#E2E8F0',
  panel: '#FFFFFF',
  page: '#F8FAFC',
  red: '#DC2626',
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'flex-end' },
  content: { backgroundColor: palette.panel, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, maxHeight: '88%', minHeight: '45%' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  heading: { fontSize: 18, fontWeight: '800', color: palette.navy },
  close: { fontSize: 18, color: palette.muted, fontWeight: '700' },
  hint: { fontSize: 12, color: palette.muted, lineHeight: 17 },
  primaryBtn: { backgroundColor: palette.brand, borderRadius: 8, paddingVertical: 11, alignItems: 'center', marginTop: 14 },
  primaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  outlineBtn: { flex: 1, borderWidth: 1, borderColor: palette.border, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  outlineBtnText: { color: palette.brand, fontSize: 12, fontWeight: '700' },
  item: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, padding: 10, marginBottom: 8, backgroundColor: palette.page },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  itemApp: { fontSize: 11, fontWeight: '800', color: palette.brand },
  itemTime: { fontSize: 10, color: palette.muted },
  itemTitle: { fontSize: 13, fontWeight: '700', color: palette.navy },
  itemText: { fontSize: 12, color: palette.slate, marginTop: 2 },
  itemMeta: { fontSize: 10, color: palette.muted, marginTop: 4 },
});
