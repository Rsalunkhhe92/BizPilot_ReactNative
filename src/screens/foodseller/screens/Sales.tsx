import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fmtDate, inr, isoToday, monthStartIso } from '../../bachatgat/format';
import {
  Badge, Btn, BtnRow, Card, Chips, Empty, ErrorBox, Field, FormSheet, Gate, Grid, KV, ListItem, LoadMore, NumInput, Notice, Screen, SearchBar, SectionTitle, StatCard, StatRow, FieldSpec, confirmDialog,
  num, qty, useFood, useLoad, usePaged, useStockSubmit,
} from '../ui';

export function SalesScreen() {
  const { api, t, tf, c, push } = useFood();
  const [period, setPeriod] = useState<'today' | 'month'>('today');
  const from = period === 'today' ? isoToday() : monthStartIso();
  const list = usePaged(async page => {
    const r = await api.get('/sales', { from, to: isoToday(), page, pageSize: 50 });
    return { items: r.sales as any[], hasMore: r.hasMore };
  }, [from]);
  const posted = list.items.filter((s: any) => s.status === 'Posted');
  const sum = (key: string) => posted.reduce((acc: number, s: any) => acc + num(s[key]), 0);
  const totalQty = posted.reduce((acc: number, s: any) => acc + s.items.reduce((a: number, i: any) => a + num(i.quantity), 0), 0);
  return (
    <Screen title={tf('sale_title')} noBack onRefresh={list.reload} refreshing={list.refreshing}
      right={<Btn small icon="＋" title={tf('sale_new')} onPress={() => push('saleForm')} />}>
      <Chips value={period} onChange={setPeriod} options={[{ value: 'today', label: t('common_today') }, { value: 'month', label: tf('common_thisMonth') }]} />
      <StatRow>
        <StatCard icon="💰" label={tf('sale_total')} value={inr(sum('totalAmount'))} tone="green" />
        <StatCard icon="🍽️" label={tf('sale_qty')} value={qty(totalQty)} />
        <StatCard icon="💵" label={tf('pay_cash')} value={inr(sum('cashAmount'))} />
        <StatCard icon="📱" label={tf('pay_upi')} value={inr(sum('upiAmount'))} />
        <StatCard icon="📒" label={tf('pay_credit')} value={inr(sum('creditAmount'))} tone="amber" />
        <StatCard icon="🏷️" label={tf('sale_discount')} value={inr(sum('discount'))} />
        <StatCard icon="⏳" label={tf('sale_pending')} value={inr(sum('pending'))} tone={sum('pending') > 0 ? 'red' : 'brand'} onPress={() => push('pending')} />
      </StatRow>
      <BtnRow>
        <Btn small kind="secondary" icon="⏳" title={tf('pend_title')} onPress={() => push('pending')} />
      </BtnRow>
      <SectionTitle>{tf('sale_entries')}</SectionTitle>
      <Gate loading={list.loading} error={list.error} onRetry={list.reload}>
        {!list.items.length && <Empty text={tf('sale_empty')} action={tf('sale_new')} onAction={() => push('saleForm')} />}
        <Grid>
          {list.items.map((s: any) => (
            <Card key={s.id} onPress={() => push('saleDetail', { id: s.id })} a11y={`${fmtDate(s.transactionDate)} ${inr(s.totalAmount)}`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: c.text, fontWeight: '700', flex: 1 }} numberOfLines={2}>{s.items.map((i: any) => `${i.foodName} × ${qty(i.quantity)}`).join(', ')}</Text>
                <Text style={{ color: c.text, fontWeight: '800' }}>{inr(s.totalAmount)}</Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>
                {fmtDate(s.transactionDate)}{s.customerName ? ` · ${s.customerName}` : ''}
              </Text>
              {(s.status !== 'Posted' || num(s.pending) > 0) && (
                <View style={{ marginTop: 6 }}>{s.status !== 'Posted' ? <Badge value="Reversed" label={tf('st_voided')} /> : <Badge value="Pending" label={`${tf('sale_pending')} ${inr(s.pending)}`} />}</View>
              )}
            </Card>
          ))}
        </Grid>
        <LoadMore list={list} />
      </Gate>
    </Screen>
  );
}

