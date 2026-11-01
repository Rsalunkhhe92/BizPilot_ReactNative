import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { fmtDate, inr, isoToday } from '../../bachatgat/format';
import {
  Btn, BtnRow, Card, Chips, Empty, ErrorBox, Field, FieldSpec, Form, FormSheet, Gate, Grid, KV, ListItem, LoadMore, Notice, Screen, SearchBar, SectionTitle, StatCard, StatRow, StockPill, confirmDialog,
  errorText, num, qty, unitsFor, useDebounced, useFood, useLoad, usePaged, useStockSubmit, validate,
} from '../ui';

const TXN_LABELS: Record<string, any> = {
  OPENING: 'led_OPENING', PURCHASE: 'led_PURCHASE', CONSUMPTION: 'led_CONSUMPTION', SALE_USAGE: 'led_SALE_USAGE', ADJUST_IN: 'led_ADJUST_IN',
  ADJUST_OUT: 'led_ADJUST_OUT', WASTAGE: 'led_WASTAGE', SPOILAGE: 'led_SPOILAGE', PERSONAL: 'led_PERSONAL',
};

export function InventoryScreen() {
  const { api, tf, t, c, push, meta, st } = useFood();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [state, setState] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, reload, refreshing } = useLoad(
    () => api.get('/products', { q: dq, categoryId: category, state }), [dq, category, state]);
  const products = (data as any)?.products || [];
  const totalValue = products.reduce((sum: number, p: any) => sum + Math.max(num(p.stockValue), 0), 0);
  return (
    <Screen title={tf('inv_title')} noBack onRefresh={reload} refreshing={refreshing}
      right={<Btn small icon="＋" title={tf('prod_add')} onPress={() => push('productForm')} />}>
      <BtnRow>
        <Btn small kind="secondary" icon="🏪" title={tf('sup_title')} onPress={() => push('suppliers')} />
        <Btn small kind="secondary" icon="🗂️" title={tf('cat_title')} onPress={() => push('categories')} />
        <Btn small kind="secondary" icon="⚖️" title={tf('unit_title')} onPress={() => push('units')} />
        <Btn small kind="secondary" icon="⚙️" title={tf('set_title')} onPress={() => push('settings')} />
      </BtnRow>
      <View style={{ height: 8 }} />
      <SearchBar value={q} onChange={setQ} placeholder={tf('inv_search')} />
      <Chips value={state} onChange={setState} options={[
        { value: '', label: t('common_all') }, { value: 'ATTENTION', label: tf('inv_needsAttention') }, { value: 'LOW', label: tf('stock_low') }, { value: 'OUT', label: tf('stock_out') },
      ]} />
      {!!meta?.categories.length && (
        <Chips value={category} onChange={setCategory} options={[{ value: '', label: tf('inv_allCategories') }, ...meta.categories.map(x => ({ value: String(x.id), label: x.name }))]} />
      )}
      <Gate loading={loading && !data} error={error} onRetry={reload}>
        {products.length > 0 && <Text style={{ color: c.muted, marginVertical: 8 }}>{tf('inv_summary', { count: products.length, value: inr(totalValue) })}</Text>}
        {!products.length && <Empty text={q || state || category ? t('common_noResults') : tf('inv_empty')} action={q || state || category ? undefined : tf('prod_add')} onAction={() => push('productForm')} />}
        <Grid>
          {products.map((p: any) => (
            <Card key={p.id} onPress={() => push('productDetail', { id: p.id })} a11y={`${p.name}, ${qty(p.stockQty)} ${p.unitName}`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: c.text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{p.name}</Text>
                  <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={1}>{p.categoryName || tf('inv_noCategory')}{p.status !== 'Active' ? ` · ${st(p.status)}` : ''}</Text>
                </View>
                <StockPill state={p.stockState} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ color: p.stockState === 'OK' ? c.text : (p.stockState === 'OUT' ? c.red : c.amber), fontWeight: '900', fontSize: 22 }}>
                  {qty(p.stockQty)} <Text style={{ fontSize: 13, fontWeight: '600', color: c.muted }}>{p.unitName}</Text>
                </Text>
                <Text style={{ color: c.muted, fontSize: 12 }}>{inr(p.avgCost)}/{p.unitName} · {inr(p.stockValue)}</Text>
              </View>
            </Card>
          ))}
        </Grid>
      </Gate>
    </Screen>
  );
}

