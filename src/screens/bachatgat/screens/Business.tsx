import React, { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { fmtDate, fyStartIso, inr, isoToday } from '../format';
import {
  Badge, Btn, BtnRow, Card, Chips, ErrorBox, FieldSpec, Form, FormSheet, Gate, KV, ListItem, Notice, Screen, SectionTitle,
  SelectInput, Stat, StatGrid, confirm, useLoad, useShg, useSubmit, validate,
} from '../ui';
import { GroupPicker, NeedGroup } from './Members';
import { paymentFields, useBankOptions } from './Savings';
import { TxnItem } from './Dashboard';

export function BusinessScreen() {
  const { api, t, push, groupId } = useShg();
  const { data, loading, error, reload, refreshing } = useLoad(() => groupId ? api.get('/business/activities', { groupId }) : Promise.resolve(null), [groupId]);
  const [open, setOpen] = useState(false);
  const d = data as any;
  return (
    <Screen title={t('nav_business')} onRefresh={reload} refreshing={refreshing}
      right={groupId ? <Btn small title={`+ ${t('biz_add')}`} onPress={() => setOpen(true)} /> : undefined}>
      <GroupPicker />
      <NeedGroup>
        <Gate loading={loading && !d} error={error} onRetry={reload} empty={!!d && !d.activities.length} emptyText={t('biz_none')}>
          {d?.activities.map((a: any) => (
            <ListItem key={a.id} title={a.name} subtitle={`${a.activityType} · ${t('biz_products', { n: a.productCount })}`}
              right={inr(a.netCash)} badge={a.status} onPress={() => push('activityDetail', { id: a.id })} />
          ))}
        </Gate>
      </NeedGroup>
      <FormSheet visible={open} title={t('biz_add')} onClose={() => setOpen(false)} initial={{ startDate: isoToday() }}
        fields={[
          { key: 'name', label: t('common_name'), required: true },
          { key: 'activityType', label: t('common_type'), type: 'select', required: true, options: (d?.activityTypes || []).map((x: string) => ({ value: x, label: x })) },
          { key: 'description', label: t('common_description'), type: 'multiline' },
          { key: 'startDate', label: t('biz_startDate'), type: 'date' },
        ]}
        onSubmit={async v => { const r = await api.post('/business/activities', { ...v, groupId }); reload(); push('activityDetail', { id: r.activity.id }); return r; }} />
    </Screen>
  );
}

type BizTab = 'overview' | 'products' | 'orders' | 'work' | 'assets';

export function ActivityDetailScreen({ params }: { params: { id: number } }) {
  const { api, t, push, c, bump } = useShg();
  const [tab, setTab] = useState<BizTab>('overview');
  const [from] = useState(fyStartIso());
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get(`/business/activities/${params.id}`, { from, to: isoToday() }), [params.id, from]);
  const d = data as any;
  const a = d?.activity;
  const [sheet, setSheet] = useState<string | null>(null);
  const [product, setProduct] = useState<any>(null);
  const [selectedWork, setSelectedWork] = useState<Record<number, boolean>>({});
  const members = useLoad(() => a ? api.get('/members', { groupId: a.groupId, status: 'Active', pageSize: 100 }) : Promise.resolve(null), [a?.groupId]);
  const memberOptions = ((members.data as any)?.members || []).map((m: any) => ({ value: String(m.id), label: `#${m.memberNumber} ${m.fullName}` }));
  const pay = useSubmit();
  const unpaid = (d?.work || []).filter((w: any) => !w.paidTxnId && Number(w.earnings) > 0);
  const productOptions = (kind?: string) => (d?.products || []).filter((p: any) => p.active && (!kind || p.kind === kind))
    .map((p: any) => ({ value: String(p.id), label: `${p.name} (${p.stockQty} ${p.unit})` }));

  const payWork = async () => {
    const ids = Object.entries(selectedWork).filter(([, v]) => v).map(([k]) => Number(k));
    if (!ids.length) return;
    const total = unpaid.filter((w: any) => ids.includes(w.id)).reduce((s: number, w: any) => s + Number(w.earnings), 0);
    confirm(t('biz_payEarnings'), inr(total), t('common_confirm'), t('common_cancel'), async () => {
      const r = await pay.submit(key => api.post('/business/work/pay', { workIds: ids, paymentMethod: 'Cash' }, key));
      if (r) { setSelectedWork({}); reload(); bump(); }
    });
  };

  return (
    <Screen title={a?.name || t('nav_business')} subtitle={a?.activityType} onRefresh={reload} refreshing={refreshing}>
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {a && (
          <>
            <Chips<BizTab> value={tab} onChange={setTab} options={[
              { value: 'overview', label: t('biz_pl') }, { value: 'products', label: t('biz_inventory') }, { value: 'orders', label: t('biz_orders') },
              { value: 'work', label: t('biz_work') }, { value: 'assets', label: t('biz_assets') },
            ]} />
            <View style={{ height: 10 }} />
            {tab === 'overview' && (
              <>
                <StatGrid>
                  <Stat label={t('biz_cashIncome')} value={inr(d.profitLoss.cashBasis.income)} tone="green" />
                  <Stat label={t('biz_cashExpense')} value={inr(d.profitLoss.cashBasis.expenses)} tone="red" />
                  <Stat label={t('biz_profit')} value={inr(d.profitLoss.cashBasis.profit)} tone={d.profitLoss.cashBasis.profit >= 0 ? 'green' : 'red'} />
                  <Stat label={t('biz_stockValue')} value={inr(d.profitLoss.stockAtCost)} tone="blue" />
                  <Stat label={t('biz_receivables')} value={inr(d.profitLoss.receivables)} tone="amber" />
                  <Stat label={t('biz_payables')} value={inr(d.profitLoss.payables)} tone="amber" />
                </StatGrid>
                <Card>
                  <KV label={t('biz_salesBooked')} value={inr(d.profitLoss.salesBooked)} />
                  <KV label={t('biz_purchasesBooked')} value={inr(d.profitLoss.purchasesBooked)} />
                  <KV label={t('common_from')} value={`${fmtDate(d.from)} – ${fmtDate(d.to)}`} />
                </Card>
                <Notice tone="blue" text={t('biz_separateHint')} />
                <BtnRow>
                  <Btn small title={t('qa_recordSale')} onPress={() => push('orderForm', { activityId: a.id, orderType: 'SALE' })} />
                  <Btn small kind="secondary" title={t('biz_purchase')} onPress={() => push('orderForm', { activityId: a.id, orderType: 'PURCHASE' })} />
                  <Btn small kind="secondary" title={t('biz_expense')} onPress={() => push('txnForm', { txnType: 'BUSINESS_EXPENSE', activityId: a.id })} />
                  <Btn small kind="secondary" title={t('biz_production')} onPress={() => setSheet('production')} />
                  <Btn small kind="ghost" title={a.status === 'Active' ? t('biz_pause') : t('biz_resume')}
                    onPress={() => api.put(`/business/activities/${a.id}`, { status: a.status === 'Active' ? 'Paused' : 'Active' }).then(reload)} />
                </BtnRow>
              </>
            )}
            {tab === 'products' && (
              <>
                <Btn small title={`+ ${t('biz_addProduct')}`} onPress={() => setSheet('product')} />
                {d.products.map((p: any) => (
                  <ListItem key={p.id} title={`${p.name}${p.active ? '' : ' (off)'}`}
                    subtitle={`${p.kind} · ${t('biz_sale')} ${inr(p.salePrice)} · ${t('biz_cost')} ${inr(p.purchasePrice)}`}
                    right={p.kind === 'Service' ? '—' : `${p.stockQty} ${p.unit}`}
                    badge={p.kind !== 'Service' && Number(p.stockQty) <= Number(p.reorderLevel) ? 'Pending' : null}
                    onPress={() => { setProduct(p); setSheet('adjust'); }} />
                ))}
              </>
            )}
            {tab === 'orders' && (
              <>
                <BtnRow>
                  <Btn small title={t('qa_recordSale')} onPress={() => push('orderForm', { activityId: a.id, orderType: 'SALE' })} />
                  <Btn small kind="secondary" title={t('biz_purchase')} onPress={() => push('orderForm', { activityId: a.id, orderType: 'PURCHASE' })} />
                </BtnRow>
                {d.orders.map((o: any) => (
                  <ListItem key={o.id} title={`${o.orderType === 'SALE' ? '🛍️' : '📦'} ${o.orderNumber}`} subtitle={`${o.partyName || '-'} · ${fmtDate(o.orderDate)}`}
                    right={inr(o.totalAmount)} meta={`${t('common_paid')} ${inr(o.paidAmount)}`} badge={o.status} onPress={() => push('orderDetail', { id: o.id })} />
                ))}
              </>
            )}
            {tab === 'work' && (
              <>
                <Btn small title={`+ ${t('biz_addWork')}`} onPress={() => setSheet('work')} />
                {d.work.map((w: any) => (
                  <Pressable key={w.id} disabled={!!w.paidTxnId} onPress={() => setSelectedWork(p => ({ ...p, [w.id]: !p[w.id] }))}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border, minHeight: 52 }}
                    accessibilityRole="checkbox" accessibilityState={{ checked: !!selectedWork[w.id], disabled: !!w.paidTxnId }}>
                    {!w.paidTxnId && Number(w.earnings) > 0 ? <Switch value={!!selectedWork[w.id]} onValueChange={v => setSelectedWork(p => ({ ...p, [w.id]: v }))} /> : <View style={{ width: 50 }} />}
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={{ color: c.text, fontWeight: '600' }}>{w.memberName}</Text>
                      <Text style={{ color: c.muted, fontSize: 12 }}>{fmtDate(w.workDate)} · {w.description}{w.quantity ? ` · ${w.quantity}` : ''}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: c.text, fontWeight: '700' }}>{inr(w.earnings)}</Text>
                      {w.paidTxnId ? <Badge value="Paid" /> : null}
                    </View>
                  </Pressable>
                ))}
                {!!unpaid.length && <>
                  {!!pay.error && <ErrorBox message={pay.error} />}
                  <Btn title={t('biz_payEarnings')} onPress={payWork} busy={pay.busy} disabled={!Object.values(selectedWork).some(Boolean)} />
                </>}
              </>
            )}
            {tab === 'assets' && (
              <>
                <Btn small title={`+ ${t('biz_addAsset')}`} onPress={() => setSheet('asset')} />
                {d.assets.map((x: any) => (
                  <ListItem key={x.id} title={x.name} subtitle={`${fmtDate(x.purchaseDate)} · ${x.location || ''}`} right={inr(x.cost)}
                    badge={x.condition === 'Good' ? 'Active' : x.condition === 'Disposed' ? 'Closed' : 'Pending'} />
                ))}
              </>
            )}
          </>
        )}
      </Gate>
      <FormSheet visible={sheet === 'product'} title={t('biz_addProduct')} onClose={() => setSheet(null)} initial={{ kind: 'Product', unit: 'pcs' }}
        fields={[
          { key: 'name', label: t('common_name'), required: true },
          { key: 'kind', label: t('common_type'), type: 'select', options: ['Product', 'Raw Material', 'Service'].map(x => ({ value: x, label: x })) },
          { key: 'unit', label: t('biz_unit'), placeholder: 'kg / pcs / litre' },
          { key: 'salePrice', label: t('biz_salePrice'), type: 'money' },
          { key: 'purchasePrice', label: t('biz_purchasePrice'), type: 'money' },
          { key: 'reorderLevel', label: t('biz_reorder'), type: 'decimal' },
        ]}
        onSubmit={async v => { const r = await api.post(`/business/activities/${params.id}/products`, v); reload(); return r; }} />
      <FormSheet visible={sheet === 'adjust'} title={product ? `${product.name} · ${t('biz_adjust')}` : ''} onClose={() => setSheet(null)}
        notice={t('biz_adjustHint')}
        fields={[
          { key: 'quantity', label: t('biz_qtyChange'), type: 'decimal', required: true },
          { key: 'reason', label: t('common_reason'), required: true },
        ]}
        onSubmit={async v => { const r = await api.post(`/business/products/${product.id}/adjust`, v); reload(); return r; }} />
      <FormSheet visible={sheet === 'production'} title={t('biz_production')} onClose={() => setSheet(null)} initial={{ date: isoToday() }}
        notice={t('biz_productionHint')}
        fields={[
          { key: 'productId', label: t('biz_product'), type: 'select', required: true, options: productOptions('Product') },
          { key: 'quantity', label: t('biz_qty'), type: 'decimal', required: true, min: 0 },
          { key: 'rawId', label: t('biz_rawUsed'), type: 'select', options: productOptions('Raw Material') },
          { key: 'rawQty', label: t('biz_rawQty'), type: 'decimal' },
          { key: 'date', label: t('common_date'), type: 'date', required: true },
          { key: 'notes', label: t('common_notes') },
        ]}
        onSubmit={async v => {
          const consumption = v.rawId && Number(v.rawQty) > 0 ? [{ productId: Number(v.rawId), quantity: v.rawQty }] : [];
          const r = await api.post(`/business/activities/${params.id}/production`, { productId: Number(v.productId), quantity: v.quantity, date: v.date, notes: v.notes, consumption });
          reload(); return r;
        }} />
      <FormSheet visible={sheet === 'work'} title={t('biz_addWork')} onClose={() => setSheet(null)} initial={{ workDate: isoToday() }}
        fields={[
          { key: 'memberId', label: t('common_member'), type: 'select', required: true, options: memberOptions },
          { key: 'workDate', label: t('common_date'), type: 'date', required: true },
          { key: 'description', label: t('biz_workDone'), required: true },
          { key: 'quantity', label: t('biz_qty'), type: 'decimal' },
          { key: 'earnings', label: t('biz_earnings'), type: 'money' },
        ]}
        onSubmit={async v => { const r = await api.post(`/business/activities/${params.id}/work`, { ...v, memberId: Number(v.memberId) }); reload(); return r; }} />
      <FormSheet visible={sheet === 'asset'} title={t('biz_addAsset')} onClose={() => setSheet(null)}
        fields={[
          { key: 'name', label: t('common_name'), required: true },
          { key: 'purchaseDate', label: t('biz_purchaseDate'), type: 'date' },
          { key: 'cost', label: t('biz_cost'), type: 'money' },
          { key: 'location', label: t('mtg_location') },
          { key: 'notes', label: t('common_notes') },
        ]}
        onSubmit={async v => { const r = await api.post(`/business/activities/${params.id}/assets`, v); reload(); return r; }} />
    </Screen>
  );
}

