/**
 * TransactionLog.tsx
 * Home-screen transaction log for product businesses (fruit/vegetable sellers, shops):
 * the latest 5 money/stock movements in a compact grid, and "View all" for the full,
 * paged history with a type filter. Data: GET /api/inventory/activity.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TranslationKey } from '../../i18n';

type Kind = 'SALE' | 'PURCHASE' | 'WASTAGE' | 'PAYMENT_IN' | 'PAYMENT_OUT' | 'EXPENSE' | 'BILL';

interface LogItem {
  id: string;
  type: Kind;
  title: string;
  quantity: number | null;
  unit: string;
  amount: number;
  amountDue: number;
  paymentMethod: string;
  date: string | null;
  createdAt: string | null;
  note: string;
  vendor?: string;
}

const palette = {
  navy: '#0F172A', slate: '#334155', muted: '#64748B', border: '#E2E8F0', page: '#F8FAFC', panel: '#FFFFFF',
  brand: '#4F46E5', brandBg: '#EEF2FF', green: '#059669', greenBg: '#ECFDF5', red: '#DC2626', redBg: '#FEF2F2',
  amber: '#D97706', amberBg: '#FFFBEB', blue: '#2563EB', blueBg: '#EFF6FF',
};

const KIND_STYLE: Record<Kind, { sign: string; color: string; bg: string; label: TranslationKey }> = {
  SALE: { sign: '+', color: palette.green, bg: palette.greenBg, label: 'txlog_SALE' },
  PAYMENT_IN: { sign: '+', color: palette.green, bg: palette.greenBg, label: 'txlog_PAYMENT_IN' },
  PURCHASE: { sign: '−', color: palette.red, bg: palette.redBg, label: 'txlog_PURCHASE' },
  PAYMENT_OUT: { sign: '−', color: palette.red, bg: palette.redBg, label: 'txlog_PAYMENT_OUT' },
  EXPENSE: { sign: '−', color: palette.red, bg: palette.redBg, label: 'txlog_EXPENSE' },
  WASTAGE: { sign: '', color: palette.amber, bg: palette.amberBg, label: 'txlog_WASTAGE' },
  BILL: { sign: '', color: palette.red, bg: palette.redBg, label: 'txlog_BILL' },
};

const FILTERS: ('ALL' | Kind)[] = ['ALL', 'SALE', 'PURCHASE', 'BILL', 'PAYMENT_IN', 'PAYMENT_OUT', 'EXPENSE', 'WASTAGE'];
const PAGE = 30;

type Props = {
  ownerId: number;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  /** Changes whenever the business data was reloaded, so the card refreshes too. */
  refreshKey?: unknown;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shortDate(item: LogItem) {
  if (!item.date) return '';
  const [, m, d] = item.date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] || ''}`;
}

function shortTime(item: LogItem) {
  if (!item.createdAt) return '';
  const dt = new Date(item.createdAt);
  return isNaN(dt.getTime()) ? '' : dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function money(n: number) {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function Row({ item, t, last }: { item: LogItem; t: Props['t']; last: boolean }) {
  const k = KIND_STYLE[item.type] || KIND_STYLE.SALE;
  const detail = [
    item.vendor || '',
    item.quantity ? `${item.quantity} ${item.unit}`.trim() : '',
    item.type === 'BILL' ? '' : item.paymentMethod,
    item.amountDue > 0 ? t('txlog_due', { amount: money(item.amountDue) }) : '',
    item.type === 'BILL' || item.type === 'PURCHASE' ? '' : item.note,
  ].filter(Boolean).join(' · ');
  return (
    <View style={[styles.row, !last && styles.rowBorder]} accessible
      accessibilityLabel={`${t(k.label)}, ${item.title}, ${k.sign}${money(item.amount)}, ${shortDate(item)}`}>
      <View style={styles.colDate}>
        <Text style={styles.cellStrong}>{shortDate(item)}</Text>
        <Text style={styles.cellSub}>{shortTime(item)}</Text>
      </View>
      <View style={styles.colDetail}>
        <Text style={styles.cellStrong} numberOfLines={1}>{item.title || '—'}</Text>
        {!!detail && <Text style={styles.cellSub} numberOfLines={1}>{detail}</Text>}
      </View>
      <View style={styles.colAmount}>
        <Text style={[styles.amount, { color: k.color }]} numberOfLines={1}>{k.sign}{money(item.amount)}</Text>
        <View style={[styles.badge, { backgroundColor: k.bg }]}>
          <Text style={[styles.badgeText, { color: k.color }]} numberOfLines={1}>{t(k.label)}</Text>
        </View>
      </View>
    </View>
  );
}

function GridHeader({ t }: { t: Props['t'] }) {
  return (
    <View style={styles.head}>
      <Text style={[styles.headText, styles.colDate]}>{t('txlog_colDate')}</Text>
      <Text style={[styles.headText, styles.colDetail]}>{t('txlog_colDetails')}</Text>
      <Text style={[styles.headText, styles.colAmount, { textAlign: 'right' }]}>{t('txlog_colAmount')}</Text>
    </View>
  );
}

export default function TransactionLogCard({ ownerId, apiFetch, t, refreshKey }: Props) {
  const [latest, setLatest] = useState<LogItem[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);

  const loadLatest = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/inventory/activity?owner_id=${ownerId}&limit=5`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setLatest(data.items || []);
      setError(false);
    } catch {
      setError(true);
    }
  }, [apiFetch, ownerId]);

  useEffect(() => { loadLatest(); }, [loadLatest, refreshKey]);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>🧾 {t('txlog_title')}</Text>
        {!!latest?.length && (
          <Pressable onPress={() => setOpen(true)} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>{t('drv_viewAll')}</Text>
          </Pressable>
        )}
      </View>
      {latest === null && !error ? (
        <ActivityIndicator color={palette.brand} style={{ marginVertical: 12 }} />
      ) : error ? (
        <Pressable onPress={loadLatest}><Text style={styles.empty}>{t('txlog_loadFailed')}</Text></Pressable>
      ) : latest!.length === 0 ? (
        <Text style={styles.empty}>{t('txlog_empty')}</Text>
      ) : (
        <>
          <GridHeader t={t} />
          {latest!.map((item, i) => <Row key={item.id} item={item} t={t} last={i === latest!.length - 1} />)}
        </>
      )}
      {open && <AllTransactionsModal ownerId={ownerId} apiFetch={apiFetch} t={t} onClose={() => setOpen(false)} />}
    </View>
  );
}

