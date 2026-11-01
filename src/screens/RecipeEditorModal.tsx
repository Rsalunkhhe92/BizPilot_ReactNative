/**
 * RecipeEditorModal.tsx
 * Recipe of a selling product on product shops: what one batch uses, so a sale takes the
 * right share of each ingredient from stock. Data: GET/PUT /api/inventory/products/<id>/recipe.
 * A recipe change applies to future sales only.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { TranslationKey } from '../../i18n';

const palette = {
  navy: '#0F172A', slate: '#334155', muted: '#64748B', border: '#E2E8F0', panel: '#FFFFFF',
  brand: '#4F46E5', brandBg: '#EEF2FF', red: '#DC2626', overlay: 'rgba(15,23,42,0.5)',
};

// Same sizes as UNIT_SIZES in the backend, for the units the app offers.
const UNIT_FAMILIES: string[][] = [['kg', 'gram'], ['litre', 'ml'], ['piece', 'dozen']];
const UNIT_SIZE: Record<string, number> = { kg: 1000, gram: 1, litre: 1000, ml: 1, piece: 1, dozen: 12 };

function unitsFor(stockUnit: string) {
  const unit = stockUnit.trim().toLowerCase();
  return UNIT_FAMILIES.find(family => family.includes(unit)) || [stockUnit];
}

type Product = { id: string; name: string; unit: string; costPrice: number; productType?: string; hasRecipe?: boolean };
type Row = { key: string; productId: string; quantity: string; unit: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  ownerId: number;
  product: { id: string; name: string; sellingPrice: number; unit: string } | null;
  products: Product[];
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  onSaved: () => void;
};

export default function RecipeEditorModal({ visible, onClose, ownerId, product, products, apiFetch, t, onSaved }: Props) {
  const [yieldQty, setYieldQty] = useState('10');
  const [rows, setRows] = useState<Row[]>([]);
  const [hadRecipe, setHadRecipe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const newRow = (): Row => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, productId: '', quantity: '', unit: '' });

  useEffect(() => {
    if (!visible || !product) return;
    let alive = true;
    setError('');
    setPickerFor(null);
    setLoading(true);
    apiFetch(`/api/inventory/products/${product.id}/recipe?owner_id=${ownerId}`)
      .then(res => res.json())
      .then(data => {
        if (!alive) return;
        const recipe = data.recipe;
        setHadRecipe(!!recipe);
        setYieldQty(recipe ? String(recipe.yieldQty) : '10');
        setRows(recipe
          ? recipe.ingredients.map((i: any) => ({ key: `r${i.productId}`, productId: i.productId, quantity: String(i.quantity), unit: i.unit }))
          : [newRow()]);
      })
      .catch(() => { if (alive) setError(t('common_networkError')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [visible, product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Purchase products first: they are what recipes are normally made from.
  const choices = useMemo(() => products
    .filter(p => p.id !== product?.id && !p.hasRecipe)
    .sort((a, b) => Number(b.productType === 'PURCHASE') - Number(a.productType === 'PURCHASE') || a.name.localeCompare(b.name)),
  [products, product?.id]);

  const costPerUnit = useMemo(() => {
    const batch = Number(yieldQty);
    if (!(batch > 0)) return 0;
    return rows.reduce((sum, row) => {
      const ingredient = products.find(p => p.id === row.productId);
      if (!ingredient) return sum;
      const from = UNIT_SIZE[row.unit.toLowerCase()];
      const to = UNIT_SIZE[ingredient.unit.toLowerCase()];
      const inStockUnit = from && to ? (Number(row.quantity) || 0) * from / to : Number(row.quantity) || 0;
      return sum + inStockUnit * ingredient.costPrice;
    }, 0) / batch;
  }, [rows, yieldQty, products]);

  const update = (key: string, patch: Partial<Row>) => setRows(previous => previous.map(row => (row.key === key ? { ...row, ...patch } : row)));

  const save = async (ingredients: Row[]) => {
    if (!product || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`/api/inventory/products/${product.id}/recipe`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId,
          yieldQty: Number(yieldQty),
          ingredients: ingredients.map(row => ({ productId: row.productId, quantity: Number(row.quantity), unit: row.unit })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t('common_networkError'));
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError(t('common_networkError'));
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    const filled = rows.filter(row => row.productId);
    if (!filled.length) {
      setError(t('rcp_needIngredient'));
      return;
    }
    if (!(Number(yieldQty) > 0) || filled.some(row => !(Number(row.quantity) > 0))) {
      setError(t('rcp_needQuantities'));
      return;
    }
    save(filled);
  };

  const margin = (product?.sellingPrice || 0) - costPerUnit;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>🧾 {t('rcp_title')}: {product?.name}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common_close')}>
              <Text style={{ fontSize: 18, color: palette.muted }}>✕</Text>
            </Pressable>
          </View>
          {loading ? <ActivityIndicator color={palette.brand} style={{ padding: 24 }} /> : (
            <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.hint}>{t('rcp_hint')}</Text>
              <Text style={styles.label}>{t('rcp_makes')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <TextInput accessibilityLabel={t('rcp_makes')} keyboardType="decimal-pad" value={yieldQty} onChangeText={setYieldQty} style={[styles.input, { width: 90 }]} />
                <Text style={{ color: palette.slate, fontSize: 13 }}>{product?.unit} {product?.name}</Text>
              </View>

              {rows.map((row, index) => {
                const ingredient = products.find(p => p.id === row.productId);
                const open = pickerFor === row.key;
                const term = search.trim().toLowerCase();
                const taken = rows.filter(other => other.key !== row.key).map(other => other.productId);
                return (
                  <View key={row.key} style={styles.row}>
                    <Pressable onPress={() => { setPickerFor(open ? null : row.key); setSearch(''); }} accessibilityRole="button"
                      accessibilityLabel={`${t('rcp_ingredient')} ${index + 1}: ${ingredient?.name || t('rcp_pickIngredient')}`} style={styles.picker}>
                      <Text style={{ flex: 1, fontSize: 14, color: ingredient ? palette.navy : palette.muted }} numberOfLines={1}>{ingredient?.name || t('rcp_pickIngredient')}</Text>
                      <Text style={{ color: palette.brand }}>{open ? '▲' : '▼'}</Text>
                    </Pressable>
                    {open && (
                      <View style={styles.pickerList}>
                        <TextInput accessibilityLabel={t('inv_searchProducts')} placeholder={t('inv_searchProducts')} placeholderTextColor={palette.muted} value={search} onChangeText={setSearch} style={styles.pickerSearch} />
                        <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                          {choices.filter(p => !taken.includes(p.id) && (!term || p.name.toLowerCase().includes(term))).map(p => (
                            <Pressable key={p.id} accessibilityRole="button" onPress={() => { update(row.key, { productId: p.id, unit: p.unit }); setPickerFor(null); }} style={styles.option}>
                              <Text style={{ fontSize: 14, color: palette.navy }}>{p.productType === 'PURCHASE' ? '🛒' : '🛍️'} {p.name} <Text style={{ color: palette.muted, fontSize: 12 }}>({p.unit})</Text></Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    )}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <TextInput accessibilityLabel={`${t('rcp_quantity')} ${index + 1}`} keyboardType="decimal-pad" placeholder={t('rcp_quantity')} placeholderTextColor={palette.muted}
                        value={row.quantity} onChangeText={value => update(row.key, { quantity: value })} style={[styles.input, { flex: 1 }]} />
                      {ingredient && unitsFor(ingredient.unit).map(unit => {
                        const selected = row.unit.toLowerCase() === unit.toLowerCase();
                        return (
                          <Pressable key={unit} onPress={() => update(row.key, { unit })} accessibilityRole="radio" accessibilityState={{ selected }}
                            style={[styles.unit, selected && { borderColor: palette.brand, backgroundColor: palette.brandBg }]}>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: selected ? palette.brand : palette.slate }}>{unit}</Text>
                          </Pressable>
                        );
                      })}
                      <Pressable onPress={() => setRows(previous => previous.filter(other => other.key !== row.key))} accessibilityRole="button" accessibilityLabel={t('rcp_removeIngredient')} hitSlop={6} style={styles.remove}>
                        <Text style={{ color: palette.red, fontSize: 16, fontWeight: '700' }}>✕</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              <Pressable onPress={() => setRows(previous => [...previous, newRow()])} accessibilityRole="button" style={styles.add}>
                <Text style={{ color: palette.brand, fontWeight: '800' }}>＋ {t('rcp_addIngredient')}</Text>
              </Pressable>

              <View style={styles.summary}>
                <Text style={{ fontSize: 13, color: palette.slate }}>{t('rcp_costEach')}: <Text style={{ fontWeight: '800', color: palette.navy }}>₹{costPerUnit.toFixed(2)}</Text></Text>
                <Text style={{ fontSize: 13, color: palette.slate }}>{t('rcp_profitEach')}: <Text style={{ fontWeight: '800', color: margin < 0 ? palette.red : palette.navy }}>₹{margin.toFixed(2)}</Text></Text>
              </View>
              {!!error && <Text style={{ color: palette.red, fontWeight: '600', marginBottom: 8 }} accessibilityLiveRegion="polite">{error}</Text>}
              <Pressable onPress={submit} disabled={saving} accessibilityRole="button" style={[styles.save, saving && { opacity: 0.6 }]}>
                <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 15 }}>{saving ? t('common_saving') : t('rcp_save')}</Text>
              </Pressable>
              {hadRecipe && (
                <Pressable onPress={() => save([])} disabled={saving} accessibilityRole="button" style={{ alignItems: 'center', paddingVertical: 12 }}>
                  <Text style={{ color: palette.red, fontWeight: '700' }}>{t('rcp_remove')}</Text>
                </Pressable>
              )}
            </ScrollView>
          )}
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
  hint: { fontSize: 12, color: palette.muted, marginBottom: 10 },
  label: { fontSize: 12, fontWeight: '700', color: palette.slate, marginBottom: 6 },
  input: { minHeight: 44, borderWidth: 1, borderColor: palette.border, borderRadius: 9, paddingHorizontal: 10, color: palette.navy, fontSize: 14, minWidth: 0 },
  row: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, padding: 10, marginBottom: 8 },
  picker: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderWidth: 1, borderColor: palette.border, borderRadius: 9, paddingHorizontal: 10 },
  pickerList: { borderWidth: 1, borderColor: palette.border, borderRadius: 9, marginTop: 6, overflow: 'hidden' },
  pickerSearch: { minHeight: 40, paddingHorizontal: 10, fontSize: 13, color: palette.navy, borderBottomWidth: 1, borderBottomColor: palette.border },
  option: { paddingVertical: 11, paddingHorizontal: 10 },
  unit: { minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border, borderRadius: 9 },
  remove: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  add: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: palette.brandBg, marginBottom: 10 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, marginBottom: 10 },
  save: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: palette.brand },
});
