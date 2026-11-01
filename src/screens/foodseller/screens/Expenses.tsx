import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fmtDate, inr, isoToday, monthStartIso } from '../../bachatgat/format';
import {
  Btn, BtnRow, Card, Chips, Empty, ErrorBox, FieldSpec, FormSheet, Gate, Grid, LoadMore, Notice, Screen, SectionTitle, StatCard, StatRow, confirmDialog, errorText, num, useFood, usePaged,
} from '../ui';

export function ExpensesScreen() {
  const { api, t, tf, c, meta, bump, toast } = useFood();
  const [period, setPeriod] = useState<'today' | 'month'>('today');
  const from = period === 'today' ? isoToday() : monthStartIso();
  const [totals, setTotals] = useState<any>(null);
  const list = usePaged(async page => {
    const r = await api.get('/expenses', { from, to: isoToday(), page });
    setTotals(r.totals);
    return { items: r.expenses as any[], hasMore: r.hasMore };
  }, [from]);
  const [editing, setEditing] = useState<any>(null);
  const [catEditing, setCatEditing] = useState<any>(null);
  const [showCats, setShowCats] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const categories = meta?.expenseCategories || [];

  const fields: FieldSpec[] = [
    { key: 'categoryId', label: tf('exp_category'), type: 'select', required: true, options: categories.map(x => ({ value: String(x.id), label: x.name })) },
    { key: 'amount', label: tf('exp_amount'), type: 'money', required: true },
    { key: 'paymentMethod', label: tf('pend_method'), type: 'select', options: [{ value: 'Cash', label: tf('pay_cash') }, { value: 'UPI', label: tf('pay_upi') }, { value: 'Credit', label: tf('pay_credit') }] },
    { key: 'date', label: tf('common_date'), type: 'date', required: true },
    { key: 'notes', label: tf('common_notes'), maxLength: 300 },
    // A new entry follows its expense type (the server applies it); only an existing one can override.
    { key: 'countsInPnl', label: tf('exp_countsInPnl'), type: 'switch', help: tf('exp_countsHelp'), hidden: !editing?.id },
  ];
  const openNew = () => setEditing({ paymentMethod: 'Cash', date: isoToday() });
  const remove = async (e: any) => {
    if (!(await confirmDialog(tf('common_delete'), `${e.categoryName} ${inr(e.amount)}`, tf('common_delete'), t('common_cancel'), true))) return;
    try { await api.del(`/expenses/${e.id}`); bump(); toast(tf('common_deleted')); } catch (err) { setError(errorText(t, err)); }
  };

  return (
    <Screen title={tf('exp_title')} noBack onRefresh={list.reload} refreshing={list.refreshing}
      right={<Btn small icon="＋" title={tf('exp_add')} onPress={openNew} />}>
      <StatRow>
        <StatCard icon="🧾" label={tf('exp_today')} value={inr(totals?.dayTotal)} tone="amber" />
        <StatCard icon="📅" label={tf('exp_month')} value={inr(totals?.monthTotal)} />
      </StatRow>
      {num(totals?.dayExcluded) > 0 && <Notice tone="blue" text={tf('exp_excludedNote', { amount: inr(totals.dayExcluded) })} />}
      <Chips value={period} onChange={setPeriod} options={[{ value: 'today', label: t('common_today') }, { value: 'month', label: tf('common_thisMonth') }]} />
      <BtnRow>
        <Btn small kind="secondary" icon="🗂️" title={tf('exp_categories')} onPress={() => setShowCats(s => !s)} />
      </BtnRow>
      {showCats && (
        <Card style={{ marginTop: 8 }}>
          <SectionTitle right={<Btn small icon="＋" title={tf('common_add')} onPress={() => setCatEditing({ countsInPnl: true })} />}>{tf('exp_categories')}</SectionTitle>
          {categories.map(x => (
            <Pressable key={x.id} onPress={() => setCatEditing(x)} accessibilityRole="button" style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: 1, borderTopColor: c.border }}>
              <Text style={{ color: c.text, fontWeight: '600' }}>{x.name}</Text>
              <Text style={{ color: x.countsInPnl ? c.muted : c.blue, fontSize: 12 }}>{x.countsInPnl ? tf('exp_inPnl') : tf('exp_notInPnl')}</Text>
            </Pressable>
          ))}
        </Card>
      )}
      {!!error && <ErrorBox message={error} />}
      <Gate loading={list.loading} error={list.error} onRetry={list.reload}>
        {!list.items.length && <Empty text={tf('exp_empty')} action={tf('exp_add')} onAction={openNew} />}
        <Grid>
          {list.items.map((e: any) => (
            <Card key={e.id} onPress={() => setEditing({ ...e, date: e.transactionDate, categoryId: String(e.categoryId) })} a11y={`${e.categoryName} ${inr(e.amount)}`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Text style={{ color: c.text, fontWeight: '800', flex: 1 }} numberOfLines={1}>{e.categoryName}</Text>
                <Text style={{ color: c.text, fontWeight: '800' }}>{inr(e.amount)}</Text>
              </View>
              <Text style={{ color: c.muted, fontSize: 12, marginTop: 2 }}>{fmtDate(e.transactionDate)} · {tf(`pay_${String(e.paymentMethod).toLowerCase()}` as any)}{e.notes ? ` · ${e.notes}` : ''}</Text>
              {!e.countsInPnl && <Text style={{ color: c.blue, fontSize: 12, marginTop: 2 }}>{tf('exp_notInPnl')}</Text>}
              <View style={{ alignSelf: 'flex-end', marginTop: 4 }}><Btn small kind="ghost" title={tf('common_delete')} onPress={() => remove(e)} /></View>
            </Card>
          ))}
        </Grid>
        <LoadMore list={list} />
      </Gate>
      <FormSheet visible={!!editing} title={editing?.id ? tf('exp_edit') : tf('exp_add')} fields={fields} initial={editing || {}} onClose={() => setEditing(null)} notice={tf('exp_doubleHint')}
        onSubmit={async (values, key) => {
          const r = editing?.id ? await api.put(`/expenses/${editing.id}`, values) : await api.post('/expenses', values, key);
          bump();
          toast(tf('common_saved'));
          return r;
        }} />
      <FormSheet visible={!!catEditing} title={catEditing?.id ? tf('exp_editCategory') : tf('exp_addCategory')} initial={catEditing || {}} onClose={() => setCatEditing(null)}
        fields={[
          { key: 'name', label: tf('cat_name'), required: true, maxLength: 80 },
          { key: 'countsInPnl', label: tf('exp_countsInPnl'), type: 'switch', help: tf('exp_countsHelp') },
        ]}
        onSubmit={async v => {
          const r = catEditing?.id ? await api.put(`/expense-categories/${catEditing.id}`, v) : await api.post('/expense-categories', v);
          bump();
          toast(tf('common_saved'));
          return r;
        }} />
    </Screen>
  );
}
