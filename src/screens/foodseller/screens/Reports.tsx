import React, { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { ReportColumn, cellText, fmtDate, inr, isoToday, monthStartIso, reportHtml } from '../../bachatgat/format';
import {
  Btn, BtnRow, Card, Chips, DateInput, ErrorBox, Gate, Grid, KV, ListItem, Notice, Screen, SectionTitle, SelectInput, StatCard, StatRow, errorText, num, qty, useFood, useLoad,
} from '../ui';

const GROUP_KEYS: Record<string, any> = { Purchases: 'rep_group_purchases', Sales: 'rep_group_sales', Stock: 'rep_group_stock', Profit: 'rep_group_profit' };

function PeriodPicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const { t, tf } = useFood();
  const today = isoToday();
  const preset = from === today && to === today ? 'today' : from === monthStartIso() && to === today ? 'month' : 'custom';
  const lastMonth = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    onChange(iso(start), iso(end));
  };
  return (
    <>
      <Chips value={preset} onChange={v => {
        if (v === 'today') onChange(today, today);
        else if (v === 'month') onChange(monthStartIso(), today);
        else if (v === 'last') lastMonth();
      }} options={[
        { value: 'today', label: t('common_today') }, { value: 'month', label: tf('common_thisMonth') }, { value: 'last', label: tf('common_lastMonth') },
      ]} />
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 8 }}>
        <View style={{ flex: 1 }}><DateInput value={from} onChange={v => onChange(v, to)} label={t('common_from')} /></View>
        <View style={{ flex: 1 }}><DateInput value={to} onChange={v => onChange(from, v)} label={t('common_to')} /></View>
      </View>
    </>
  );
}

export function ReportsScreen() {
  const { api, tf, push } = useFood();
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get('/reports'), []);
  const reports: any[] = (data as any)?.reports || [];
  const groups: Record<string, any[]> = {};
  reports.forEach(r => { (groups[r.group] = groups[r.group] || []).push(r); });
  return (
    <Screen title={tf('rep_title')} noBack onRefresh={reload} refreshing={refreshing}>
      <Card onPress={() => push('pnl')} a11y={tf('pnl_title')}>
        <Text style={{ fontSize: 22 }}>📈</Text>
        <Text style={{ fontWeight: '800', fontSize: 16, marginTop: 4 }}>{tf('pnl_title')}</Text>
        <Text style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>{tf('pnl_hint')}</Text>
      </Card>
      <Gate loading={loading && !data} error={error} onRetry={reload}>
        {Object.entries(groups).map(([group, items]) => (
          <View key={group}>
            <SectionTitle>{tf(GROUP_KEYS[group])}</SectionTitle>
            <Grid>
              {items.map(r => <ListItem key={r.key} title={tf(`rep_${r.key}` as any)} onPress={() => push('reportView', { key: r.key, filter: r.filter })} />)}
            </Grid>
          </View>
        ))}
      </Gate>
    </Screen>
  );
}

/** Column labels come from the server in English; report titles and common columns read in the owner's language. */
function useColumnLabel() {
  const { tf } = useFood();
  return (col: ReportColumn) => {
    const key = `col_${col.key}` as any;
    const text = tf(key);
    return text === key ? col.label : text;
  };
}