type Mode = 'Cash' | 'UPI' | 'Credit' | 'Split';

export function SaleFormScreen() {
  const { api, t, tf, c, back, bump, toast, push } = useFood();
  const foods = useLoad(() => api.get('/food-products', { status: 'Active' }), []);
  const list: any[] = (foods.data as any)?.foods || [];
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Record<string, { qty: string; price: string }>>({});
  const [date, setDate] = useState(isoToday());
  const [discount, setDiscount] = useState('');
  const [mode, setMode] = useState<Mode>('Cash');
  const [customer, setCustomer] = useState('');
  const [cash, setCash] = useState('');
  const [upi, setUpi] = useState('');
  const [credit, setCredit] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const { send, busy, pending, error } = useStockSubmit();

  const chosen = list.filter(f => cart[f.id] && num(cart[f.id].qty) > 0);
  const subtotal = chosen.reduce((sum, f) => sum + num(cart[f.id].qty) * num(cart[f.id].price), 0);
  const total = Math.max(subtotal - num(discount), 0);
  const change = (food: any, delta: number) => setCart(cur => {
    const next = Math.max(num(cur[food.id]?.qty) + delta, 0);
    return { ...cur, [food.id]: { qty: next ? String(next) : '', price: cur[food.id]?.price ?? String(food.sellingPrice) } };
  });
  const visible = q ? list.filter(f => f.name.toLowerCase().includes(q.toLowerCase())) : list;
  const splitTotal = num(cash) + num(upi) + num(credit);

  const save = async () => {
    if (!chosen.length) { setProblem(tf('sale_pickItems')); return; }
    if (mode === 'Credit' && !customer.trim()) { setProblem(tf('sale_needCustomer')); return; }
    if (mode === 'Split' && Math.abs(splitTotal - total) > 0.001) { setProblem(tf('sale_splitProblem', { total: inr(total) })); return; }
    setProblem(null);
    const body: any = {
      date, discount: discount || 0, customerName: customer,
      items: chosen.map(f => ({ foodProductId: f.id, quantity: cart[f.id].qty, price: cart[f.id].price })),
    };
    if (mode === 'Split') Object.assign(body, { cashAmount: cash || 0, upiAmount: upi || 0, creditAmount: credit || 0 });
    else body.paymentMode = mode;
    const r = await send((key, extra) => api.post('/sales', { ...body, ...extra }, key));
    if (r) {
      bump();
      if (r.alerts.length) toast(tf('stock_alertToast', { items: r.alerts.map((a: any) => a.name).join(', ') }), 'error');
      else toast(tf('sale_saved', { total: inr(r.sale.totalAmount) }));
      back();
    }
  };

  return (
    <Screen title={tf('sale_new')}>
      <Gate loading={foods.loading} error={foods.error} onRetry={foods.reload}>
        {!list.length ? (
          <>
            <Notice text={tf('sale_addFoodFirst')} />
            <Btn title={tf('menu_add')} onPress={() => push('foodForm')} />
          </>
        ) : (
          <>
            <Field spec={{ key: 'date', label: tf('common_date'), type: 'date' }} value={date} onChange={setDate} />
            {list.length > 6 && <SearchBar value={q} onChange={setQ} placeholder={tf('menu_search')} />}
            <Grid>
              {visible.map(f => {
                const entry = cart[f.id];
                const count = num(entry?.qty);
                return (
                  <View key={f.id} style={{ backgroundColor: count > 0 ? c.brandBg : c.card, borderColor: count > 0 ? c.brand : c.border, borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ color: c.text, fontWeight: '800' }} numberOfLines={1}>{f.name}</Text>
                        <Text style={{ color: c.muted, fontSize: 12 }}>{inr(f.sellingPrice)}{f.availableQty !== null && f.availableQty !== undefined ? ` · ${tf('menu_canMake', { count: f.availableQty })}` : ''}</Text>
                        {!f.hasCostSource && <Text style={{ color: c.amber, fontSize: 11 }}>{tf('menu_noRecipe')}</Text>}
                      </View>
                      <Pressable onPress={() => change(f, -1)} disabled={!count} accessibilityRole="button" accessibilityLabel={`${tf('sale_less')} ${f.name}`}
                        style={{ width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', opacity: count ? 1 : 0.4 }}>
                        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700' }}>−</Text>
                      </Pressable>
                      <View style={{ width: 64 }}>
                        <NumInput label={tf('common_qtyShort')} value={entry?.qty ?? ''} onChange={v => setCart(cur => ({ ...cur, [f.id]: { qty: v, price: cur[f.id]?.price ?? String(f.sellingPrice) } }))} />
                      </View>
                      <Pressable onPress={() => change(f, 1)} accessibilityRole="button" accessibilityLabel={`${tf('sale_more')} ${f.name}`}
                        style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: c.onBrand, fontSize: 22, fontWeight: '700' }}>＋</Text>
                      </Pressable>
                    </View>
                    {count > 0 && (
                      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginTop: 6 }}>
                        <NumInput label={tf('sale_price')} prefix="₹" value={entry?.price} onChange={v => setCart(cur => ({ ...cur, [f.id]: { ...cur[f.id], price: v } }))} />
                        <View style={{ flex: 1, alignItems: 'flex-end', paddingBottom: 12 }}>
                          <Text style={{ color: c.text, fontWeight: '800' }}>{inr(count * num(entry?.price))}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </Grid>

            <SectionTitle>{tf('sale_payment')}</SectionTitle>
            <Chips value={mode} onChange={setMode} options={[
              { value: 'Cash', label: tf('pay_cash') }, { value: 'UPI', label: tf('pay_upi') }, { value: 'Credit', label: tf('pay_credit') }, { value: 'Split', label: tf('pay_split') },
            ]} />
            {mode === 'Split' && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <NumInput label={tf('pay_cash')} prefix="₹" value={cash} onChange={setCash} />
                <NumInput label={tf('pay_upi')} prefix="₹" value={upi} onChange={setUpi} />
                <NumInput label={tf('pay_credit')} prefix="₹" value={credit} onChange={setCredit} />
              </View>
            )}
            <View style={{ height: 8 }} />
            {(mode === 'Credit' || (mode === 'Split' && num(credit) > 0)) && (
              <Field spec={{ key: 'customer', label: tf('sale_customer'), required: true, maxLength: 120 }} value={customer} onChange={setCustomer} />
            )}
            <Field spec={{ key: 'discount', label: tf('sale_discount'), type: 'money' }} value={discount} onChange={v => setDiscount(v)} />

            <Card style={{ backgroundColor: c.brandBg }}>
              <KV label={tf('sale_subtotal')} value={inr(subtotal)} />
              {num(discount) > 0 && <KV label={tf('sale_discount')} value={`-${inr(discount)}`} />}
              <KV label={tf('sale_payable')} value={inr(total)} strong />
              {mode === 'Split' && <KV label={tf('sale_entered')} value={inr(splitTotal)} color={Math.abs(splitTotal - total) > 0.001 ? c.red : c.green} />}
            </Card>
            {!!problem && <ErrorBox message={problem} />}
            {!!error && <ErrorBox message={error} />}
            <Btn title={pending ? t('common_retrySame') : tf('sale_save')} onPress={save} busy={busy} />
          </>
        )}
      </Gate>
    </Screen>
  );
}

export function SaleDetailScreen({ params }: { params: { id: number } }) {
  const { api, t, tf, c, bump, toast, back, st } = useFood();
  const { data, loading, error, reload } = useLoad(() => api.get(`/sales/${params.id}`), [params.id]);
  const s = (data as any)?.sale;
  const { send, busy, error: voidError } = useStockSubmit();
  const voidIt = async () => {
    if (!(await confirmDialog(tf('common_void'), tf('sale_voidHint'), tf('common_void'), t('common_cancel'), true))) return;
    const r = await send((key, extra) => api.post(`/sales/${params.id}/void`, extra, key));
    if (r) { bump(); toast(tf('common_voided')); back(); }
  };
  return (
    <Screen title={tf('sale_detail')} onRefresh={reload}>
      <Gate loading={loading} error={error} onRetry={reload}>
        {s && (
          <>
            <Card>
              <KV label={tf('common_date')} value={fmtDate(s.transactionDate)} />
              {!!s.customerName && <KV label={tf('sale_customer')} value={s.customerName} />}
              <KV label={tf('sale_subtotal')} value={inr(s.subtotal)} />
              {num(s.discount) > 0 && <KV label={tf('sale_discount')} value={`-${inr(s.discount)}`} />}
              <KV label={tf('sale_payable')} value={inr(s.totalAmount)} strong />
              {num(s.cashAmount) > 0 && <KV label={tf('pay_cash')} value={inr(s.cashAmount)} />}
              {num(s.upiAmount) > 0 && <KV label={tf('pay_upi')} value={inr(s.upiAmount)} />}
              {num(s.creditAmount) > 0 && <KV label={tf('pay_credit')} value={inr(s.creditAmount)} />}
              {num(s.pending) > 0 && <KV label={tf('sale_pending')} value={inr(s.pending)} color={c.red} strong />}
              <KV label={t('common_status')} value={st(s.status)} />
            </Card>
            <SectionTitle>{tf('sale_items')}</SectionTitle>
            {s.items.map((i: any) => <ListItem key={i.id} title={i.foodName} subtitle={`${qty(i.quantity)} × ${inr(i.price)}`} right={inr(i.total)} />)}
            {!!voidError && <ErrorBox message={voidError} />}
            {s.status === 'Posted' && <Btn kind="danger" title={tf('common_void')} onPress={voidIt} busy={busy} />}
          </>
        )}
      </Gate>
    </Screen>
  );
}

export function PendingScreen() {
  const { api, tf, c, bump, toast } = useFood();
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get('/payments/pending'), []);
  const d = data as any;
  const [settling, setSettling] = useState<any>(null);
  const fields: FieldSpec[] = [
    { key: 'amount', label: tf('pend_amount'), type: 'money', required: true },
    { key: 'paymentMethod', label: tf('pend_method'), type: 'select', options: [{ value: 'Cash', label: tf('pay_cash') }, { value: 'UPI', label: tf('pay_upi') }] },
  ];
  return (
    <Screen title={tf('pend_title')} onRefresh={reload} refreshing={refreshing}>
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {d && (
          <>
            <StatRow>
              <StatCard icon="⏳" label={tf('dash_toCollect')} value={inr(d.receivableTotal)} tone={num(d.receivableTotal) > 0 ? 'red' : 'green'} />
              <StatCard icon="🏪" label={tf('dash_toPay')} value={inr(d.payableTotal)} tone={num(d.payableTotal) > 0 ? 'amber' : 'green'} />
            </StatRow>
            <SectionTitle>{tf('dash_toCollect')}</SectionTitle>
            {!d.receivable.length && <Text style={{ color: c.muted, marginBottom: 8 }}>{tf('pend_none')}</Text>}
            <Grid>
              {d.receivable.map((s: any) => (
                <ListItem key={s.id} title={s.customerName || '-'} subtitle={fmtDate(s.transactionDate)} right={inr(s.pending)} onPress={() => setSettling({ direction: 'RECEIVED', saleId: s.id, amount: s.pending, title: s.customerName })} />
              ))}
            </Grid>
            <SectionTitle>{tf('dash_toPay')}</SectionTitle>
            {!d.payable.length && <Text style={{ color: c.muted, marginBottom: 8 }}>{tf('pend_none')}</Text>}
            <Grid>
              {d.payable.map((p: any) => (
                <ListItem key={p.id} title={p.supplierName || tf('pur_noSupplier')} subtitle={fmtDate(p.transactionDate)} right={inr(p.due)} onPress={() => setSettling({ direction: 'PAID', purchaseId: p.id, amount: p.due, title: p.supplierName })} />
              ))}
            </Grid>
          </>
        )}
      </Gate>
      <FormSheet visible={!!settling} title={settling?.direction === 'RECEIVED' ? tf('pend_collect') : tf('pend_pay')} fields={fields}
        initial={settling ? { amount: settling.amount, paymentMethod: 'Cash' } : {}} onClose={() => setSettling(null)} notice={settling?.title || undefined}
        onSubmit={async (values, key) => {
          const r = await api.post('/payments', { direction: settling.direction, saleId: settling.saleId, purchaseId: settling.purchaseId, ...values }, key);
          bump();
          toast(tf('common_saved'));
          return r;
        }} />
    </Screen>
  );
}