function AllTransactionsModal({ ownerId, apiFetch, t, onClose }: Omit<Props, 'refreshKey'> & { onClose: () => void }) {
  const [filter, setFilter] = useState<'ALL' | Kind>('ALL');
  const [items, setItems] = useState<LogItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError(false);
    try {
      const res = await apiFetch(`/api/inventory/activity?owner_id=${ownerId}&limit=${PAGE}&offset=${offset}&type=${filter}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setItems(prev => (offset === 0 ? data.items : [...prev, ...data.items]));
      setHasMore(!!data.hasMore);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, ownerId, filter]);

  useEffect(() => { setItems([]); load(0); }, [load]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalPage}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>🧾 {t('txlog_title')}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('txlog_close')}>
            <Text style={{ fontSize: 20, color: palette.muted }}>✕</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.chips}>
          {FILTERS.map(f => {
            const on = f === filter;
            return (
              <Pressable key={f} onPress={() => setFilter(f)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{f === 'ALL' ? t('txlog_all') : t(KIND_STYLE[f].label)}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
          <View style={styles.card}>
            <GridHeader t={t} />
            {items.map((item, i) => <Row key={item.id} item={item} t={t} last={i === items.length - 1} />)}
            {!loading && !error && items.length === 0 && <Text style={styles.empty}>{t('txlog_empty')}</Text>}
            {error && <Pressable onPress={() => load(items.length)}><Text style={styles.empty}>{t('txlog_loadFailed')}</Text></Pressable>}
            {loading && <ActivityIndicator color={palette.brand} style={{ marginVertical: 12 }} />}
            {hasMore && !loading && (
              <Pressable onPress={() => load(items.length)} style={styles.more} accessibilityRole="button">
                <Text style={styles.link}>{t('txlog_loadMore')}</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.border, borderRadius: 14, padding: 12, marginBottom: 14 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: palette.navy },
  link: { fontSize: 12, fontWeight: '700', color: palette.brand },
  empty: { fontSize: 12, color: palette.muted, textAlign: 'center', paddingVertical: 12 },
  head: { flexDirection: 'row', backgroundColor: palette.page, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 6 },
  headText: { fontSize: 10, fontWeight: '800', color: palette.muted, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 6 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: palette.border },
  colDate: { width: 54 },
  colDetail: { flex: 1, paddingRight: 6 },
  colAmount: { width: 96, alignItems: 'flex-end' },
  cellStrong: { fontSize: 12, fontWeight: '700', color: palette.navy },
  cellSub: { fontSize: 10, color: palette.muted, marginTop: 1 },
  amount: { fontSize: 12, fontWeight: '800' },
  badge: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, marginTop: 2, maxWidth: 96 },
  badgeText: { fontSize: 9, fontWeight: '700' },
  more: { alignItems: 'center', paddingVertical: 12 },
  modalPage: { flex: 1, backgroundColor: palette.page, paddingTop: 36 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: palette.navy },
  chips: { gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  chip: { borderWidth: 1, borderColor: palette.border, backgroundColor: palette.panel, borderRadius: 999, paddingHorizontal: 12, minHeight: 34, justifyContent: 'center' },
  chipOn: { borderColor: palette.brand, backgroundColor: palette.brandBg },
  chipText: { fontSize: 12, color: palette.slate, fontWeight: '600' },
  chipTextOn: { color: palette.brand, fontWeight: '800' },
});
