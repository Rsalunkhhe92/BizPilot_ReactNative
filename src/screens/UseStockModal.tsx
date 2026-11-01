/**
 * UseStockModal.tsx
 * Records how much of a purchased product was used ("30 kg bought, 20 kg used today"), so the
 * stock shows what really remains. Data: POST/GET/DELETE /api/inventory/usage. Entries can be
 * undone. Usage the day's recipe sales already took from stock is not deducted a second time.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TranslationKey } from '../../i18n';

const palette = {
  navy: '#0F172A', slate: '#334155', muted: '#64748B', border: '#E2E8F0', panel: '#FFFFFF', page: '#F8FAFC',
  brand: '#4F46E5', brandBg: '#EEF2FF', red: '#DC2626', overlay: 'rgba(15,23,42,0.5)',
};

// Same sizes as UNIT_SIZES in the backend, for the units the app offers.
const UNIT_FAMILIES: string[][] = [['kg', 'gram'], ['litre', 'ml'], ['piece', 'dozen']];
const UNIT_SIZE: Record<string, number> = { kg: 1000, gram: 1, litre: 1000, ml: 1, piece: 1, dozen: 12 };

type Props = {
  visible: boolean;
  onClose: () => void;
  ownerId: number;
  product: { id: string; name: string; unit: string; stockQty: number } | null;
  /** YYYY-MM-DD for today. */
  today: string;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  onSaved: () => void;
};

const tidy = (value: number) => String(Math.round(value * 10000) / 10000);

export default function UseStockModal({ visible, onClose, ownerId, product, today, apiFetch, t, onSaved }: Props) {
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('');
  const [note, setNote] = useState('');
  const [entries, setEntries] = useState<any[] | null>(null);
  const [stockQty, setStockQty] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadEntries = useCallback(async () => {
    if (!product) return;
    try {
      const res = await apiFetch(`/api/inventory/usage?owner_id=${ownerId}&product_id=${product.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEntries(data.entries || []);
    } catch {
      setError(t('common_networkError'));
      setEntries([]);
    }
  }, [apiFetch, ownerId, product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!visible || !product) return;
    setQuantity('');
    setNote('');
    setError('');
    setUnit(product.unit);
    setStockQty(product.stockQty);
    setEntries(null);
    loadEntries();
  }, [visible, product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const stockUnit = product?.unit || '';
  const family = UNIT_FAMILIES.find(units => units.includes(stockUnit.trim().toLowerCase())) || [stockUnit];
  const from = UNIT_SIZE[unit.toLowerCase()];
  const to = UNIT_SIZE[stockUnit.toLowerCase()];
  const entered = Number(quantity) || 0;
  const inStockUnit = from && to ? entered * from / to : entered;

  const save = async () => {
    if (!product || saving) return;
    if (!(entered > 0)) {
      setError(t('use_needQuantity'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/inventory/usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, productId: product.id, quantity: entered, unit, note: note.trim(), date: today }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t('common_networkError'));
        return;
      }
      setStockQty(data.stockQty);
      setQuantity('');
      setNote('');
      await loadEntries();
      onSaved();
    } catch {
      setError(t('common_networkError'));
    } finally {
      setSaving(false);
    }
  };

  const undo = (entry: any) => {
    const run = async () => {
      try {
        const res = await apiFetch(`/api/inventory/usage/${entry.id}?owner_id=${ownerId}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error);
        setStockQty(data.stockQty);
        await loadEntries();
        onSaved();
      } catch {
        setError(t('common_networkError'));
      }
    };
    const message = t('use_undoConfirm', { qty: tidy(entry.quantity), unit: stockUnit, product: product?.name || '' });
    if (Platform.OS === 'web') {
      // Alert.alert does nothing on react-native-web.
      if ((globalThis as any).confirm?.(message)) run();
      return;
    }
    Alert.alert(t('use_undoTitle'), message, [
      { text: t('common_cancel'), style: 'cancel' },
      { text: t('use_undo'), style: 'destructive', onPress: run },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>➖ {t('use_title', { product: product?.name || '' })}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common_close')}>
              <Text style={{ fontSize: 18, color: palette.muted }}>✕</Text>
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
            <View style={styles.summary}>
              <Text style={{ fontSize: 13, color: palette.slate }}>{t('use_inStock')}: <Text style={{ fontWeight: '800', color: palette.navy }}>{tidy(stockQty)} {stockUnit}</Text></Text>
              {entered > 0 && (
                <Text style={{ fontSize: 13, color: palette.slate }}>{t('use_remaining')}: <Text style={{ fontWeight: '800', color: inStockUnit > stockQty ? palette.red : palette.navy }}>{tidy(stockQty - inStockUnit)} {stockUnit}</Text></Text>
              )}
            </View>
            <Text style={styles.label}>{t('use_quantity')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <TextInput accessibilityLabel={t('use_quantity')} keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity} style={[styles.input, { flex: 1 }]} />
              {family.map(option => {
                const selected = unit.toLowerCase() === option.toLowerCase();
                return (
                  <Pressable key={option} onPress={() => setUnit(option)} accessibilityRole="radio" accessibilityState={{ selected }}
                    style={[styles.unit, selected && { borderColor: palette.brand, backgroundColor: palette.brandBg }]}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: selected ? palette.brand : palette.slate }}>{option}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.label}>{t('use_note')}</Text>
            <TextInput accessibilityLabel={t('use_note')} placeholder={t('use_notePlaceholder')} placeholderTextColor={palette.muted} value={note} onChangeText={setNote} maxLength={200} style={[styles.input, { marginBottom: 10 }]} />
            {!!error && <Text style={{ color: palette.red, fontWeight: '600', marginBottom: 8 }} accessibilityLiveRegion="polite">{error}</Text>}
            <Pressable onPress={save} disabled={saving} accessibilityRole="button" style={[styles.save, saving && { opacity: 0.6 }]}>
              <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 15 }}>{saving ? t('common_saving') : t('use_save')}</Text>
            </Pressable>

            <Text style={[styles.label, { marginTop: 14 }]}>{t('use_history')}</Text>
            {entries === null && <ActivityIndicator color={palette.brand} style={{ padding: 12 }} />}
            {entries !== null && !entries.length && <Text style={{ fontSize: 13, color: palette.muted, paddingVertical: 8 }}>{t('use_empty')}</Text>}
            {(entries || []).map(entry => (
              <View key={entry.id} style={styles.entry}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: palette.navy }}>{tidy(entry.quantity)} {stockUnit}</Text>
                  <Text style={{ fontSize: 11, color: palette.muted, marginTop: 1 }} numberOfLines={1}>{entry.date}{entry.note ? ` · ${entry.note}` : ''}</Text>
                </View>
                <Pressable onPress={() => undo(entry)} accessibilityRole="button" accessibilityLabel={`${t('use_undo')} ${tidy(entry.quantity)} ${stockUnit}`} style={styles.undo}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: palette.red }}>{t('use_undo')}</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: palette.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '92%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 },
  title: { flex: 1, fontSize: 17, fontWeight: '800', color: palette.navy },
  summary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, backgroundColor: palette.page, borderRadius: 10, padding: 10, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: '700', color: palette.slate, marginBottom: 6 },
  input: { minHeight: 44, borderWidth: 1, borderColor: palette.border, borderRadius: 9, paddingHorizontal: 10, color: palette.navy, fontSize: 14, minWidth: 0 },
  unit: { minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border, borderRadius: 9 },
  save: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.brand },
  entry: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: palette.border },
  undo: { minHeight: 40, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
});
