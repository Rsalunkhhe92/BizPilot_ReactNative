/**
 * TradePanel.tsx
 * The Purchases and Sales views inside the Products tab on product shops: the day's or month's
 * entries, and a multi-row form to record new ones. Every row is an ordinary entry
 * (POST /api/inventory/transactions), so stock, recipes, cost, vendor dues, customer credit and
 * Daily Collection update exactly as they do everywhere else.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TranslationKey } from '../../i18n';

const palette = {
  navy: '#0F172A', slate: '#334155', muted: '#64748B', border: '#E2E8F0', panel: '#FFFFFF', page: '#F8FAFC',
  brand: '#4F46E5', brandBg: '#EEF2FF', red: '#DC2626', redBg: '#FEF2F2', amber: '#B45309', amberBg: '#FFFBEB', green: '#047857', greenBg: '#ECFDF5',
};

type Mode = 'PURCHASE' | 'SALE';
type Payment = 'CASH' | 'UPI' | 'CREDIT';
type Product = { id: string; name: string; unit: string; stockQty: number; sellingPrice: number; costPrice: number; productType?: string; hasRecipe?: boolean };
// A purchase row is typed as a bill total; a sale row as a price per unit, which starts at the product's rate.
type Row = { key: string; productId: string; quantity: string; value: string };

type Props = {
  mode: Mode;
  ownerId: number;
  products: Product[];
  /** Vendor names when purchasing, customer names when selling. */
  partyNames: string[];
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  /** YYYY-MM-DD for today. */
  today: string;
  onChanged: () => void;
};

const rupees = (value: number) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const newRow = (): Row => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, productId: '', quantity: '', value: '' });

