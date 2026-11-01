import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { inr } from '../../bachatgat/format';
import {
  Badge, Btn, Card, Chips, Empty, ErrorBox, Field, FieldSpec, Form, Gate, Grid, KV, NumInput, Notice, Screen, SearchBar, SectionTitle, SelectInput, confirmDialog, errorText,
  nextRowId, num, qty, unitsFor, useDebounced, useFood, useLoad, validate,
} from '../ui';

export function MenuScreen() {
  const { api, t, tf, c, push, st } = useFood();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get('/food-products', { q: dq }), [dq]);
  const foods: any[] = (data as any)?.foods || [];
  return (
    <Screen title={tf('menu_title')} noBack onRefresh={reload} refreshing={refreshing}
      right={<Btn small icon="＋" title={tf('menu_add')} onPress={() => push('foodForm')} />}>
      <SearchBar value={q} onChange={setQ} placeholder={tf('menu_search')} />
      <Gate loading={loading && !data} error={error} onRetry={reload}>
        {!foods.length && <Empty text={q ? t('common_noResults') : tf('menu_empty')} action={q ? undefined : tf('menu_add')} onAction={() => push('foodForm')} />}
        <Grid>
          {foods.map(f => (
            <Card key={f.id} onPress={() => push('foodForm', { food: f })} a11y={`${f.name}, ${inr(f.sellingPrice)}`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: c.text, fontWeight: '800', fontSize: 15, flex: 1 }} numberOfLines={1}>{f.name}</Text>
                <Text style={{ color: c.text, fontWeight: '900', fontSize: 16 }}>{inr(f.sellingPrice)}</Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {f.productType === 'PACKAGED' ? tf('menu_packagedLine', { name: f.packagedProductName || '-' }) : tf('menu_ingredients', { count: f.recipe?.ingredients?.length || 0 })}
                {f.status !== 'Active' ? ` · ${st(f.status)}` : ''}
              </Text>
              {f.hasCostSource && num(f.preparationCost) <= 0 ? (
                <View style={{ marginTop: 8 }}><Badge value="Pending" label={tf('menu_noPrices')} /></View>
              ) : f.hasCostSource ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                  <Text style={{ color: c.sub, fontSize: 13 }}>{tf('menu_cost')} {inr(f.preparationCost)}</Text>
                  <Text style={{ color: num(f.profitPerUnit) < 0 ? c.red : c.green, fontWeight: '800', fontSize: 13 }}>{tf('menu_profit')} {inr(f.profitPerUnit)}</Text>
                  <Text style={{ color: c.sub, fontSize: 13 }}>{tf('menu_canMake', { count: f.availableQty ?? 0 })}</Text>
                </View>
              ) : (
                <View style={{ marginTop: 8 }}><Badge value="Pending" label={tf('menu_noRecipe')} /></View>
              )}
            </Card>
          ))}
        </Grid>
      </Gate>
    </Screen>
  );
}

interface Ingredient { id: string; productId: string; quantity: string; unitId: string }

