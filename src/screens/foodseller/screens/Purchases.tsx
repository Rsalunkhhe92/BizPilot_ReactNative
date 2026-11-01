import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fmtDate, inr, isoToday, monthStartIso } from '../../bachatgat/format';
import {
  Badge, Btn, Card, Chips, Empty, ErrorBox, Field, Gate, Grid, KV, ListItem, LoadMore, NumInput, Notice, Screen, SectionTitle, SelectInput, StatCard, StatRow, confirmDialog,
  nextRowId, num, qty, unitsFor, useFood, useLoad, usePaged, useStockSubmit,
} from '../ui';

export function PurchasesScreen() {
  const { api, tf, t, c, push, meta } = useFood();
  const [period, setPeriod] = useState<'today' | 'month'>('today');
  const [supplier, setSupplier] = useState('');
  const from = period === 'today' ? isoToday() : monthStartIso();
  const list = usePaged(async page => {
    const r = await api.get('/purchases', { from, to: isoToday(), supplierId: supplier, page });
    return { items: r.purchases as any[], hasMore: r.hasMore };
  }, [from, supplier]);
  const posted = list.items.filter((p: any) => p.status === 'Posted');
  const total = posted.reduce((sum: number, p: any) => sum + num(p.totalAmount), 0);
  const due = posted.reduce((sum: number, p: any) => sum + num(p.due), 0);
  return (
    <Screen title={tf('pur_title')} noBack onRefresh={list.reload} refreshing={list.refreshing}
      right={<Btn small icon="＋" title={tf('pur_new')} onPress={() => push('purchaseForm')} />}>
      <Chips value={period} onChange={setPeriod} options={[{ value: 'today', label: t('common_today') }, { value: 'month', label: tf('common_thisMonth') }]} />
      {!!meta?.suppliers.length && (
        <Chips value={supplier} onChange={setSupplier} options={[{ value: '', label: tf('pur_allSuppliers') }, ...meta.suppliers.map(s => ({ value: String(s.id), label: s.name }))]} />
      )}
      <StatRow>
        <StatCard icon="🛒" label={tf('pur_total')} value={inr(total)} tone="blue" />
        <StatCard icon="⏳" label={tf('pur_due')} value={inr(due)} tone={due > 0 ? 'red' : 'green'} />
      </StatRow>
      <Notice tone="blue" text={tf('pur_note')} />
      <Gate loading={list.loading} error={list.error} onRetry={list.reload}>
        {!list.items.length && <Empty text={tf('pur_empty')} action={tf('pur_new')} onAction={() => push('purchaseForm')} />}
        <Grid>
          {list.items.map((p: any) => (
            <Card key={p.id} onPress={() => push('purchaseDetail', { id: p.id })} a11y={`${fmtDate(p.transactionDate)} ${inr(p.totalAmount)}`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: c.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>{p.supplierName || tf('pur_noSupplier')}</Text>
                <Text style={{ color: c.text, fontWeight: '800' }}>{inr(p.totalAmount)}</Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>{fmtDate(p.transactionDate)} · {tf(`pay_${String(p.paymentMethod).toLowerCase()}` as any)}</Text>
              <Text style={{ color: c.sub, fontSize: 13, marginTop: 6 }} numberOfLines={2}>{p.items.map((i: any) => `${i.productName} ${qty(i.enteredQty)} ${i.unitName}`).join(', ')}</Text>
              {(p.status !== 'Posted' || num(p.due) > 0) && (
                <View style={{ marginTop: 6 }}>{p.status !== 'Posted' ? <Badge value="Reversed" label={tf('st_voided')} /> : <Badge value="Pending" label={`${tf('sup_due')} ${inr(p.due)}`} />}</View>
              )}
            </Card>
          ))}
        </Grid>
        <LoadMore list={list} />
      </Gate>
    </Screen>
  );
}

interface Row { id: string; productId: string; quantity: string; unitId: string; rate: string }

export function PurchaseFormScreen({ params }: { params?: { items?: any[]; supplierId?: number } }) {
  const { api, t, tf, c, back, bump, toast, meta } = useFood();
  const products = useLoad(() => api.get('/products', { status: 'Active' }), []);
  const productList: any[] = (products.data as any)?.products || [];
  const [date, setDate] = useState(isoToday());
  const [supplierId, setSupplierId] = useState(params?.supplierId ? String(params.supplierId) : '');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [method, setMethod] = useState<'Cash' | 'UPI' | 'Credit'>('Cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [rows, setRows] = useState<Row[]>(() => (params?.items?.length
    ? params.items.map(i => ({ id: nextRowId(), productId: String(i.productId), quantity: String(i.quantity), unitId: i.unitId ? String(i.unitId) : '', rate: String(i.rate ?? '') }))
    : [{ id: nextRowId(), productId: '', quantity: '', unitId: '', rate: '' }]));
  const [problem, setProblem] = useState<string | null>(null);
  const { send, busy, pending, error } = useStockSubmit();
  const productOptions = useMemo(() => productList.map(p => ({ value: String(p.id), label: `${p.name} (${qty(p.stockQty)} ${p.unitName})` })), [productList]);
  const update = (id: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const pick = (id: string, productId: string) => {
    const product = productList.find(p => String(p.id) === productId);
    update(id, { productId, unitId: product ? String(product.unitId) : '', rate: product && num(product.purchasePrice) > 0 ? String(product.purchasePrice) : '' });
  };
  const total = rows.reduce((sum, r) => sum + num(r.quantity) * num(r.rate), 0);

  const save = async () => {
    const filled = rows.filter(r => r.productId);
    if (!filled.length || filled.some(r => num(r.quantity) <= 0 || r.rate === '')) { setProblem(tf('pur_rowsProblem')); return; }
    setProblem(null);
    const body: any = { date, supplierId: supplierId || undefined, invoiceNo, paymentMethod: method, items: filled.map(r => ({ productId: r.productId, quantity: r.quantity, unitId: r.unitId, rate: r.rate })) };
    if (method === 'Credit' && amountPaid !== '') body.amountPaid = amountPaid;
    const r = await send((key, extra) => api.post('/purchases', { ...body, ...extra }, key));
    if (r) { bump(); toast(tf('pur_saved', { total: inr(r.purchase.totalAmount) })); back(); }
  };

  return (
    <Screen title={tf('pur_new')}>
      <Gate loading={products.loading} error={products.error} onRetry={products.reload}>
        {!productList.length ? <Notice text={tf('pur_addProductFirst')} /> : (
          <>
            <Field spec={{ key: 'date', label: tf('common_date'), type: 'date' }} value={date} onChange={setDate} />
            <Field spec={{ key: 'supplier', label: tf('prod_supplier'), type: 'select', options: [{ value: '', label: tf('pur_noSupplier') }, ...(meta?.suppliers || []).map(s => ({ value: String(s.id), label: s.name }))] }} value={supplierId} onChange={setSupplierId} />
            <SectionTitle>{tf('pur_items')}</SectionTitle>
            {rows.map(row => {
              const product = productList.find(p => String(p.id) === row.productId);
              const units = unitsFor(product, meta?.units || []);
              return (
                <Card key={row.id}>
                  <SelectInput value={row.productId} onChange={v => pick(row.id, v)} options={productOptions} label={tf('common_product')} placeholder={tf('common_selectProduct')} />
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
                    <NumInput label={tf('common_quantity')} value={row.quantity} onChange={v => update(row.id, { quantity: v })} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>{tf('prod_unit')}</Text>
                      <SelectInput value={row.unitId} onChange={v => update(row.id, { unitId: v })} options={units.map(u => ({ value: String(u.id), label: u.name }))} label={tf('prod_unit')} />
                    </View>
                    <NumInput label={tf('pur_rate')} prefix="₹" value={row.rate} onChange={v => update(row.id, { rate: v })} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <Text style={{ color: c.text, fontWeight: '800' }}>{tf('common_total')}: {inr(num(row.quantity) * num(row.rate))}</Text>
                    {rows.length > 1 && (
                      <Pressable onPress={() => setRows(rs => rs.filter(r => r.id !== row.id))} hitSlop={10} accessibilityRole="button" accessibilityLabel={tf('common_removeRow')} style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 8 }}>
                        <Text style={{ color: c.red, fontWeight: '700' }}>✕ {tf('common_remove')}</Text>
                      </Pressable>
                    )}
                  </View>
                </Card>
              );
            })}
            <Btn kind="secondary" icon="＋" title={tf('common_addRow')} onPress={() => setRows(rs => [...rs, { id: nextRowId(), productId: '', quantity: '', unitId: '', rate: '' }])} />

            <SectionTitle>{tf('pur_payment')}</SectionTitle>
            <Chips value={method} onChange={setMethod} options={[{ value: 'Cash', label: tf('pay_cash') }, { value: 'UPI', label: tf('pay_upi') }, { value: 'Credit', label: tf('pay_credit') }]} />
            {method === 'Credit' && <Field spec={{ key: 'paid', label: tf('pur_paidNow'), type: 'money', help: tf('pur_paidNowHelp') }} value={amountPaid} onChange={setAmountPaid} />}
            <Field spec={{ key: 'invoice', label: tf('pur_invoice'), maxLength: 60 }} value={invoiceNo} onChange={setInvoiceNo} />

            <Card style={{ backgroundColor: c.brandBg, marginTop: 8 }}>
              <KV label={tf('pur_grandTotal')} value={inr(total)} strong />
            </Card>
            {!!problem && <ErrorBox message={problem} />}
            {!!error && <ErrorBox message={error} />}
            <Btn title={pending ? t('common_retrySame') : tf('pur_save')} onPress={save} busy={busy} />
          </>
        )}
      </Gate>
    </Screen>
  );
}

