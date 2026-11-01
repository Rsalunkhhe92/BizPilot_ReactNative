import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fmtDate, inr, isoToday } from '../../bachatgat/format';
import {
  Btn, BtnRow, Card, DateInput, Empty, ErrorBox, Gate, Grid, KV, Notice, Screen, SectionTitle, StatCard, StatRow, StockPill, num, qty, useFood, useLoad,
} from '../ui';

// Validated chart colours already used by the driver dashboard (see the data-viz palette note in App.tsx).
const UPI_COLOR = '#2a78d6';
const CASH_COLOR = '#eb6834';
const BAR_COLOR = '#2a78d6';

function SetupCard() {
  const { api, tf, t, c, bump, toast, reloadMeta } = useFood();
  const [busy, setBusy] = useState<'starter' | 'empty' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (useStarter: boolean) => {
    setBusy(useStarter ? 'starter' : 'empty');
    setError(null);
    try {
      const r = await api.post('/setup/starter', { useStarter });
      await reloadMeta();
      bump();
      if (useStarter) toast(tf('setup_done', { products: r.products, foods: r.foods }));
    } catch (e: any) {
      setError(e?.message || t('err_generic'));
    } finally { setBusy(null); }
  };
  return (
    <Card>
      <Text style={{ fontSize: 28, marginBottom: 6 }}>🍔</Text>
      <Text style={{ color: c.text, fontSize: 17, fontWeight: '800', marginBottom: 4 }} accessibilityRole="header">{tf('setup_title')}</Text>
      <Notice tone="blue" text={tf('setup_hint')} />
      {!!error && <ErrorBox message={error} />}
      <Btn title={tf('setup_useStarter')} onPress={() => run(true)} busy={busy === 'starter'} disabled={!!busy} />
      <Btn kind="ghost" title={tf('setup_startEmpty')} onPress={() => run(false)} busy={busy === 'empty'} disabled={!!busy} />
    </Card>
  );
}