export function FoodFormScreen({ params }: { params?: { food?: any } }) {
  const { api, t, tf, c, back, bump, toast, meta, st } = useFood();
  const food = params?.food;
  const products = useLoad(() => api.get('/products', { status: 'Active' }), []);
  const productList: any[] = (products.data as any)?.products || [];
  const [values, setValues] = useState<Record<string, any>>({
    name: food?.name || '', categoryId: food?.categoryId ? String(food.categoryId) : '', sellingPrice: food?.sellingPrice ?? '', status: food?.status || 'Active',
  });
  const [type, setType] = useState<'RECIPE' | 'PACKAGED'>(food?.productType || 'RECIPE');
  const [packagedId, setPackagedId] = useState(food?.packagedProductId ? String(food.packagedProductId) : '');
  const [packagedQty, setPackagedQty] = useState(String(food?.packagedQty ?? 1));
  const [yieldQty, setYieldQty] = useState(String(food?.recipe?.yieldQty ?? 1));
  const [rows, setRows] = useState<Ingredient[]>(() => (food?.recipe?.ingredients || []).map((i: any) => ({ id: nextRowId(), productId: String(i.productId), quantity: String(i.quantity), unitId: String(i.unitId) })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const productOptions = useMemo(() => productList.map(p => ({ value: String(p.id), label: `${p.name} (${p.unitName})` })), [productList]);
  const fields: FieldSpec[] = [
    { key: 'name', label: tf('menu_name'), required: true, maxLength: 120 },
    { key: 'sellingPrice', label: tf('menu_price'), type: 'money', required: true },
    { key: 'categoryId', label: tf('prod_category'), type: 'select', options: [{ value: '', label: tf('common_none') }, ...(meta?.categories || []).map(x => ({ value: String(x.id), label: x.name }))] },
    { key: 'status', label: t('common_status'), type: 'select', options: ['Active', 'Inactive'].map(v => ({ value: v, label: st(v) })) },
  ];
  const update = (id: string, patch: Partial<Ingredient>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));

  // Live cost while editing, from each ingredient's current average cost.
  const liveCost = useMemo(() => {
    if (num(yieldQty) <= 0) return 0;
    let cost = 0;
    rows.forEach(r => {
      const product = productList.find(p => String(p.id) === r.productId);
      const units = meta?.units || [];
      const from = units.find(u => String(u.id) === r.unitId);
      const to = units.find(u => u.id === product?.unitId);
      if (product && from && to) cost += (num(r.quantity) * num(from.toBase) / num(to.toBase)) * num(product.avgCost);
    });
    return cost / num(yieldQty);
  }, [rows, yieldQty, productList, meta]);

  const save = async () => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length || busy) return;
    if (type === 'PACKAGED' && !packagedId) { setError(tf('menu_pickPackaged')); return; }
    const filled = rows.filter(r => r.productId);
    if (type === 'RECIPE' && (num(yieldQty) <= 0 || filled.some(r => num(r.quantity) <= 0))) { setError(tf('menu_recipeProblem')); return; }
    setBusy(true);
    setError(null);
    const body: any = { ...values, productType: type };
    if (type === 'PACKAGED') {
      body.packagedProductId = packagedId;
      body.packagedQty = packagedQty;
    } else {
      body.recipe = { yieldQty, ingredients: filled.map(r => ({ productId: r.productId, quantity: r.quantity, unitId: r.unitId })) };
    }
    try {
      if (food) await api.put(`/food-products/${food.id}`, body);
      else await api.post('/food-products', body);
      bump();
      toast(tf('common_saved'));
      back();
    } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirmDialog(tf('common_delete'), tf('menu_deleteHint', { name: food.name }), tf('common_delete'), t('common_cancel'), true))) return;
    try { await api.del(`/food-products/${food.id}`); bump(); toast(tf('common_deleted')); back(); } catch (e) { setError(errorText(t, e)); }
  };

  return (
    <Screen title={food ? tf('menu_edit') : tf('menu_add')}>
      <Form fields={fields} values={values} errors={errors} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} />
      <SectionTitle>{tf('menu_howSold')}</SectionTitle>
      <Chips value={type} onChange={setType} options={[{ value: 'RECIPE', label: tf('menu_typeRecipe') }, { value: 'PACKAGED', label: tf('menu_typePackaged') }]} />
      <Gate loading={products.loading} error={products.error} onRetry={products.reload}>
        {type === 'PACKAGED' ? (
          <Card style={{ marginTop: 8 }}>
            <Notice tone="blue" text={tf('menu_packagedHint')} />
            <Field spec={{ key: 'p', label: tf('menu_stockItem'), type: 'select', options: productOptions, required: true }} value={packagedId} onChange={setPackagedId} />
            <NumInput label={tf('menu_perSale')} value={packagedQty} onChange={setPackagedQty} />
          </Card>
        ) : (
          <>
            <Notice tone="blue" text={tf('menu_recipeHint')} />
            <View style={{ maxWidth: 240, marginBottom: 8 }}>
              <NumInput label={tf('menu_yield')} value={yieldQty} onChange={setYieldQty} />
            </View>
            {rows.map(row => {
              const product = productList.find(p => String(p.id) === row.productId);
              const units = unitsFor(product, meta?.units || []);
              return (
                <Card key={row.id}>
                  <SelectInput value={row.productId} label={tf('menu_ingredient')} placeholder={tf('common_selectProduct')} options={productOptions}
                    onChange={v => { const next = productList.find(p => String(p.id) === v); update(row.id, { productId: v, unitId: next ? String(next.unitId) : '' }); }} />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
                    <NumInput label={tf('common_quantity')} value={row.quantity} onChange={v => update(row.id, { quantity: v })} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>{tf('prod_unit')}</Text>
                      <SelectInput value={row.unitId} onChange={v => update(row.id, { unitId: v })} options={units.map(u => ({ value: String(u.id), label: u.name }))} label={tf('prod_unit')} />
                    </View>
                    <Pressable onPress={() => setRows(rs => rs.filter(r => r.id !== row.id))} hitSlop={8} accessibilityRole="button" accessibilityLabel={tf('common_removeRow')}
                      style={{ width: 44, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: c.red, fontSize: 18, fontWeight: '700' }}>✕</Text>
                    </Pressable>
                  </View>
                </Card>
              );
            })}
            <Btn kind="secondary" icon="＋" title={tf('menu_addIngredient')} onPress={() => setRows(rs => [...rs, { id: nextRowId(), productId: '', quantity: '', unitId: '' }])} />
            <Card style={{ backgroundColor: c.brandBg, marginTop: 8 }}>
              <KV label={tf('menu_cost')} value={inr(liveCost)} />
              <KV label={tf('menu_profit')} value={inr(num(values.sellingPrice) - liveCost)} strong color={num(values.sellingPrice) - liveCost < 0 ? c.red : c.green} />
              {food?.availableQty !== null && food?.availableQty !== undefined && <KV label={tf('menu_available')} value={qty(food.availableQty)} />}
            </Card>
          </>
        )}
      </Gate>
      {!!error && <ErrorBox message={error} />}
      <Btn title={t('common_save')} onPress={save} busy={busy} />
      {food && <Btn kind="danger" title={tf('common_delete')} onPress={remove} />}
    </Screen>
  );
}