export function ProductFormScreen({ params }: { params?: { product?: any } }) {
  const { api, t, tf, back, bump, toast, meta, st } = useFood();
  const product = params?.product;
  const [values, setValues] = useState<Record<string, any>>(product ? {
    name: product.name, categoryId: product.categoryId ? String(product.categoryId) : '', unitId: String(product.unitId), purchasePrice: product.purchasePrice,
    sellingPrice: product.sellingPrice ?? '', openingStock: product.openingStock, minStockAlert: product.minStockAlert, supplierId: product.supplierId ? String(product.supplierId) : '', status: product.status,
  } : { status: 'Active' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields: FieldSpec[] = [
    { key: 'name', label: tf('prod_name'), required: true, maxLength: 120 },
    { key: 'categoryId', label: tf('prod_category'), type: 'select', options: (meta?.categories || []).map(x => ({ value: String(x.id), label: x.name })) },
    { key: 'unitId', label: tf('prod_unit'), type: 'select', required: true, options: (meta?.units || []).map(x => ({ value: String(x.id), label: x.name })), help: tf('prod_unitHelp') },
    { key: 'purchasePrice', label: tf('prod_purchasePrice'), type: 'money' },
    { key: 'sellingPrice', label: tf('prod_sellingPrice'), type: 'money', help: tf('prod_sellingHelp') },
    { key: 'openingStock', label: tf('prod_openingStock'), type: 'decimal', min: 0, help: product ? tf('prod_openingEditHelp') : undefined },
    { key: 'minStockAlert', label: tf('prod_minAlert'), type: 'decimal', min: 0 },
    { key: 'supplierId', label: tf('prod_supplier'), type: 'select', options: [{ value: '', label: tf('common_none') }, ...(meta?.suppliers || []).map(x => ({ value: String(x.id), label: x.name }))] },
    { key: 'status', label: t('common_status'), type: 'select', options: ['Active', 'Inactive'].map(v => ({ value: v, label: st(v) })) },
  ];
  const save = async () => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (product) await api.put(`/products/${product.id}`, values);
      else await api.post('/products', values);
      bump();
      toast(tf('common_saved'));
      back();
    } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); }
  };
  return (
    <Screen title={product ? tf('prod_edit') : tf('prod_add')}>
      <Form fields={fields} values={values} errors={errors} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} />
      {!!error && <ErrorBox message={error} />}
      <Btn title={t('common_save')} onPress={save} busy={busy} />
    </Screen>
  );
}

export function ProductDetailScreen({ params }: { params: { id: number } }) {
  const { api, t, tf, c, push, back, bump, toast, st } = useFood();
  const [error, setError] = useState<string | null>(null);
  const [product, setProduct] = useState<any>(null);
  const list = usePaged(async page => {
    const r = await api.get(`/products/${params.id}`, { page, pageSize: 30 });
    setProduct(r.product);
    return { items: r.ledger as any[], hasMore: r.hasMore };
  }, [params.id]);
  const remove = async () => {
    const go = await confirmDialog(tf('prod_delete'), tf('prod_deleteHint', { name: product.name }), tf('common_delete'), t('common_cancel'), true);
    if (!go) return;
    try {
      await api.del(`/products/${params.id}`);
      bump();
      toast(tf('common_deleted'));
      back();
    } catch (e) { setError(errorText(t, e)); }
  };
  return (
    <Screen title={product?.name || tf('inv_title')} onRefresh={list.reload} refreshing={list.refreshing}>
      <Gate loading={list.loading && !product} error={list.error} onRetry={list.reload}>
        {product && (
          <>
            <StatRow>
              <StatCard icon="📦" label={tf('prod_inStock')} value={`${qty(product.stockQty)} ${product.unitName}`} tone={product.stockState === 'OK' ? 'green' : product.stockState === 'OUT' ? 'red' : 'amber'} />
              <StatCard icon="💰" label={tf('prod_stockValue')} value={inr(product.stockValue)} />
              <StatCard icon="⚖️" label={tf('prod_avgCost')} value={`${inr(product.avgCost)}/${product.unitName}`} />
            </StatRow>
            <Card>
              <KV label={tf('prod_category')} value={product.categoryName || '-'} />
              <KV label={tf('prod_supplier')} value={product.supplierName || '-'} />
              <KV label={tf('prod_purchasePrice')} value={inr(product.purchasePrice)} />
              <KV label={tf('prod_sellingPrice')} value={product.sellingPrice === null ? '-' : inr(product.sellingPrice)} />
              <KV label={tf('prod_minAlert')} value={`${qty(product.minStockAlert)} ${product.unitName}`} />
              <KV label={t('common_status')} value={st(product.status)} />
            </Card>
            {!!error && <ErrorBox message={error} />}
            <BtnRow>
              <Btn small icon="✏️" title={t('common_edit')} onPress={() => push('productForm', { product })} />
              <Btn small kind="secondary" icon="🔧" title={tf('adj_title')} onPress={() => push('adjustment', { product })} />
              <Btn small kind="danger" icon="🗑️" title={tf('common_delete')} onPress={remove} />
            </BtnRow>
            <SectionTitle>{tf('prod_history')}</SectionTitle>
            {!list.items.length && <Text style={{ color: c.muted }}>{t('common_noRecords')}</Text>}
            {list.items.map((row: any) => (
              <ListItem key={row.id} title={tf(TXN_LABELS[row.txnType] || 'led_OPENING')} subtitle={fmtDate(row.transactionDate)} meta={row.note || undefined}
                right={`${num(row.quantity) > 0 ? '+' : ''}${qty(row.quantity)} ${product.unitName}`} />
            ))}
            <LoadMore list={list} />
          </>
        )}
      </Gate>
    </Screen>
  );
}