export function ReportViewScreen({ params }: { params: { key: string; filter?: string | null } }) {
  const { api, t, tf, c, meta } = useFood();
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(isoToday());
  const [productId, setProductId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const label = useColumnLabel();
  const productFilter = params.filter === 'product';
  const foodFilter = params.filter === 'food';
  const pickList = useLoad(
    () => (productFilter ? api.get('/products') : foodFilter ? api.get('/food-products') : Promise.resolve(null)), [params.filter]);
  const options = ((pickList.data as any)?.products || (pickList.data as any)?.foods || []).map((x: any) => ({ value: String(x.id), label: x.name }));
  const query = { from, to, categoryId: categoryId || undefined, productId: productFilter ? productId || undefined : undefined, foodId: foodFilter ? productId || undefined : undefined };
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get(`/reports/${params.key}`, query), [params.key, from, to, productId, categoryId]);
  const r = data as any;
  const cols: ReportColumn[] = (r?.columns || []).map((col: ReportColumn) => ({ ...col, label: label(col) }));
  const title = tf(`rep_${params.key}` as any);

  const exportPdf = async () => {
    setBusy('pdf');
    setExportErr(null);
    try {
      const html = reportHtml(title, r.meta, cols, r.rows, r.totals);
      if (Platform.OS === 'web') {
        await Print.printAsync({ html });
      } else {
        const { uri } = await Print.printToFileAsync({ html });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title });
        else Alert.alert(t('common_error'), t('err_shareUnavailable'));
      }
    } catch { setExportErr(t('err_pdf')); } finally { setBusy(null); }
  };
  const exportXlsx = async () => {
    setBusy('xlsx');
    setExportErr(null);
    try {
      const file = await api.get(`/reports/${params.key}`, { ...query, format: 'xlsx' });
      const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (Platform.OS === 'web') {
        const link = (globalThis as any).document.createElement('a');
        link.href = `data:${mime};base64,${file.fileBase64}`;
        link.download = file.fileName;
        link.click();
      } else {
        const uri = `${FileSystem.cacheDirectory}${file.fileName}`;
        await FileSystem.writeAsStringAsync(uri, file.fileBase64, { encoding: FileSystem.EncodingType.Base64 });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: mime, UTI: 'org.openxmlformats.spreadsheetml.sheet' });
        else Alert.alert(t('common_error'), t('err_shareUnavailable'));
      }
    } catch (e) { setExportErr(errorText(t, e)); } finally { setBusy(null); }
  };

  const [titleCol, ...restCols] = cols;
  return (
    <Screen title={title} subtitle={r?.meta} onRefresh={reload} refreshing={refreshing}>
      <PeriodPicker from={from} to={to} onChange={(f, x) => { setFrom(f); setTo(x); }} />
      {(productFilter || foodFilter) && (
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <SelectInput value={productId} onChange={setProductId} label={tf('common_product')} options={[{ value: '', label: t('common_all') }, ...options]} placeholder={tf('common_product')} />
          </View>
          <View style={{ flex: 1 }}>
            <SelectInput value={categoryId} onChange={setCategoryId} label={tf('prod_category')} placeholder={tf('prod_category')}
              options={[{ value: '', label: t('common_all') }, ...(meta?.categories || []).map(x => ({ value: String(x.id), label: x.name }))]} />
          </View>
        </View>
      )}
      <Gate loading={loading && !r} error={error} onRetry={reload}>
        {r && (
          <>
            <BtnRow>
              <Btn small icon="📄" title="PDF" onPress={exportPdf} busy={busy === 'pdf'} disabled={!r.rows.length} />
              <Btn small kind="secondary" icon="📊" title="Excel" onPress={exportXlsx} busy={busy === 'xlsx'} disabled={!r.rows.length} />
            </BtnRow>
            {!!exportErr && <ErrorBox message={exportErr} />}
            <Text style={{ color: c.muted, marginVertical: 6 }}>{t('rep_rows', { n: r.rows.length })}</Text>
            {Object.keys(r.totals || {}).length > 0 && (
              <Card style={{ backgroundColor: c.brandBg }}>
                {cols.filter(col => r.totals[col.key] !== undefined).map(col => (
                  <KV key={col.key} label={`${tf('common_total')} · ${col.label}`} value={cellText(col, col.type === 'number' ? qty(r.totals[col.key]) : r.totals[col.key])} strong />
                ))}
              </Card>
            )}
            {!r.rows.length && <Notice text={t('common_noRecords')} />}
            <Grid>
              {r.rows.slice(0, 300).map((row: any, i: number) => (
                <Card key={i}>
                  {titleCol && <Text style={{ color: c.text, fontWeight: '800', marginBottom: 4 }}>{cellText(titleCol, row[titleCol.key]) || '—'}</Text>}
                  {restCols.map(col => {
                    const v = cellText(col, col.type === 'number' && row[col.key] !== null && row[col.key] !== undefined ? qty(row[col.key]) : row[col.key]);
                    return v ? <KV key={col.key} label={col.label} value={v} /> : null;
                  })}
                </Card>
              ))}
            </Grid>
            {r.rows.length > 300 && <Notice text={t('rep_truncated')} />}
          </>
        )}
      </Gate>
    </Screen>
  );
}

