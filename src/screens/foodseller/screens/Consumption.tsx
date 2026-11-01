import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fmtDate, inr, isoToday, monthStartIso } from '../../bachatgat/format';
import {
  Badge, Btn, BtnRow, Card, Chips, DateInput, Empty, ErrorBox, Field, Gate, Grid, LoadMore, NumInput, Notice, Screen, SectionTitle, SelectInput, StatCard, StatRow, StockPill,
  confirmDialog, nextRowId, num, qty, unitsFor, useFood, useLoad, usePaged, useStockSubmit,
} from '../ui';

/** The day's table: Opening/Purchased | Used | Remaining, live from the stock ledger. */
export function ConsumptionScreen() {
  const { api, tf, c, push } = useFood();
  const [date, setDate] = useState(isoToday());
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get('/consumption/summary', { date }), [date]);
  const d = data as any;
  const rows: any[] = d?.rows || [];
  const usedRows = rows.filter(r => num(r.used) > 0 || num(r.lost) > 0);
  return (
    <Screen title={tf('con_title')} noBack onRefresh={reload} refreshing={refreshing}
      right={<Btn small icon="＋" title={tf('con_new')} onPress={() => push('consumptionForm')} />}>
      <View style={{ marginBottom: 8 }}><DateInput value={date} onChange={setDate} label={tf('common_date')} /></View>
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {d && (
          <>
            <StatRow>
              <StatCard icon="🍳" label={tf('con_cost')} value={inr(d.totalCost)} tone="amber" />
              <StatCard icon="🗑️" label={tf('con_lostCost')} value={inr(d.totalLostCost)} tone={num(d.totalLostCost) > 0 ? 'red' : 'brand'} />
            </StatRow>
            <Notice tone="blue" text={tf('con_noDoubleHint')} />
            <BtnRow>
              <Btn small kind="secondary" icon="📜" title={tf('con_history')} onPress={() => push('consumptionHistory')} />
            </BtnRow>
            <SectionTitle>{tf('con_todayTable')}</SectionTitle>
            {!rows.length && <Empty text={tf('con_empty')} />}
            {!!rows.length && (
              <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 6 }}>
                <Text style={{ flex: 2, color: c.muted, fontSize: 11, fontWeight: '800' }}>{tf('common_product')}</Text>
                <Text style={{ flex: 1, color: c.muted, fontSize: 11, fontWeight: '800', textAlign: 'right' }}>{tf('con_available')}</Text>
                <Text style={{ flex: 1, color: c.muted, fontSize: 11, fontWeight: '800', textAlign: 'right' }}>{tf('con_used')}</Text>
                <Text style={{ flex: 1, color: c.muted, fontSize: 11, fontWeight: '800', textAlign: 'right' }}>{tf('con_remaining')}</Text>
              </View>
            )}
            {[...usedRows, ...rows.filter(r => !usedRows.includes(r))].map(r => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 }}
                accessible accessibilityLabel={`${r.name}: ${qty(r.available)} ${r.unitName}, ${qty(r.used)}, ${qty(r.closing)}`}>
                <View style={{ flex: 2, minWidth: 0, paddingRight: 6 }}>
                  <Text style={{ color: c.text, fontWeight: '700' }} numberOfLines={1}>{r.name}</Text>
                  <Text style={{ color: c.muted, fontSize: 11 }} numberOfLines={1}>{r.unitName}{num(r.recipe) > 0 ? ` · ${tf('con_recipeUsed', { qty: qty(r.recipe) })}` : ''}{num(r.lost) > 0 ? ` · ${tf('con_lost', { qty: qty(r.lost) })}` : ''}</Text>
                </View>
                <Text style={{ flex: 1, color: c.sub, textAlign: 'right' }}>{qty(r.available)}</Text>
                <Text style={{ flex: 1, color: num(r.used) > 0 ? c.amber : c.sub, fontWeight: '700', textAlign: 'right' }}>{qty(r.used)}</Text>
                <Text style={{ flex: 1, color: r.state === 'OK' ? c.text : r.state === 'OUT' ? c.red : c.amber, fontWeight: '800', textAlign: 'right' }}>{qty(r.closing)}</Text>
              </View>
            ))}
          </>
        )}
      </Gate>
    </Screen>
  );
}

interface Row { id: string; productId: string; quantity: string; unitId: string; purpose: string }