export function AdjustmentScreen({ params }: { params: { product: any } }) {
  const { api, t, tf, back, bump, toast, meta } = useFood();
  const product = params.product;
  const units = unitsFor(product, meta?.units || []);
  const [values, setValues] = useState<Record<string, any>>({ direction: 'OUT', date: isoToday(), unitId: String(product.unitId) });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { send, busy, pending, error } = useStockSubmit();
  const fields: FieldSpec[] = [
    { key: 'direction', label: tf('adj_direction'), type: 'select', options: [{ value: 'IN', label: tf('adj_in') }, { value: 'OUT', label: tf('adj_out') }] },
    { key: 'quantity', label: tf('common_quantity'), type: 'decimal', required: true, min: 0.0001 },
    { key: 'unitId', label: tf('prod_unit'), type: 'select', options: units.map(u => ({ value: String(u.id), label: u.name })) },
    { key: 'reason', label: tf('adj_reason'), required: true, maxLength: 300, placeholder: tf('adj_reasonHint') },
    { key: 'date', label: tf('common_date'), type: 'date', required: true },
  ];
  const save = async () => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const r = await send((key, extra) => api.post('/adjustments', { ...values, productId: product.id, ...extra }, key));
    if (r) { bump(); toast(tf('common_saved')); back(); }
  };
  return (
    <Screen title={`${tf('adj_title')} · ${product.name}`}>
      <Notice tone="blue" text={tf('adj_hint', { qty: qty(product.stockQty), unit: product.unitName })} />
      <Form fields={fields} values={values} errors={errors} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} />
      {!!error && <ErrorBox message={error} />}
      <Btn title={pending ? t('common_retrySame') : t('common_save')} onPress={save} busy={busy} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------
export function SuppliersScreen() {
  const { api, tf, t, push, bump, toast } = useFood();
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get('/suppliers'), []);
  const [show, setShow] = useState(false);
  const suppliers = (data as any)?.suppliers || [];
  const fields: FieldSpec[] = [
    { key: 'name', label: tf('sup_name'), required: true, maxLength: 120 },
    { key: 'mobile', label: tf('sup_mobile'), type: 'phone' },
    { key: 'address', label: tf('sup_address'), maxLength: 300 },
  ];
  return (
    <Screen title={tf('sup_title')} onRefresh={reload} refreshing={refreshing} right={<Btn small icon="＋" title={tf('common_add')} onPress={() => setShow(true)} />}>
      <Gate loading={loading && !data} error={error} onRetry={reload}>
        {!suppliers.length && <Empty text={tf('sup_empty')} />}
        <Grid>
          {suppliers.map((s: any) => (
            <ListItem key={s.id} title={s.name} subtitle={tf('sup_line', { bills: s.bills, total: inr(s.totalPurchases) })} meta={s.mobile || undefined}
              right={num(s.due) > 0 ? `${tf('sup_due')} ${inr(s.due)}` : undefined} onPress={() => push('supplierDetail', { supplier: s })} />
          ))}
        </Grid>
      </Gate>
      <FormSheet visible={show} title={tf('sup_add')} fields={fields} onClose={() => setShow(false)}
        onSubmit={async v => { const r = await api.post('/suppliers', v); bump(); toast(tf('common_saved')); return r; }} />
    </Screen>
  );
}