export function PurchaseDetailScreen({ params }: { params: { id: number } }) {
  const { api, t, tf, c, bump, toast, back, st } = useFood();
  const { data, loading, error, reload } = useLoad(() => api.get(`/purchases/${params.id}`), [params.id]);
  const p = (data as any)?.purchase;
  const { send, busy, error: voidError } = useStockSubmit();
  const voidIt = async () => {
    if (!(await confirmDialog(tf('common_void'), tf('pur_voidHint'), tf('common_void'), t('common_cancel'), true))) return;
    const r = await send((key, extra) => api.post(`/purchases/${params.id}/void`, extra, key));
    if (r) { bump(); toast(tf('common_voided')); back(); }
  };
  return (
    <Screen title={tf('pur_detail')} onRefresh={reload}>
      <Gate loading={loading} error={error} onRetry={reload}>
        {p && (
          <>
            <Card>
              <KV label={tf('common_date')} value={fmtDate(p.transactionDate)} />
              <KV label={tf('prod_supplier')} value={p.supplierName || tf('pur_noSupplier')} />
              {!!p.invoiceNo && <KV label={tf('pur_invoice')} value={p.invoiceNo} />}
              <KV label={tf('pur_grandTotal')} value={inr(p.totalAmount)} strong />
              <KV label={tf('pur_paid')} value={`${inr(num(p.totalAmount) - num(p.due))} · ${tf(`pay_${String(p.paymentMethod).toLowerCase()}` as any)}`} />
              {num(p.due) > 0 && <KV label={tf('sup_due')} value={inr(p.due)} color={c.red} strong />}
              <KV label={t('common_status')} value={st(p.status)} />
            </Card>
            <SectionTitle>{tf('pur_items')}</SectionTitle>
            {p.items.map((i: any) => (
              <ListItem key={i.id} title={i.productName} subtitle={`${qty(i.enteredQty)} ${i.unitName} × ${inr(i.rate)}`} right={inr(i.total)} />
            ))}
            {!!voidError && <ErrorBox message={voidError} />}
            {p.status === 'Posted' && <Btn kind="danger" title={tf('common_void')} onPress={voidIt} busy={busy} />}
          </>
        )}
      </Gate>
    </Screen>
  );
}