export default function TradePanel({ mode, ownerId, products, partyNames, apiFetch, t, today, onChanged }: Props) {
  const isSale = mode === 'SALE';
  const [period, setPeriod] = useState<'daily' | 'monthly'>('daily');
  const [entries, setEntries] = useState<any[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [party, setParty] = useState('');
  const [paid, setPaid] = useState(true);
  const [payment, setPayment] = useState<Payment>('CASH');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await apiFetch(`/api/inventory/transactions?owner_id=${ownerId}&period=${period}&date=${today}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEntries((data.transactions || []).filter((tx: any) => tx.type === mode));
    } catch {
      setLoadError(t('common_networkError'));
    }
  }, [apiFetch, ownerId, period, today, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const choices = useMemo(() => {
    const allowed = isSale
      ? products.filter(p => p.productType !== 'PURCHASE' && p.stockQty > 0)
      : products.filter(p => p.productType === 'PURCHASE');
    return [...allowed].sort((a, b) => a.name.localeCompare(b.name));
  }, [products, isSale]);

  const list = entries || [];
  const total = list.reduce((sum, tx) => sum + tx.amount, 0);
  const due = list.reduce((sum, tx) => sum + tx.amountDue, 0);
  const paidBy = (method: Payment) => list.filter(tx => tx.paymentMethod === method).reduce((sum, tx) => sum + tx.amount, 0);
  const lineTotal = (row: Row) => (isSale ? (Number(row.quantity) || 0) * (Number(row.value) || 0) : Number(row.value) || 0);
  const formTotal = rows.reduce((sum, row) => sum + lineTotal(row), 0);
  const update = (key: string, patch: Partial<Row>) => setRows(previous => previous.map(row => (row.key === key ? { ...row, ...patch } : row)));

  const validate = (filled: Row[]) => {
    if (!filled.length || filled.some(row => !(Number(row.quantity) > 0) || !(lineTotal(row) > 0))) return t(isSale ? 'stab_rowsProblem' : 'ptab_rowsProblem');
    if (isSale) {
      if (payment === 'CREDIT' && !party.trim()) return t('dc_missingCustomerName');
      const over = filled.map(row => products.find(p => p.id === row.productId)).find((p, i) => p && Number(filled[i].quantity) > p.stockQty);
      if (over) return t('stab_overStock', { product: over.name, qty: over.stockQty, unit: over.unit });
    }
    return '';
  };

  const save = async () => {
    if (saving) return;
    const filled = rows.filter(row => row.productId);
    const problem = validate(filled);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError('');
    const cartId = filled.length > 1 ? `${isSale ? 'cart' : 'purchase'}-${ownerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : null;
    let saved = 0;
    try {
      for (const row of filled) {
        const amount = Number(lineTotal(row).toFixed(2));
        const res = await apiFetch('/api/inventory/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerId, productId: row.productId, quantity: Number(row.quantity), amount, type: mode, date: today, cartId,
            ...(isSale
              ? { paymentMethod: payment, note: payment === 'CREDIT' ? party.trim() : '' }
              // Without a vendor there is no ledger to owe money in, so it counts as paid.
              : { paymentMethod: 'CASH', amountPaid: paid || !party.trim() ? amount : 0, note: party.trim() }),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || '');
        }
        saved += 1;
      }
      setRows([newRow()]);
      setParty('');
      setPaid(true);
      setPayment('CASH');
      setFormOpen(false);
    } catch (e: any) {
      // Rows already saved are real entries: keep only the ones that were not.
      setRows(filled.slice(saved));
      setError([saved > 0 ? t('ptab_partial', { saved, remaining: filled.length - saved }) : '', e?.message || (saved > 0 ? '' : t('common_networkError'))].filter(Boolean).join('\n'));
    } finally {
      setSaving(false);
      if (saved > 0) {
        load();
        onChanged();
      }
    }
  };

  const removeEntry = (tx: any) => {
    const run = async () => {
      try {
        const res = await apiFetch(`/api/inventory/transactions/${tx.id}?owner_id=${ownerId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('failed');
        load();
        onChanged();
      } catch {
        setLoadError(t('common_networkError'));
      }
    };
    const vars = { product: tx.productName, qty: tx.quantity, unit: tx.unit };
    const message = t(isSale ? 'stab_deleteConfirm' : 'ptab_deleteConfirm', vars);
    if (Platform.OS === 'web') {
      // Alert.alert does nothing on react-native-web.
      if ((globalThis as any).confirm?.(message)) run();
      return;
    }
    Alert.alert(t(isSale ? 'stab_deleteTitle' : 'ptab_deleteTitle'), message, [
      { text: t('common_cancel'), style: 'cancel' },
      { text: t('common_delete'), style: 'destructive', onPress: run },
    ]);
  };

  const newLabel = t(isSale ? 'stab_new' : 'ptab_new');

  return (
    <View>
      <Pressable onPress={() => { setFormOpen(open => !open); setError(''); }} accessibilityRole="button" style={styles.primary}>
        <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 14 }}>{formOpen ? t('common_close') : `＋ ${newLabel}`}</Text>
      </Pressable>

      {formOpen && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{isSale ? '💰' : '📥'} {newLabel}</Text>
          {!choices.length && <Text style={[styles.muted, { marginBottom: 8 }]}>{t(isSale ? 'stab_nothingToSell' : 'dc_addProductFirst')}</Text>}
          {rows.map((row, index) => {
            const product = products.find(p => p.id === row.productId);
            const open = pickerFor === row.key;
            const term = search.trim().toLowerCase();
            const taken = rows.filter(other => other.key !== row.key).map(other => other.productId);
            const stockText = (p: Product) => (p.hasRecipe ? t('rcp_canMake', { count: p.stockQty }) : `${p.stockQty} ${p.unit}`);
            return (
              <View key={row.key} style={styles.row}>
                <Pressable onPress={() => { setPickerFor(open ? null : row.key); setSearch(''); }} accessibilityRole="button"
                  accessibilityLabel={`${t('inv_product')} ${index + 1}: ${product?.name || t('dc_selectProduct')}`} style={styles.picker}>
                  <Text style={{ flex: 1, fontSize: 14, color: product ? palette.navy : palette.muted }} numberOfLines={1}>
                    {product ? `${product.name} (${stockText(product)})` : t('dc_selectProduct')}
                  </Text>
                  <Text style={{ color: palette.brand }}>{open ? '▲' : '▼'}</Text>
                </Pressable>
                {open && (
                  <View style={styles.pickerList}>
                    <TextInput accessibilityLabel={t('inv_searchProducts')} placeholder={t('inv_searchProducts')} placeholderTextColor={palette.muted} value={search} onChangeText={setSearch} style={styles.pickerSearch} />
                    <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {choices.filter(p => !taken.includes(p.id) && (!term || p.name.toLowerCase().includes(term))).map(p => (
                        <Pressable key={p.id} accessibilityRole="button" style={styles.option} onPress={() => {
                          update(row.key, { productId: p.id, ...(isSale ? { value: p.sellingPrice > 0 ? String(p.sellingPrice) : '' } : {}) });
                          setPickerFor(null);
                        }}>
                          <Text style={{ fontSize: 14, color: palette.navy }}>{p.productType === 'PURCHASE' ? '🛒' : '🛍️'} {p.name} <Text style={{ color: palette.muted, fontSize: 12 }}>({stockText(p)})</Text></Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                )}
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.label} numberOfLines={1}>{t('stab_quantity')}{product ? ` (${product.unit})` : ''}</Text>
                    <TextInput accessibilityLabel={`${t('stab_quantity')} ${index + 1}`} keyboardType="decimal-pad" value={row.quantity} onChangeText={value => update(row.key, { quantity: value })} style={styles.input} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.label} numberOfLines={1}>{t(isSale ? 'stab_price' : 'dc_totalCost')}</Text>
                    <TextInput accessibilityLabel={`${t(isSale ? 'stab_price' : 'dc_totalCost')} ${index + 1}`} keyboardType="decimal-pad" value={row.value} onChangeText={value => update(row.key, { value })} style={styles.input} />
                  </View>
                  {rows.length > 1 && (
                    <Pressable onPress={() => setRows(previous => previous.filter(other => other.key !== row.key))} accessibilityRole="button" accessibilityLabel={t('rcp_removeIngredient')} hitSlop={6} style={styles.remove}>
                      <Text style={{ color: palette.red, fontSize: 16, fontWeight: '700' }}>✕</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
          <Pressable onPress={() => setRows(previous => [...previous, newRow()])} accessibilityRole="button" style={styles.add}>
            <Text style={{ color: palette.brand, fontWeight: '800' }}>＋ {t('ptab_addRow')}</Text>
          </Pressable>

          {isSale && (
            <>
              <Text style={styles.label}>{t('inv_cartPaymentMethod')}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                {(['CASH', 'UPI', 'CREDIT'] as const).map(method => {
                  const selected = payment === method;
                  return (
                    <Pressable key={method} onPress={() => setPayment(method)} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.tab, selected && styles.tabOn]}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: selected ? palette.brand : palette.slate }}>{t(method === 'CASH' ? 'stab_cash' : method === 'UPI' ? 'stab_upi' : 'stab_credit')}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
          {(!isSale || payment === 'CREDIT') && (
            <>
              <Text style={styles.label}>{t(isSale ? 'dc_customerNameLabel' : 'dc_vendorNameLabel')}</Text>
              <TextInput accessibilityLabel={t(isSale ? 'dc_customerNameLabel' : 'dc_vendorNameLabel')} placeholder={t(isSale ? 'dc_customerNamePlaceholder' : 'dc_vendorNamePlaceholder')} placeholderTextColor={palette.muted}
                value={party} onChangeText={setParty} style={[styles.input, { marginBottom: 6 }]} />
              {partyNames.length > 0 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginBottom: 10 }}>
                  {partyNames.slice(0, 12).map(name => (
                    <Pressable key={name} onPress={() => setParty(name)} accessibilityRole="button" style={[styles.chip, party === name && styles.tabOn]}>
                      <Text style={{ fontSize: 12, color: palette.slate }}>{isSale ? '🧑' : '🏪'} {name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </>
          )}
          {!isSale && !!party.trim() && (
            <Pressable onPress={() => setPaid(value => !value)} accessibilityRole="checkbox" accessibilityState={{ checked: paid }} style={styles.paidRow}>
              <View style={[styles.box, paid && { backgroundColor: palette.brand, borderColor: palette.brand }]}>
                {paid && <Text style={{ color: '#FFFFFF', fontSize: 13, lineHeight: 15, fontWeight: '800' }}>✓</Text>}
              </View>
              <Text style={{ flex: 1, fontSize: 13, color: palette.slate }}>{t('ptab_paidNow')}</Text>
            </Pressable>
          )}
          <View style={styles.totalRow}>
            <Text style={{ fontSize: 13, color: palette.slate }}>{t(isSale ? 'stab_total' : 'ptab_total')}</Text>
            <Text style={{ fontSize: 16, fontWeight: '800', color: palette.navy }}>{rupees(formTotal)}</Text>
          </View>
          {!!error && <Text style={{ color: palette.red, fontWeight: '600', marginBottom: 8 }} accessibilityLiveRegion="polite">{error}</Text>}
          <Pressable onPress={save} disabled={saving} accessibilityRole="button" style={[styles.save, saving && { opacity: 0.6 }]}>
            <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 15 }}>{saving ? t('common_saving') : t(isSale ? 'stab_save' : 'ptab_save')}</Text>
          </Pressable>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        {(['daily', 'monthly'] as const).map(value => {
          const selected = period === value;
          return (
            <Pressable key={value} onPress={() => setPeriod(value)} accessibilityRole="tab" accessibilityState={{ selected }} style={[styles.tab, selected && styles.tabOn]}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: selected ? palette.brand : palette.slate }}>{t(value === 'daily' ? 'ptab_today' : 'ptab_thisMonth')}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <View style={[styles.stat, { backgroundColor: isSale ? palette.greenBg : palette.amberBg }]}>
          <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{rupees(total)}</Text>
          <Text style={[styles.statLabel, { color: isSale ? palette.green : palette.amber }]}>{t(isSale ? 'stab_total' : 'ptab_total')}</Text>
        </View>
        <View style={[styles.stat, { backgroundColor: due > 0 ? palette.redBg : palette.page }]}>
          <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{rupees(due)}</Text>
          <Text style={[styles.statLabel, { color: due > 0 ? palette.red : palette.muted }]}>{t(isSale ? 'stab_toCollect' : 'ptab_due')}</Text>
        </View>
        {isSale && (
          <>
            <View style={[styles.stat, { backgroundColor: palette.page }]}>
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{rupees(paidBy('CASH'))}</Text>
              <Text style={[styles.statLabel, { color: palette.muted }]}>{t('stab_cash')}</Text>
            </View>
            <View style={[styles.stat, { backgroundColor: palette.page }]}>
              <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{rupees(paidBy('UPI'))}</Text>
              <Text style={[styles.statLabel, { color: palette.muted }]}>{t('stab_upi')}</Text>
            </View>
          </>
        )}
      </View>

      {!!loadError && <Text style={{ color: palette.red, fontWeight: '600', marginBottom: 8 }}>{loadError}</Text>}
      {entries === null && !loadError && <ActivityIndicator color={palette.brand} style={{ padding: 16 }} />}
      {entries !== null && !list.length && <Text style={[styles.muted, { textAlign: 'center', paddingVertical: 20 }]}>{t(isSale ? 'stab_empty' : 'ptab_empty')}</Text>}
      {list.length > 0 && (
        <View style={styles.table}>
          {list.map((tx, index) => (
            <View key={tx.id} style={[styles.entry, index < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: palette.border }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: palette.navy }} numberOfLines={1}>{tx.productName}</Text>
                <Text style={{ fontSize: 11, color: palette.muted, marginTop: 2 }} numberOfLines={1}>
                  {tx.quantity} {tx.unit}{isSale ? ` · ${t(tx.paymentMethod === 'UPI' ? 'stab_upi' : tx.paymentMethod === 'CREDIT' ? 'stab_credit' : 'stab_cash')}` : ''}{tx.note ? ` · ${isSale ? '🧑' : '🏪'} ${tx.note}` : ''} · {tx.date}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: palette.navy }}>{rupees(tx.amount)}</Text>
                {tx.amountDue > 0 && <Text style={{ fontSize: 10, fontWeight: '700', color: palette.red }}>{t('ptab_due')} {rupees(tx.amountDue)}</Text>}
              </View>
              <Pressable onPress={() => removeEntry(tx)} accessibilityRole="button" accessibilityLabel={`${t('common_delete')} ${tx.productName}`} hitSlop={8} style={styles.delete}>
                <Text style={{ fontSize: 13 }}>🗑️</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  primary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.brand, marginBottom: 12 },
  card: { backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 12, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: palette.navy, marginBottom: 10 },
  muted: { fontSize: 13, color: palette.muted },
  row: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, padding: 10, marginBottom: 8 },
  picker: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderWidth: 1, borderColor: palette.border, borderRadius: 9, paddingHorizontal: 10 },
  pickerList: { borderWidth: 1, borderColor: palette.border, borderRadius: 9, marginTop: 6, overflow: 'hidden' },
  pickerSearch: { minHeight: 40, paddingHorizontal: 10, fontSize: 13, color: palette.navy, borderBottomWidth: 1, borderBottomColor: palette.border },
  option: { paddingVertical: 11, paddingHorizontal: 10 },
  label: { fontSize: 11, fontWeight: '700', color: palette.slate, marginBottom: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: palette.border, borderRadius: 9, paddingHorizontal: 10, color: palette.navy, fontSize: 14, minWidth: 0 },
  remove: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  add: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: palette.brandBg, marginBottom: 12 },
  chip: { borderWidth: 1, borderColor: palette.border, borderRadius: 999, paddingHorizontal: 10, minHeight: 34, justifyContent: 'center', marginRight: 6 },
  paidRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, marginBottom: 6 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#94A3B8', alignItems: 'center', justifyContent: 'center' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: palette.page, borderRadius: 10, padding: 10, marginBottom: 10 },
  save: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.brand },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border, borderRadius: 10, backgroundColor: palette.panel },
  tabOn: { borderColor: palette.brand, backgroundColor: palette.brandBg },
  stat: { flexBasis: '47%', flexGrow: 1, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: palette.border },
  statValue: { fontSize: 18, fontWeight: '800', color: palette.navy },
  statLabel: { fontSize: 11, fontWeight: '700' },
  table: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, overflow: 'hidden', backgroundColor: palette.panel, marginBottom: 12 },
  entry: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10 },
  delete: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
});