export function SupplierDetailScreen({ params }: { params: { supplier: any } }) {
  const { api, tf, t, push, back, bump, toast } = useFood();
  const s = params.supplier;
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = usePaged(async page => {
    const r = await api.get('/purchases', { supplierId: s.id, from: '2000-01-01', to: isoToday(), page });
    return { items: r.purchases as any[], hasMore: r.hasMore };
  }, [s.id]);
  const fields: FieldSpec[] = [
    { key: 'name', label: tf('sup_name'), required: true, maxLength: 120 },
    { key: 'mobile', label: tf('sup_mobile'), type: 'phone' },
    { key: 'address', label: tf('sup_address'), maxLength: 300 },
  ];
  const remove = async () => {
    if (!(await confirmDialog(tf('common_delete'), s.name, tf('common_delete'), t('common_cancel'), true))) return;
    try { await api.del(`/suppliers/${s.id}`); bump(); toast(tf('common_deleted')); back(); } catch (e) { setError(errorText(t, e)); }
  };
  return (
    <Screen title={s.name} subtitle={s.mobile} onRefresh={list.reload} refreshing={list.refreshing}>
      <StatRow>
        <StatCard icon="🛒" label={tf('sup_totalPurchases')} value={inr(s.totalPurchases)} />
        <StatCard icon="⏳" label={tf('sup_due')} value={inr(s.due)} tone={num(s.due) > 0 ? 'red' : 'green'} />
      </StatRow>
      {!!error && <ErrorBox message={error} />}
      <BtnRow>
        <Btn small kind="secondary" icon="✏️" title={t('common_edit')} onPress={() => setEdit(true)} />
        <Btn small kind="danger" icon="🗑️" title={tf('common_delete')} onPress={remove} />
      </BtnRow>
      <SectionTitle>{tf('pur_history')}</SectionTitle>
      <Gate loading={list.loading} error={list.error} onRetry={list.reload}>
        {!list.items.length && <Empty text={t('common_noRecords')} />}
        {list.items.map((p: any) => (
          <ListItem key={p.id} title={fmtDate(p.transactionDate)} subtitle={p.items.map((i: any) => `${i.productName} ${qty(i.enteredQty)} ${i.unitName}`).join(', ')} right={inr(p.totalAmount)}
            badge={p.status === 'Posted' ? (num(p.due) > 0 ? 'Pending' : undefined) : p.status} onPress={() => push('purchaseDetail', { id: p.id })} />
        ))}
        <LoadMore list={list} />
      </Gate>
      <FormSheet visible={edit} title={tf('sup_edit')} fields={fields} initial={s} onClose={() => setEdit(false)}
        onSubmit={async v => { const r = await api.put(`/suppliers/${s.id}`, v); bump(); Object.assign(s, r.supplier); toast(tf('common_saved')); return r; }} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Categories and units
// ---------------------------------------------------------------------------
export function CategoriesScreen() {
  const { api, t, tf, c, meta, bump, toast } = useFood();
  const [editing, setEditing] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const fields: FieldSpec[] = [{ key: 'name', label: tf('cat_name'), required: true, maxLength: 80 }];
  const remove = async (x: any) => {
    if (!(await confirmDialog(tf('common_delete'), x.name, tf('common_delete'), t('common_cancel'), true))) return;
    try { await api.del(`/categories/${x.id}`); bump(); toast(tf('common_deleted')); } catch (e) { setError(errorText(t, e)); }
  };
  return (
    <Screen title={tf('cat_title')} right={<Btn small icon="＋" title={tf('common_add')} onPress={() => setEditing({})} />}>
      {!!error && <ErrorBox message={error} />}
      {(meta?.categories || []).map(x => (
        <Card key={x.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: c.text, fontWeight: '700' }}>{x.name}</Text>
            <Btn small kind="ghost" title={t('common_edit')} onPress={() => setEditing(x)} />
            <Btn small kind="ghost" title={tf('common_delete')} onPress={() => remove(x)} />
          </View>
        </Card>
      ))}
      <FormSheet visible={!!editing} title={editing?.id ? tf('cat_edit') : tf('cat_add')} fields={fields} initial={editing || {}} onClose={() => setEditing(null)}
        onSubmit={async v => { const r = editing?.id ? await api.put(`/categories/${editing.id}`, v) : await api.post('/categories', v); bump(); toast(tf('common_saved')); return r; }} />
    </Screen>
  );
}

export function UnitsScreen() {
  const { api, t, tf, c, meta, bump, toast } = useFood();
  const [editing, setEditing] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const dims = [
    { value: 'custom', label: tf('unit_custom') }, { value: 'mass', label: tf('unit_mass') }, { value: 'volume', label: tf('unit_volume') }, { value: 'count', label: tf('unit_count') },
  ];
  const fields: FieldSpec[] = [
    { key: 'name', label: tf('unit_name'), required: true, maxLength: 40 },
    { key: 'dimension', label: tf('unit_kind'), type: 'select', options: dims, help: tf('unit_kindHelp') },
    { key: 'toBase', label: tf('unit_toBase'), type: 'decimal', min: 0.000001, help: tf('unit_toBaseHelp') },
  ];
  const remove = async (x: any) => {
    if (!(await confirmDialog(tf('common_delete'), x.name, tf('common_delete'), t('common_cancel'), true))) return;
    try { await api.del(`/units/${x.id}`); bump(); toast(tf('common_deleted')); } catch (e) { setError(errorText(t, e)); }
  };
  return (
    <Screen title={tf('unit_title')} right={<Btn small icon="＋" title={tf('common_add')} onPress={() => setEditing({ dimension: 'custom', toBase: 1 })} />}>
      {!!error && <ErrorBox message={error} />}
      {(meta?.units || []).map(x => (
        <Card key={x.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: '700' }}>{x.name}</Text>
              <Text style={{ color: c.muted, fontSize: 12 }}>{dims.find(d => d.value === x.dimension)?.label}</Text>
            </View>
            <Btn small kind="ghost" title={t('common_edit')} onPress={() => setEditing(x)} />
            <Btn small kind="ghost" title={tf('common_delete')} onPress={() => remove(x)} />
          </View>
        </Card>
      ))}
      <FormSheet visible={!!editing} title={editing?.id ? tf('unit_edit') : tf('unit_add')} fields={fields} initial={editing || {}} onClose={() => setEditing(null)}
        onSubmit={async v => { const r = editing?.id ? await api.put(`/units/${editing.id}`, v) : await api.post('/units', v); bump(); toast(tf('common_saved')); return r; }} />
    </Screen>
  );
}