export function OrderFormScreen({ params }: { params: { activityId: number; orderType: 'SALE' | 'PURCHASE' } }) {
  const { api, t, replace, bump, groupId } = useShg();
  const isSale = params.orderType === 'SALE';
  const act = useLoad(() => api.get(`/business/activities/${params.activityId}`), [params.activityId]);
  const parties = useLoad(() => groupId ? api.get('/business/parties', { groupId, type: isSale ? 'Customer' : 'Supplier' }) : Promise.resolve(null), [groupId, isSale]);
  const banks = useBankOptions();
  const products = ((act.data as any)?.products || []).filter((p: any) => p.active && (isSale ? p.kind !== 'Raw Material' : p.kind !== 'Service'));
  const [lines, setLines] = useState<{ productId: string; quantity: string; rate: string }[]>([{ productId: '', quantity: '1', rate: '' }]);
  const [values, setValues] = useState<Record<string, any>>({ orderDate: isoToday(), paymentMethod: 'Cash', paidAmount: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [partyOpen, setPartyOpen] = useState(false);
  const { submit, busy, error, pending } = useSubmit();
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
  const setLine = (i: number, patch: any) => setLines(ls => ls.map((l, j) => {
    if (j !== i) return l;
    const next = { ...l, ...patch };
    if (patch.productId) {
      const p = products.find((x: any) => String(x.id) === patch.productId);
      if (p) next.rate = String(isSale ? p.salePrice : p.purchasePrice);
    }
    return next;
  }));
  const pay = paymentFields(t, values, banks, false);
  const fields: FieldSpec[] = [
    { key: 'partyId', label: isSale ? t('biz_customer') : t('biz_supplier'), type: 'select',
      options: ((parties.data as any)?.parties || []).map((p: any) => ({ value: String(p.id), label: `${p.name}${p.mobile ? ` · ${p.mobile}` : ''}` })) },
    { key: 'orderDate', label: t('common_date'), type: 'date', required: true },
    { key: 'paidAmount', label: isSale ? t('biz_receivedNow') : t('biz_paidNow'), type: 'money', max: total },
    ...pay,
    { key: 'notes', label: t('common_notes') },
  ];
  const save = () => {
    const errs = validate(fields, values, t);
    const bad = lines.some(l => !l.productId || !(Number(l.quantity) > 0) || !(Number(l.rate) >= 0));
    if (bad) errs.lines = t('biz_lineInvalid');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    confirm(isSale ? t('qa_recordSale') : t('biz_purchase'), inr(total), t('common_confirm'), t('common_cancel'), async () => {
      const res = await submit(key => api.post(`/business/activities/${params.activityId}/orders`, {
        ...values, orderType: params.orderType, partyId: values.partyId ? Number(values.partyId) : undefined,
        bankAccountId: values.bankAccountId ? Number(values.bankAccountId) : undefined,
        lines: lines.map(l => ({ productId: Number(l.productId), quantity: l.quantity, rate: l.rate })),
      }, key));
      if (res) { bump(); replace('orderDetail', { id: res.order.id }); }
    });
  };
  const productOpts = products.map((p: any) => ({ value: String(p.id), label: `${p.name} (${p.kind === 'Service' ? '—' : `${p.stockQty} ${p.unit}`})` }));
  return (
    <Screen title={isSale ? t('qa_recordSale') : t('biz_purchase')} subtitle={(act.data as any)?.activity?.name}>
      <Gate loading={act.loading} error={act.error} onRetry={act.reload} empty={!products.length} emptyText={t('biz_noProducts')}>
        <SectionTitle>{t('biz_items')}</SectionTitle>
        {lines.map((l, i) => (
          <Card key={i}>
            <SelectInput value={l.productId} onChange={v => setLine(i, { productId: v })} options={productOpts} label={t('biz_product')} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <View style={{ flex: 1 }}><Form fields={[{ key: 'q', label: t('biz_qty'), type: 'decimal' }]} values={{ q: l.quantity }} errors={{}} onChange={(_, v) => setLine(i, { quantity: v })} /></View>
              <View style={{ flex: 1 }}><Form fields={[{ key: 'r', label: t('biz_rate'), type: 'money' }]} values={{ r: l.rate }} errors={{}} onChange={(_, v) => setLine(i, { rate: v })} /></View>
            </View>
            <KV label={t('common_amount')} value={inr((Number(l.quantity) || 0) * (Number(l.rate) || 0))} />
            {lines.length > 1 && <Btn small kind="ghost" title={t('common_remove')} onPress={() => setLines(ls => ls.filter((_, j) => j !== i))} />}
          </Card>
        ))}
        {!!errors.lines && <ErrorBox message={errors.lines} />}
        <Btn small kind="secondary" title={`+ ${t('biz_addItem')}`} onPress={() => setLines(ls => [...ls, { productId: '', quantity: '1', rate: '' }])} />
        <Card><KV label={t('common_total')} value={inr(total)} strong /></Card>
        <Form fields={fields} values={values} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} errors={errors} />
        <Btn small kind="ghost" title={`+ ${isSale ? t('biz_newCustomer') : t('biz_newSupplier')}`} onPress={() => setPartyOpen(true)} />
        {!!error && <ErrorBox message={error} />}
        <Btn title={pending ? t('common_retrySame') : t('common_save')} onPress={save} busy={busy} />
      </Gate>
      <FormSheet visible={partyOpen} title={isSale ? t('biz_newCustomer') : t('biz_newSupplier')} onClose={() => setPartyOpen(false)}
        fields={[{ key: 'name', label: t('common_name'), required: true }, { key: 'mobile', label: t('common_mobile'), type: 'phone' }, { key: 'address', label: t('grp_address') }]}
        onSubmit={async v => {
          const r = await api.post('/business/parties', { ...v, groupId, partyType: isSale ? 'Customer' : 'Supplier' });
          await parties.reload();
          setValues(p => ({ ...p, partyId: String(r.party.id) }));
          return r;
        }} />
    </Screen>
  );
}

export function OrderDetailScreen({ params }: { params: { id: number } }) {
  const { api, t, push, bump } = useShg();
  const { data, loading, error, reload } = useLoad(() => api.get(`/business/orders/${params.id}`), [params.id]);
  const d = data as any;
  const o = d?.order;
  const banks = useBankOptions();
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const balance = o ? Number(o.totalAmount) - Number(o.paidAmount) : 0;
  return (
    <Screen title={o?.orderNumber || ''} subtitle={o ? `${o.orderType === 'SALE' ? t('biz_sale') : t('biz_purchase')} · ${o.partyName || ''}` : undefined}>
      <Gate loading={loading} error={error} onRetry={reload}>
        {o && (
          <>
            <Card>
              <Badge value={o.status} />
              <KV label={t('common_date')} value={fmtDate(o.orderDate)} />
              {d.lines.map((l: any) => <KV key={l.id} label={`${l.productName} × ${l.quantity} ${l.unit} @ ${inr(l.rate)}`} value={inr(l.amount)} />)}
              <KV label={t('common_total')} value={inr(o.totalAmount)} strong />
              <KV label={t('common_paid')} value={inr(o.paidAmount)} />
              <KV label={t('common_balance')} value={inr(balance)} strong />
              {!!o.notes && <KV label={t('common_notes')} value={o.notes} />}
            </Card>
            <BtnRow>
              {o.status !== 'Cancelled' && balance > 0 && <Btn small title={o.orderType === 'SALE' ? t('biz_receivePayment') : t('biz_makePayment')} onPress={() => setPayOpen(true)} />}
              {o.status !== 'Cancelled' && Number(o.paidAmount) === 0 && <Btn small kind="danger" title={t('common_cancel')} onPress={() => setCancelOpen(true)} />}
            </BtnRow>
            <SectionTitle>{t('tab_transactions')}</SectionTitle>
            {d.transactions.map((x: any) => <TxnItem key={x.id} txn={x} onPress={() => push('receipt', { id: x.id })} />)}
          </>
        )}
      </Gate>
      <FormSheet visible={payOpen} title={o?.orderType === 'SALE' ? t('biz_receivePayment') : t('biz_makePayment')} onClose={() => setPayOpen(false)}
        initial={{ amount: String(balance), paymentMethod: 'Cash', txnDate: isoToday() }}
        fields={[
          { key: 'amount', label: t('common_amount'), type: 'money', required: true, max: balance },
          { key: 'paymentMethod', label: t('common_paymentMethod'), type: 'select', required: true, options: ['Cash', 'UPI', 'Bank Transfer', 'Cheque'].map(x => ({ value: x, label: x })) },
          { key: 'bankAccountId', label: t('bank_account'), type: 'select', options: banks },
          { key: 'referenceNumber', label: t('common_reference') },
          { key: 'txnDate', label: t('common_date'), type: 'date', required: true },
        ]}
        onSubmit={async (v, key) => { const r = await api.post(`/business/orders/${params.id}/payments`, { ...v, bankAccountId: v.bankAccountId ? Number(v.bankAccountId) : undefined }, key); reload(); bump(); return r; }} />
      <FormSheet visible={cancelOpen} title={t('common_cancel')} onClose={() => setCancelOpen(false)}
        fields={[{ key: 'reason', label: t('common_reason'), required: true }]}
        onSubmit={async v => { const r = await api.post(`/business/orders/${params.id}/cancel`, v); reload(); bump(); return r; }} />
    </Screen>
  );
}