/** Seven days of sales, one thin bar per day. Tap a bar to read its value. */
function SalesTrend({ data }: { data: { date: string; revenue: number; netProfit: number }[] }) {
  const { c, tf } = useFood();
  const [picked, setPicked] = useState(data.length - 1);
  const max = Math.max(...data.map(d => num(d.revenue)), 1);
  const current = data[Math.min(picked, data.length - 1)];
  return (
    <Card>
      <Text style={{ color: c.text, fontWeight: '800' }}>{tf('dash_salesTrend')}</Text>
      <Text style={{ color: c.muted, fontSize: 12, marginBottom: 10 }}>{fmtDate(current?.date)}: {inr(current?.revenue)} · {tf('dash_net')} {inr(current?.netProfit)}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 6 }}>
        {data.map((d, i) => {
          const height = Math.max((num(d.revenue) / max) * 96, num(d.revenue) > 0 ? 3 : 1);
          return (
            <Pressable key={d.date} onPress={() => setPicked(i)} style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}
              accessibilityRole="button" accessibilityLabel={`${fmtDate(d.date)}: ${inr(d.revenue)}`} accessibilityState={{ selected: i === picked }}>
              <View style={{ width: '70%', maxWidth: 36, height, backgroundColor: num(d.revenue) > 0 ? BAR_COLOR : c.border, opacity: i === picked ? 1 : 0.7, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
              <Text style={{ color: i === picked ? c.text : c.muted, fontSize: 11, fontWeight: i === picked ? '800' : '500', marginTop: 4 }}>{Number(d.date.slice(8, 10))}</Text>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

function CashUpiBar({ cash, upi }: { cash: number; upi: number }) {
  const { c, tf } = useFood();
  const legend = (color: string, label: string, value: number) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color: c.sub, fontSize: 12 }}>{label}: <Text style={{ fontWeight: '800', color: c.text }}>{inr(value)}</Text></Text>
    </View>
  );
  return (
    <Card>
      <Text style={{ color: c.text, fontWeight: '800', marginBottom: 10 }}>{tf('dash_cashVsUpi')}</Text>
      <View style={{ flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: c.border, gap: cash > 0 && upi > 0 ? 2 : 0 }}>
        {cash > 0 && <View style={{ flex: cash, backgroundColor: CASH_COLOR }} />}
        {upi > 0 && <View style={{ flex: upi, backgroundColor: UPI_COLOR }} />}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
        {legend(CASH_COLOR, tf('pay_cash'), cash)}
        {legend(UPI_COLOR, tf('pay_upi'), upi)}
      </View>
    </Card>
  );
}

export function DashboardScreen() {
  const { api, t, tf, c, push, open, has, meta, ownerName } = useFood();
  const [date, setDate] = useState(isoToday());
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get('/dashboard', { date }), [date]);
  const d = data as any;
  const today = d?.today;
  const unread = d?.unreadNotifications || 0;
  const bell = (
    <Pressable onPress={() => push('notifications')} hitSlop={10} accessibilityRole="button" accessibilityLabel={tf('ntf_title')}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 22 }}>🔔</Text>
      {unread > 0 && (
        <View style={{ position: 'absolute', top: 2, right: 0, backgroundColor: c.red, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{unread}</Text>
        </View>
      )}
    </Pressable>
  );
  const net = num(today?.netProfit);
  const quick = [
    { key: 'food_sales', label: tf('qa_sale'), icon: '💰', route: 'saleForm', section: 'food_sales' as const },
    { key: 'food_purchases', label: tf('qa_purchase'), icon: '🛒', route: 'purchaseForm', section: 'food_purchases' as const },
    { key: 'food_consumption', label: tf('qa_consumption'), icon: '🍳', route: 'consumptionForm', section: 'food_consumption' as const },
    { key: 'food_expenses', label: tf('qa_expense'), icon: '🧾', route: undefined, section: 'food_expenses' as const },
    { key: 'food_ai', label: tf('qa_ai'), icon: '🤖', route: undefined, section: 'food_ai' as const },
  ].filter(q => has(q.key));

  return (
    <Screen title={tf('dash_title')} subtitle={ownerName} noBack right={bell} onRefresh={reload} refreshing={refreshing}>
      {meta?.needsSetup && <SetupCard />}
      <View style={{ marginBottom: 10 }}><DateInput value={date} onChange={setDate} label={tf('common_date')} /></View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {quick.map(q => (
          <Pressable key={q.key} onPress={() => open(q.section, q.route)} accessibilityRole="button"
            style={({ pressed }) => [{ flexGrow: 1, flexBasis: 100, minHeight: 56, borderRadius: 12, backgroundColor: c.brandBg, alignItems: 'center', justifyContent: 'center', padding: 8 }, pressed && { opacity: 0.75 }]}>
            <Text style={{ fontSize: 18 }}>{q.icon}</Text>
            <Text style={{ color: c.brandText, fontWeight: '700', fontSize: 12, textAlign: 'center' }} numberOfLines={2}>{q.label}</Text>
          </Pressable>
        ))}
      </View>
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {d && (
          <>
            <View style={{ backgroundColor: net < 0 ? c.redBg : c.greenBg, borderRadius: 16, padding: 16, marginBottom: 10 }} accessible accessibilityLabel={`${tf('dash_netProfit')}: ${inr(net)}`}>
              <Text style={{ color: net < 0 ? c.red : c.green, fontWeight: '700', fontSize: 13 }}>{date === isoToday() ? tf('dash_netProfitToday') : `${tf('dash_netProfit')} · ${fmtDate(date)}`}</Text>
              <Text style={{ color: net < 0 ? c.red : c.green, fontWeight: '900', fontSize: 34, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{inr(net)}</Text>
              <Text style={{ color: c.sub, fontSize: 12, marginTop: 4 }}>{tf('dash_monthNet')}: <Text style={{ fontWeight: '800' }}>{inr(d.monthNetProfit)}</Text></Text>
            </View>

            <StatRow>
              <StatCard icon="💰" label={tf('dash_sales')} value={inr(today.revenue)} tone="green" onPress={has('food_sales') ? () => open('food_sales') : undefined} />
              <StatCard icon="🛒" label={tf('dash_purchase')} value={inr(today.purchases)} tone="blue" onPress={has('food_purchases') ? () => open('food_purchases') : undefined} />
              <StatCard icon="🍳" label={tf('dash_consumption')} value={inr(today.consumptionCost)} tone="amber" onPress={has('food_consumption') ? () => open('food_consumption') : undefined} />
              <StatCard icon="📦" label={tf('dash_openingStock')} value={inr(d.openingStockValue)} />
              <StatCard icon="📦" label={tf('dash_remainingStock')} value={inr(d.remainingStockValue)} onPress={has('food_inventory') ? () => open('food_inventory') : undefined} />
              <StatCard icon="🧾" label={tf('dash_expenses')} value={inr(today.expenses)} tone="amber" hint={num(today.expensesExcluded) > 0 ? tf('dash_expensesExcludedHint', { amount: inr(today.expensesExcluded) }) : undefined}
                onPress={has('food_expenses') ? () => open('food_expenses') : undefined} />
              <StatCard icon="📈" label={tf('dash_gross')} value={inr(today.grossProfit)} tone={num(today.grossProfit) < 0 ? 'red' : 'green'} />
              <StatCard icon="🏆" label={tf('dash_netProfit')} value={inr(today.netProfit)} tone={net < 0 ? 'red' : 'green'} />
              <StatCard icon="💵" label={tf('dash_cashReceived')} value={inr(d.cashReceived)} />
              <StatCard icon="📱" label={tf('dash_upiReceived')} value={inr(d.upiReceived)} />
              <StatCard icon="⏳" label={tf('dash_pending')} value={inr(d.pendingReceivable)} tone={num(d.pendingReceivable) > 0 ? 'red' : 'brand'} hint={tf('dash_toCollect')}
                onPress={has('food_sales') ? () => open('food_sales', 'pending') : undefined} />
              <StatCard icon="🏪" label={tf('dash_supplierDue')} value={inr(d.pendingPayable)} tone={num(d.pendingPayable) > 0 ? 'amber' : 'brand'} hint={tf('dash_toPay')}
                onPress={has('food_sales') ? () => open('food_sales', 'pending') : undefined} />
            </StatRow>

            <Grid>
              <SalesTrend data={d.trend} />
              <CashUpiBar cash={num(d.cashReceived)} upi={num(d.upiReceived)} />
            </Grid>

            <Grid>
              <Card>
                <Text style={{ color: c.text, fontWeight: '800', marginBottom: 6 }}>{tf('dash_pnlTitle')}</Text>
                <KV label={tf('pnl_revenue')} value={inr(today.revenue)} />
                <KV label={tf('pnl_cogs')} value={inr(today.cogs)} />
                <KV label={tf('pnl_gross')} value={inr(today.grossProfit)} strong />
                <KV label={tf('pnl_otherExpenses')} value={inr(today.expenses)} />
                {num(today.wastage) + num(today.spoilage) > 0 && <KV label={tf('pnl_wastage')} value={inr(num(today.wastage) + num(today.spoilage))} />}
                {num(today.adjustmentNet) !== 0 && <KV label={tf('pnl_adjustments')} value={inr(today.adjustmentNet)} />}
                <KV label={tf('pnl_net')} value={inr(today.netProfit)} strong color={net < 0 ? c.red : c.green} />
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 6 }}>{tf('dash_purchaseNote')}</Text>
                {has('food_reports') && <View style={{ marginTop: 8 }}><Btn small kind="secondary" title={tf('dash_fullPnl')} onPress={() => open('food_reports', 'pnl')} /></View>}
              </Card>
              <Card>
                <Text style={{ color: c.text, fontWeight: '800', marginBottom: 6 }}>{tf('dash_topFoods')}</Text>
                {!d.topFoods.length && <Text style={{ color: c.muted }}>{tf('dash_noSales')}</Text>}
                {d.topFoods.map((f: any) => {
                  const best = Math.max(...d.topFoods.map((x: any) => Math.abs(num(x.profit))), 1);
                  return (
                    <View key={f.food} style={{ marginVertical: 5 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                        <Text style={{ color: c.text, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{f.food} · {qty(f.quantity)}</Text>
                        <Text style={{ color: c.text, fontWeight: '800' }}>{f.costMissing ? tf('menu_noCost') : inr(f.profit)}</Text>
                      </View>
                      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.border, marginTop: 4, overflow: 'hidden' }}>
                        <View style={{ width: `${Math.min((Math.abs(num(f.profit)) / best) * 100, 100)}%`, height: '100%', backgroundColor: num(f.profit) < 0 ? c.red : BAR_COLOR }} />
                      </View>
                    </View>
                  );
                })}
              </Card>
            </Grid>

            {d.attentionCount > 0 && (
              <>
                <SectionTitle right={has('food_inventory') ? <Btn small kind="ghost" title={tf('common_viewAll')} onPress={() => open('food_inventory')} /> : undefined}>
                  {tf('dash_attention', { count: d.attentionCount })}
                </SectionTitle>
                <Grid>
                  {d.attention.map((p: any) => (
                    <Card key={p.id} onPress={has('food_inventory') ? () => open('food_inventory', 'productDetail', { id: p.id }) : undefined} a11y={p.name}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: c.text, fontWeight: '700' }} numberOfLines={1}>{p.name}</Text>
                          <Text style={{ color: c.muted, fontSize: 12 }}>{qty(p.stockQty)} {p.unit} · {tf('prod_alertAt', { qty: qty(p.minStockAlert) })}</Text>
                        </View>
                        <StockPill state={p.state} />
                      </View>
                    </Card>
                  ))}
                </Grid>
              </>
            )}

            <BtnRow>
              {has('food_inventory') && <Btn small kind="ghost" icon="⚙️" title={tf('set_title')} onPress={() => open('food_inventory', 'settings')} />}
            </BtnRow>
          </>
        )}
      </Gate>
    </Screen>
  );
}

const NOTIFICATION_ICONS: Record<string, string> = {
  low_stock: '⚠️', out_of_stock: '⛔', excess_consumption: '🍳', sales_summary: '💰', profit_summary: '📈', unusual_expense: '🧾', pending_payments: '⏳',
};

export function NotificationsScreen() {
  const { api, tf, c, bump } = useFood();
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get('/notifications'), []);
  const items = (data as any)?.notifications || [];
  const unread = items.filter((n: any) => !n.isRead).length;
  const readAll = async () => { await api.post('/notifications/read', {}); bump(); };
  // The stored message is English; known types read in the owner's language.
  const text = (n: any) => {
    const key = `ntf_${n.type}` as any;
    const translated = tf(key, n.params);
    return translated === key ? n.message : translated;
  };
  return (
    <Screen title={tf('ntf_title')} onRefresh={reload} refreshing={refreshing}
      right={unread > 0 ? <Btn small kind="ghost" title={tf('ntf_readAll')} onPress={readAll} /> : undefined}>
      <Gate loading={loading && !data} error={error} onRetry={reload}>
        {!items.length && <Empty text={tf('ntf_empty')} />}
        {items.map((n: any) => (
          <View key={n.id} style={{ flexDirection: 'row', gap: 10, backgroundColor: n.isRead ? c.card : c.brandBg, borderColor: c.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 }}>
            <Text style={{ fontSize: 20 }}>{NOTIFICATION_ICONS[n.type] || '🔔'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontWeight: n.isRead ? '500' : '700' }}>{text(n)}</Text>
              <Text style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>{fmtDate(n.createdAt)}</Text>
            </View>
          </View>
        ))}
      </Gate>
    </Screen>
  );
}