export function SettingsScreen() {
  const { api, t, tf, meta, bump, back, toast } = useFood();
  const [values, setValues] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (meta?.settings) setValues(meta.settings);
  }, [meta?.settings]);
  const fields: FieldSpec[] = [
    { key: 'allowNegativeStock', label: tf('set_allowNegative'), type: 'switch', help: tf('set_allowNegativeHelp') },
    { key: 'coverDays', label: tf('set_coverDays'), type: 'number', min: 1, max: 30, help: tf('set_coverDaysHelp') },
    { key: 'excessRatio', label: tf('set_excessRatio'), type: 'decimal', min: 1, help: tf('set_excessRatioHelp') },
    { key: 'unusualExpenseRatio', label: tf('set_expenseRatio'), type: 'decimal', min: 1, help: tf('set_expenseRatioHelp') },
  ];
  const save = async () => {
    setBusy(true);
    setError(null);
    try { await api.put('/settings', values); bump(); toast(tf('common_saved')); back(); } catch (e) { setError(errorText(t, e)); } finally { setBusy(false); }
  };
  return (
    <Screen title={tf('set_title')}>
      {fields.map(f => <Field key={f.key} spec={f} value={values[f.key]} onChange={v => setValues(p => ({ ...p, [f.key]: v }))} />)}
      {!!error && <ErrorBox message={error} />}
      <Btn title={t('common_save')} onPress={save} busy={busy} />
    </Screen>
  );
}