/** Purchase, consumption, sales and expenses side by side, then what is actually profit. */
export function PnlScreen() {
  const { api, tf, c } = useFood();
  const [from, setFrom] = useState(isoToday());
  const [to, setTo] = useState(isoToday());
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get('/pnl', { from, to }), [from, to]);
  const d = data as any;
  const p = d?.pnl;
  const net = num(p?.netProfit);
  return (
    <Screen title={tf('pnl_title')} onRefresh={reload} refreshing={refreshing}>
      <PeriodPicker from={from} to={to} onChange={(f, x) => { setFrom(f); setTo(x); }} />
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {p && (
          <>
            <StatRow>
              <StatCard icon="💰" label={tf('pnl_revenue')} value={inr(p.revenue)} tone="green" />
              <StatCard icon="🛒" label={tf('dash_purchase')} value={inr(p.purchases)} tone="blue" />
              <StatCard icon="🍳" label={tf('dash_consumption')} value={inr(p.consumptionCost)} tone="amber" />
              <StatCard icon="🏆" label={tf('pnl_net')} value={inr(net)} tone={net < 0 ? 'red' : 'green'} />
            </StatRow>
            <Notice tone="blue" text={tf('pnl_note')} />
            <Grid>
              <Card>
                <KV label={tf('pnl_revenue')} value={inr(p.revenue)} strong />
                {num(p.discount) > 0 && <Text style={{ color: c.muted, fontSize: 12 }}>{tf('pnl_afterDiscount', { amount: inr(p.discount) })}</Text>}
                <KV label={tf('pnl_recipeCost')} value={`-${inr(p.recipeCost)}`} />
                {num(p.unmatchedCost) > 0 && <KV label={tf('pnl_unmatched')} value={`-${inr(p.unmatchedCost)}`} />}
                <KV label={tf('pnl_gross')} value={inr(p.grossProfit)} strong />
                <KV label={tf('pnl_otherExpenses')} value={`-${inr(p.expenses)}`} />
                {num(p.wastage) > 0 && <KV label={tf('con_wastage')} value={`-${inr(p.wastage)}`} />}
                {num(p.spoilage) > 0 && <KV label={tf('con_spoilage')} value={`-${inr(p.spoilage)}`} />}
                {num(p.adjustmentNet) !== 0 && <KV label={tf('pnl_adjustments')} value={inr(p.adjustmentNet)} />}
                <KV label={tf('pnl_net')} value={inr(net)} strong color={net < 0 ? c.red : c.green} />
              </Card>
              <Card>
                <Text style={{ color: c.text, fontWeight: '800', marginBottom: 6 }}>{tf('pnl_outside')}</Text>
                <KV label={tf('pnl_purchases')} value={inr(p.purchases)} />
                {num(p.personal) > 0 && <KV label={tf('con_personal')} value={inr(p.personal)} />}
                {num(p.expensesExcluded) > 0 && <KV label={tf('pnl_excludedExpenses')} value={inr(p.expensesExcluded)} />}
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 6 }}>{tf('pnl_outsideHint')}</Text>
              </Card>
            </Grid>
            <SectionTitle>{tf('pnl_byProduct')}</SectionTitle>
            {!d.foods.length && <Text style={{ color: c.muted }}>{tf('dash_noSales')}</Text>}
            <Grid>
              {d.foods.map((f: any) => (
                <ListItem key={f.food} title={f.food} subtitle={`${qty(f.quantity)} · ${inr(f.revenue)} − ${inr(f.cost)}`} meta={f.costMissing ? tf('menu_noRecipe') : undefined} right={inr(f.profit)} />
              ))}
            </Grid>
            <SectionTitle>{tf('pnl_bySale')}</SectionTitle>
            {!d.sales.length && <Text style={{ color: c.muted }}>{tf('dash_noSales')}</Text>}
            <Grid>
              {d.sales.map((s: any) => (
                <ListItem key={s.saleId} title={s.items.join(', ')} subtitle={`${fmtDate(s.date)}${s.customer ? ` · ${s.customer}` : ''}`} right={inr(s.profit)} />
              ))}
            </Grid>
          </>
        )}
      </Gate>
    </Screen>
  );
}