export function ConsumptionFormScreen() {
  const { api, t, tf, c, back, bump, toast, meta } = useFood();
  const products = useLoad(() => api.get('/products', { status: 'Active' }), []);
  const productList: any[] = (products.data as any)?.products || [];
  const [date, setDate] = useState(isoToday());
  const [rows, setRows] = useState<Row[]>([{ id: nextRowId(), productId: '', quantity: '', unitId: '', purpose: 'PREPARATION' }]);
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const { send, busy, pending, error } = useStockSubmit();
  const productOptions = useMemo(() => productList.map(p => ({ value: String(p.id), label: `${p.name} (${qty(p.stockQty)} ${p.unitName})` })), [productList]);
  const purposes = [
    { value: 'PREPARATION', label: tf('con_preparation') }, { value: 'WASTAGE', label: tf('con_wastage') },
    { value: 'SPOILAGE', label: tf('con_spoilage') }, { value: 'PERSONAL', label: tf('con_personal') },
  ];
  const update = (id: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const save = async () => {
    const filled = rows.filter(r => r.productId);
    if (!filled.length || filled.some(r => num(r.quantity) <= 0)) { setProblem(tf('con_rowsProblem')); return; }
    setProblem(null);
    const r = await send((key, extra) => api.post('/consumption', {
      date, notes, items: filled.map(x => ({ productId: x.productId, quantity: x.quantity, unitId: x.unitId, purpose: x.purpose })), ...extra,
    }, key));
    if (r) {
      bump();
      const covered = r.deductions.filter((d: any) => num(d.coveredBySales) > 0);
      if (covered.length) toast(tf('con_coveredToast', { items: covered.map((d: any) => `${d.name} ${qty(d.coveredBySales)} ${d.unit}`).join(', ') }));
      else if (r.alerts.length) toast(tf('stock_alertToast', { items: r.alerts.map((a: any) => a.name).join(', ') }), 'error');
      else toast(tf('common_saved'));
      back();
    }
  };
  return (
    <Screen title={tf('con_new')}>
      <Gate loading={products.loading} error={products.error} onRetry={products.reload}>
        {!productList.length ? <Notice text={tf('pur_addProductFirst')} /> : (
          <>
            <Field spec={{ key: 'date', label: tf('common_date'), type: 'date' }} value={date} onChange={setDate} />
            <SectionTitle>{tf('con_items')}</SectionTitle>
            {rows.map(row => {
              const product = productList.find(p => String(p.id) === row.productId);
              const units = unitsFor(product, meta?.units || []);
              return (
                <Card key={row.id}>
                  <SelectInput value={row.productId} label={tf('common_product')} placeholder={tf('common_selectProduct')} options={productOptions}
                    onChange={v => { const next = productList.find(p => String(p.id) === v); update(row.id, { productId: v, unitId: next ? String(next.unitId) : '' }); }} />
                  {product && <View style={{ marginTop: 6 }}><StockPill state={product.stockState} /></View>}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'flex-end' }}>
                    <NumInput label={tf('common_quantity')} value={row.quantity} onChange={v => update(row.id, { quantity: v })} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>{tf('prod_unit')}</Text>
                      <SelectInput value={row.unitId} onChange={v => update(row.id, { unitId: v })} options={units.map(u => ({ value: String(u.id), label: u.name }))} label={tf('prod_unit')} />
                    </View>
                  </View>
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>{tf('con_purpose')}</Text>
                    <Chips value={row.purpose} onChange={v => update(row.id, { purpose: v })} options={purposes} />
                  </View>
                  {rows.length > 1 && (
                    <Pressable onPress={() => setRows(rs => rs.filter(r => r.id !== row.id))} hitSlop={10} accessibilityRole="button" accessibilityLabel={tf('common_removeRow')} style={{ minHeight: 40, justifyContent: 'center', alignSelf: 'flex-end' }}>
                      <Text style={{ color: c.red, fontWeight: '700' }}>✕ {tf('common_remove')}</Text>
                    </Pressable>
                  )}
                </Card>
              );
            })}
            <Btn kind="secondary" icon="＋" title={tf('common_addRow')} onPress={() => setRows(rs => [...rs, { id: nextRowId(), productId: '', quantity: '', unitId: '', purpose: 'PREPARATION' }])} />
            <Field spec={{ key: 'notes', label: tf('common_notes'), maxLength: 300 }} value={notes} onChange={setNotes} />
            <Notice tone="blue" text={tf('con_purposeHint')} />
            {!!problem && <ErrorBox message={problem} />}
            {!!error && <ErrorBox message={error} />}
            <Btn title={pending ? t('common_retrySame') : tf('con_save')} onPress={save} busy={busy} />
          </>
        )}
      </Gate>
    </Screen>
  );
}

export function ConsumptionHistoryScreen() {
  const { api, t, tf, c, bump, toast } = useFood();
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(isoToday());
  const list = usePaged(async page => {
    const r = await api.get('/consumption', { from, to, page });
    return { items: r.consumption as any[], hasMore: r.hasMore };
  }, [from, to]);
  const { send, error } = useStockSubmit();
  const voidIt = async (id: number) => {
    if (!(await confirmDialog(tf('common_void'), tf('con_voidHint'), tf('common_void'), t('common_cancel'), true))) return;
    const r = await send((key, extra) => api.post(`/consumption/${id}/void`, extra, key));
    if (r) { bump(); toast(tf('common_voided')); }
  };
  const purpose: any = { PREPARATION: tf('con_preparation'), WASTAGE: tf('con_wastage'), SPOILAGE: tf('con_spoilage'), PERSONAL: tf('con_personal') };
  return (
    <Screen title={tf('con_history')} onRefresh={list.reload} refreshing={list.refreshing}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
        <View style={{ flex: 1 }}><DateInput value={from} onChange={setFrom} label={t('common_from')} /></View>
        <View style={{ flex: 1 }}><DateInput value={to} onChange={setTo} label={t('common_to')} /></View>
      </View>
      {!!error && <ErrorBox message={error} />}
      <Gate loading={list.loading} error={list.error} onRetry={list.reload}>
        {!list.items.length && <Empty text={t('common_noRecords')} />}
        <Grid>
          {list.items.map((h: any) => (
            <Card key={h.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: c.text, fontWeight: '800' }}>{fmtDate(h.transactionDate)}</Text>
                {h.status === 'Voided' && <Badge value="Reversed" label={tf('st_voided')} />}
              </View>
              {h.items.map((i: any) => (
                <Text key={i.id} style={{ color: c.sub, marginTop: 4 }}>{i.productName}: {qty(i.enteredQty)} {i.unitName} · {purpose[i.purpose]}</Text>
              ))}
              {!!h.notes && <Text style={{ color: c.muted, fontSize: 12, marginTop: 4 }}>{h.notes}</Text>}
              {h.status === 'Posted' && <View style={{ marginTop: 6, alignSelf: 'flex-start' }}><Btn small kind="ghost" title={tf('common_void')} onPress={() => voidIt(h.id)} /></View>}
            </Card>
          ))}
        </Grid>
        <LoadMore list={list} />
      </Gate>
    </Screen>
  );
}
