/**
 * VendorBillModal.tsx
 * "Other" on Daily Collection: record an amount owed to a vendor that is not a product
 * purchase (transport, crates, commission...). It raises that vendor's dues and appears in
 * his ledger and the Home transaction log; it never changes stock or the purchase totals.
 * Paying it off uses the normal vendor payment. Data: POST /api/inventory/vendor-bills.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TranslationKey } from '../../i18n';

const palette = {
  navy: '#0F172A', slate: '#334155', muted: '#64748B', border: '#E2E8F0', panel: '#FFFFFF',
  brand: '#4F46E5', brandBg: '#EEF2FF', red: '#DC2626', overlay: 'rgba(15,23,42,0.5)',
};

type Props = {
  visible: boolean;
  onClose: () => void;
  ownerId: number;
  /** Existing vendor names, offered as quick picks. */
  vendorNames: string[];
  /** YYYY-MM-DD the bill is dated (the day selected on Daily Collection). */
  date: string;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  onSaved: () => void;
};

export default function VendorBillModal({ visible, onClose, ownerId, vendorNames, date, apiFetch, t, onSaved }: Props) {
  const [vendor, setVendor] = useState('');
  // Vendor dropdown: pick an existing vendor, or switch to typing a new one.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newVendor, setNewVendor] = useState(false);
  const [search, setSearch] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setVendor('');
      setNewVendor(vendorNames.length === 0);
      setPickerOpen(false);
      setSearch('');
      setAmount('');
      setDescription('');
      setError('');
    }
  }, [visible]);

  const sortedNames = [...vendorNames].sort((a, b) => a.localeCompare(b));
  const filteredNames = search.trim()
    ? sortedNames.filter(n => n.toLowerCase().includes(search.trim().toLowerCase()))
    : sortedNames;

  async function save() {
    const value = Number(amount.replace(',', '.'));
    if (!vendor.trim()) return setError(t('vbill_needVendor'));
    if (!Number.isFinite(value) || value <= 0) return setError(t('vbill_needAmount'));
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/api/inventory/vendor-bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, vendorName: vendor.trim(), amount: value, description: description.trim(), date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t('common_networkError'));
        return;
      }
      onSaved();
      onClose();
      Alert.alert(t('vbill_savedTitle'), t('vbill_savedMsg', { amount: value.toLocaleString('en-IN'), vendor: data.transaction?.note || vendor.trim() }));
    } catch {
      setError(t('common_networkError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>📝 {t('vbill_title')}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('txlog_close')}>
              <Text style={{ fontSize: 18, color: palette.muted }}>✕</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.hint}>{t('vbill_hint')}</Text>

            <Text style={styles.label}>{t('vbill_vendor')} *</Text>
            {newVendor ? (
              <>
                <TextInput value={vendor} onChangeText={setVendor} placeholder={t('vbill_newVendorPh')} placeholderTextColor={palette.muted}
                  style={styles.input} autoFocus accessibilityLabel={t('vbill_vendor')} />
                {vendorNames.length > 0 && (
                  <Pressable onPress={() => { setNewVendor(false); setVendor(''); }} hitSlop={6} accessibilityRole="button">
                    <Text style={styles.linkText}>{t('vbill_pickExisting')}</Text>
                  </Pressable>
                )}
              </>
            ) : (
              <>
                <Pressable
                  onPress={() => setPickerOpen(o => !o)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('vbill_vendor')}: ${vendor || t('vbill_selectVendor')}`}
                  accessibilityState={{ expanded: pickerOpen }}
                  style={[styles.input, styles.select, pickerOpen && { borderColor: palette.brand }]}>
                  <Text style={[styles.selectText, !vendor && { color: palette.muted }]} numberOfLines={1}>
                    {vendor || t('vbill_selectVendor')}
                  </Text>
                  <Text style={{ color: palette.muted }}>{pickerOpen ? '▴' : '▾'}</Text>
                </Pressable>
                {pickerOpen && (
                  <View style={styles.dropdown}>
                    {vendorNames.length > 6 && (
                      <TextInput value={search} onChangeText={setSearch} placeholder={t('vbill_searchVendor')} placeholderTextColor={palette.muted}
                        style={styles.search} accessibilityLabel={t('vbill_searchVendor')} />
                    )}
                    <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {filteredNames.map(name => (
                        <Pressable
                          key={name}
                          onPress={() => { setVendor(name); setPickerOpen(false); setSearch(''); }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: name === vendor }}
                          style={[styles.option, name === vendor && { backgroundColor: palette.brandBg }]}>
                          <Text style={[styles.optionText, name === vendor && { color: palette.brand, fontWeight: '800' }]} numberOfLines={1}>{name}</Text>
                        </Pressable>
                      ))}
                      {filteredNames.length === 0 && <Text style={styles.noMatch}>{t('vbill_noMatch')}</Text>}
                    </ScrollView>
                    <Pressable
                      onPress={() => { setNewVendor(true); setPickerOpen(false); setVendor(search.trim()); }}
                      accessibilityRole="button"
                      style={[styles.option, styles.newOption]}>
                      <Text style={styles.linkText}>+ {t('vbill_newVendor')}</Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}

            <Text style={styles.label}>{t('vbill_amount')} *</Text>
            <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="₹" placeholderTextColor={palette.muted}
              style={styles.input} accessibilityLabel={t('vbill_amount')} />

            <Text style={styles.label}>{t('vbill_description')}</Text>
            <TextInput value={description} onChangeText={setDescription} placeholder={t('vbill_descriptionPh')} placeholderTextColor={palette.muted}
              style={styles.input} maxLength={150} accessibilityLabel={t('vbill_description')} />

            {!!error && <Text style={styles.error}>{error}</Text>}
            <Pressable onPress={save} disabled={saving} style={[styles.submit, saving && { opacity: 0.6 }]} accessibilityRole="button">
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{t('vbill_save')}</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: palette.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '90%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontSize: 17, fontWeight: '800', color: palette.navy },
  hint: { fontSize: 12, color: palette.muted, marginBottom: 10 },
  label: { fontSize: 12, fontWeight: '700', color: palette.slate, marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 12, minHeight: 46, fontSize: 15, color: palette.navy },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectText: { flex: 1, fontSize: 15, color: palette.navy, marginRight: 8 },
  dropdown: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, marginTop: 6, overflow: 'hidden', backgroundColor: palette.panel },
  search: { borderBottomWidth: 1, borderBottomColor: palette.border, paddingHorizontal: 12, minHeight: 42, fontSize: 14, color: palette.navy },
  option: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: palette.border },
  optionText: { fontSize: 14, color: palette.navy },
  newOption: { borderBottomWidth: 0, backgroundColor: '#F8FAFC' },
  noMatch: { fontSize: 12, color: palette.muted, padding: 12 },
  linkText: { fontSize: 13, color: palette.brand, fontWeight: '700', marginTop: 8 },
  error: { color: palette.red, fontSize: 12, marginTop: 10 },
  submit: { backgroundColor: palette.brand, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 16, marginBottom: 8 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
