/**
 * Mahila Bachat Gat - shared mobile UI kit.
 * Touch targets are >= 44pt, text scales with the system font size, and every
 * interactive element carries an accessibility label.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ShgApi, ShgApiError, newIdempotencyKey } from './api';
import { fmtDate, inr, isoToday, toIso } from './format';
import { ShgKey } from './i18n';

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
export const light = {
  page: '#F8FAFC', card: '#FFFFFF', text: '#0F172A', sub: '#475569', muted: '#64748B', border: '#E2E8F0',
  brand: '#4F46E5', brandBg: '#EEF2FF', brandText: '#3730A3', onBrand: '#FFFFFF',
  green: '#047857', greenBg: '#ECFDF5', red: '#B91C1C', redBg: '#FEF2F2', amber: '#B45309', amberBg: '#FFFBEB',
  blue: '#1D4ED8', blueBg: '#EFF6FF', input: '#FFFFFF', overlay: 'rgba(15,23,42,0.5)', nav: '#FFFFFF',
};
export const dark: typeof light = {
  page: '#0B1120', card: '#1E293B', text: '#F1F5F9', sub: '#CBD5E1', muted: '#94A3B8', border: '#334155',
  brand: '#818CF8', brandBg: '#312E81', brandText: '#E0E7FF', onBrand: '#0B1120',
  green: '#34D399', greenBg: '#064E3B', red: '#F87171', redBg: '#450A0A', amber: '#FBBF24', amberBg: '#451A03',
  blue: '#93C5FD', blueBg: '#1E3A8A', input: '#0F172A', overlay: 'rgba(0,0,0,0.65)', nav: '#111827',
};
export type Palette = typeof light;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
export interface Route {
  name: string;
  params?: Record<string, any>;
}

export interface ShgContext {
  api: ShgApi;
  t: (key: ShgKey, vars?: Record<string, string | number>) => string;
  st: (value?: string | null) => string;
  c: Palette;
  push: (name: string, params?: Record<string, any>) => void;
  replace: (name: string, params?: Record<string, any>) => void;
  back: () => void;
  groupId: number | null;
  setGroupId: (id: number | null) => void;
  groups: any[];
  reloadGroups: () => Promise<void>;
  features: string[];
  has: (feature: string) => boolean;
  dataVersion: number;
  bump: () => void;
  toast: (message: string, kind?: 'ok' | 'error') => void;
  ownerName: string;
  lang: string;
}

export const ShgCtx = createContext<ShgContext | null>(null);

export function useShg(): ShgContext {
  const ctx = useContext(ShgCtx);
  if (!ctx) throw new Error('useShg outside ShgCtx');
  return ctx;
}

export function errorText(t: ShgContext['t'], e: unknown): string {
  if (e instanceof ShgApiError) {
    if (e.status === 0) return t('err_network');
    return e.details?.length ? `${e.message}\n• ${e.details.join('\n• ')}` : e.message;
  }
  return t('err_generic');
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const { dataVersion, t } = useShg();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const run = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const result = await loader();
      if (alive.current) setData(result);
    } catch (e) {
      if (alive.current) setError(errorText(t, e));
    } finally {
      if (alive.current) { setLoading(false); setRefreshing(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run, dataVersion]);
  return { data, setData, loading, refreshing, error, reload: () => run(true) };
}

/** Paged list that appends pages ("Load more") and restarts when deps change. */
export function usePaged<T>(loader: (page: number) => Promise<{ items: T[]; hasMore: boolean }>, deps: unknown[]) {
  const { dataVersion, t } = useShg();
  const [items, setItems] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gen = useRef(0);

  const load = useCallback(async (p: number, mode: 'reset' | 'more' | 'refresh') => {
    const my = ++gen.current;
    if (mode === 'more') setLoadingMore(true); else if (mode === 'refresh') setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const res = await loader(p);
      if (my !== gen.current) return;
      setItems(prev => (p === 1 ? res.items : [...prev, ...res.items]));
      setHasMore(res.hasMore);
      setPage(p);
    } catch (e) {
      if (my === gen.current) setError(errorText(t, e));
    } finally {
      if (my === gen.current) { setLoading(false); setLoadingMore(false); setRefreshing(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { load(1, 'reset'); }, [load, dataVersion]);
  return {
    items, loading, loadingMore, refreshing, error, hasMore,
    reload: () => load(1, 'refresh'),
    loadMore: () => { if (hasMore && !loadingMore) load(page + 1, 'more'); },
  };
}

/** "Load more" footer for usePaged lists. */
export function LoadMore({ list }: { list: { hasMore: boolean; loadingMore: boolean; loadMore: () => void } }) {
  const { t } = useShg();
  if (!list.hasMore) return null;
  return <Btn kind="ghost" title={t('common_loadMore')} onPress={list.loadMore} busy={list.loadingMore} />;
}

/**
 * Submits a form at most once. The idempotency key stays the same across
 * retries of one submission and changes only after the server confirms, so a
 * dropped connection can never create a second posting.
 */
export function useSubmit() {
  const { t } = useShg();
  const keyRef = useRef(newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false); // sent, not confirmed
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async <T,>(fn: (key: string) => Promise<T>): Promise<T | null> => {
    if (busy) return null;
    setBusy(true);
    setError(null);
    try {
      const result = await fn(keyRef.current);
      keyRef.current = newIdempotencyKey();
      setPending(false);
      return result;
    } catch (e) {
      if (e instanceof ShgApiError && e.uncertain) {
        setPending(true);
        setError(t('err_unconfirmed'));
      } else {
        // A definite rejection: nothing was posted, a corrected retry is a new submission.
        keyRef.current = newIdempotencyKey();
        setPending(false);
        setError(errorText(t, e));
      }
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, t]);

  return { submit, busy, pending, error, setError };
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------
export function Screen({ title, subtitle, children, onRefresh, refreshing, right, noBack }: {
  title: string; subtitle?: string; children: React.ReactNode; onRefresh?: () => void; refreshing?: boolean;
  right?: React.ReactNode; noBack?: boolean;
}) {
  const { c, back, t } = useShg();
  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <View style={[s.header, { borderBottomColor: c.border, backgroundColor: c.card }]}>
        {!noBack && (
          <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={t('a11y_back')} hitSlop={12} style={s.backBtn}>
            <Text style={[s.backText, { color: c.brand }]}>‹</Text>
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: c.text }]} numberOfLines={1} accessibilityRole="header">{title}</Text>
          {!!subtitle && <Text style={[s.subtitle, { color: c.muted }]} numberOfLines={1}>{subtitle}</Text>}
        </View>
        {right}
      </View>
      <ScrollView
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={c.brand} /> : undefined}>
        {children}
      </ScrollView>
    </View>
  );
}

export function Card({ children, style, onPress, a11y }: { children: React.ReactNode; style?: any; onPress?: () => void; a11y?: string }) {
  const { c } = useShg();
  const body = <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>;
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} style={({ pressed }) => pressed && { opacity: 0.75 }}>
      {body}
    </Pressable>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const { c } = useShg();
  return (
    <View style={s.sectionRow}>
      <Text style={[s.section, { color: c.sub }]} accessibilityRole="header">{children}</Text>
      {right}
    </View>
  );
}

export function KV({ label, value, strong, color }: { label: string; value: React.ReactNode; strong?: boolean; color?: string }) {
  const { c } = useShg();
  return (
    <View style={s.kv}>
      <Text style={[s.kvLabel, { color: c.muted }]}>{label}</Text>
      <Text style={[s.kvValue, { color: color || c.text }, strong && { fontWeight: '800' }]} selectable>{value ?? '-'}</Text>
    </View>
  );
}

export function Stat({ label, value, tone = 'brand', onPress }: { label: string; value: string; tone?: 'brand' | 'green' | 'red' | 'amber' | 'blue'; onPress?: () => void }) {
  const { c } = useShg();
  const fg = { brand: c.brandText, green: c.green, red: c.red, amber: c.amber, blue: c.blue }[tone];
  const bg = { brand: c.brandBg, green: c.greenBg, red: c.redBg, amber: c.amberBg, blue: c.blueBg }[tone];
  const inner = (
    <View style={[s.stat, { backgroundColor: bg }]}>
      <Text style={[s.statValue, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={[s.statLabel, { color: fg }]} numberOfLines={2}>{label}</Text>
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} style={s.statWrap} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>{inner}</Pressable>
  ) : <View style={s.statWrap} accessible accessibilityLabel={`${label}: ${value}`}>{inner}</View>;
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={s.statGrid}>{children}</View>;
}

export function Btn({ title, onPress, kind = 'primary', busy, disabled, small, icon }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; busy?: boolean; disabled?: boolean; small?: boolean; icon?: string;
}) {
  const { c } = useShg();
  const bg = { primary: c.brand, secondary: c.brandBg, danger: c.red, ghost: 'transparent' }[kind];
  const fg = { primary: c.onBrand, secondary: c.brandText, danger: '#FFFFFF', ghost: c.brand }[kind];
  const off = disabled || busy;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={({ pressed }) => [s.btn, small && s.btnSmall, { backgroundColor: bg, opacity: off ? 0.55 : pressed ? 0.8 : 1 },
        kind === 'ghost' && { borderWidth: 1, borderColor: c.border }]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, small && { fontSize: 13 }, { color: fg }]}>{icon ? `${icon} ` : ''}{title}</Text>}
    </Pressable>
  );
}

export function BtnRow({ children }: { children: React.ReactNode }) {
  return <View style={s.btnRow}>{children}</View>;
}

const TONES: Record<string, 'green' | 'red' | 'amber' | 'blue' | 'muted'> = {
  Active: 'green', Paid: 'green', Approved: 'green', Verified: 'green', Passed: 'green', Posted: 'green', Closed: 'muted',
  'Minutes Approved': 'green', Disbursed: 'blue', Held: 'blue', Submitted: 'amber', 'Under Review': 'amber',
  'Pending Approval': 'amber', Pending: 'amber', Partial: 'amber', Scheduled: 'blue', Draft: 'muted', Open: 'amber',
  'Under Verification': 'amber', Overdue: 'red', Rejected: 'red', Suspended: 'red', Reversed: 'red', Failed: 'red',
  Exited: 'muted', Cancelled: 'muted', 'Written Off': 'red', Waived: 'muted', 'Not Verified': 'amber', 'Not Required': 'muted',
};

export function Badge({ value, label }: { value?: string | null; label?: string }) {
  const { c, st } = useShg();
  if (!value) return null;
  const tone = TONES[value] || 'muted';
  const fg = { green: c.green, red: c.red, amber: c.amber, blue: c.blue, muted: c.muted }[tone];
  const bg = { green: c.greenBg, red: c.redBg, amber: c.amberBg, blue: c.blueBg, muted: c.border }[tone];
  return (
    <View style={[s.badge, { backgroundColor: bg }]} accessible accessibilityLabel={label || st(value)}>
      <Text style={[s.badgeText, { color: fg }]} numberOfLines={1}>{label || st(value)}</Text>
    </View>
  );
}

export function ListItem({ title, subtitle, right, badge, onPress, meta }: {
  title: string; subtitle?: string; right?: string; badge?: string | null; onPress?: () => void; meta?: string;
}) {
  const { c } = useShg();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[title, subtitle, right].filter(Boolean).join(', ')}
      style={({ pressed }) => [s.item, { backgroundColor: c.card, borderColor: c.border }, pressed && { opacity: 0.75 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.itemTitle, { color: c.text }]} numberOfLines={1}>{title}</Text>
        {!!subtitle && <Text style={[s.itemSub, { color: c.muted }]} numberOfLines={2}>{subtitle}</Text>}
        {!!meta && <Text style={[s.itemSub, { color: c.muted }]} numberOfLines={1}>{meta}</Text>}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4, marginLeft: 8, maxWidth: '45%' }}>
        {!!right && <Text style={[s.itemRight, { color: c.text }]} numberOfLines={1}>{right}</Text>}
        {!!badge && <Badge value={badge} />}
      </View>
      {onPress && <Text style={{ color: c.muted, fontSize: 20, marginLeft: 6 }}>›</Text>}
    </Pressable>
  );
}

export function Loading() {
  const { c, t } = useShg();
  return (
    <View style={s.center} accessibilityLabel={t('common_loading')}>
      <ActivityIndicator color={c.brand} size="large" />
    </View>
  );
}

export function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  const { c } = useShg();
  return (
    <View style={[s.center, { paddingVertical: 32 }]}>
      <Text style={{ fontSize: 34, marginBottom: 6 }}>🌱</Text>
      <Text style={{ color: c.muted, textAlign: 'center', fontSize: 14 }}>{text}</Text>
      {action && onAction && <View style={{ marginTop: 12 }}><Btn title={action} onPress={onAction} small /></View>}
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { c, t } = useShg();
  return (
    <View style={[s.errorBox, { backgroundColor: c.redBg, borderColor: c.red }]} accessibilityLiveRegion="polite">
      <Text style={{ color: c.red, fontWeight: '600' }}>{message}</Text>
      {onRetry && <View style={{ marginTop: 8, alignSelf: 'flex-start' }}><Btn title={t('common_retry')} onPress={onRetry} small kind="secondary" /></View>}
    </View>
  );
}

export function Notice({ text, tone = 'amber' }: { text: string; tone?: 'amber' | 'green' | 'blue' | 'red' }) {
  const { c } = useShg();
  const fg = { amber: c.amber, green: c.green, blue: c.blue, red: c.red }[tone];
  const bg = { amber: c.amberBg, green: c.greenBg, blue: c.blueBg, red: c.redBg }[tone];
  return <View style={[s.notice, { backgroundColor: bg }]}><Text style={{ color: fg, fontSize: 13 }}>{text}</Text></View>;
}

/** Shows a loading / error / empty state, or the children. */
export function Gate({ loading, error, onRetry, empty, emptyText, children }: {
  loading: boolean; error: string | null; onRetry?: () => void; empty?: boolean; emptyText?: string; children: React.ReactNode;
}) {
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={onRetry} />;
  if (empty) return <Empty text={emptyText || ''} />;
  return <>{children}</>;
}

export function Chips<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  const { c } = useShg();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[s.chip, { borderColor: on ? c.brand : c.border, backgroundColor: on ? c.brandBg : c.card }]}>
            <Text style={{ color: on ? c.brandText : c.sub, fontWeight: on ? '700' : '500', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { c } = useShg();
  return (
    <View style={[s.search, { backgroundColor: c.input, borderColor: c.border }]}>
      <Text style={{ color: c.muted }}>🔍</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        accessibilityLabel={placeholder}
        style={[s.searchInput, { color: c.text }]}
        returnKeyType="search"
      />
      {!!value && <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityLabel="Clear"><Text style={{ color: c.muted }}>✕</Text></Pressable>}
    </View>
  );
}

export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// ---------------------------------------------------------------------------
// Form builder
// ---------------------------------------------------------------------------
export type FieldType = 'text' | 'multiline' | 'money' | 'number' | 'decimal' | 'phone' | 'date' | 'select' | 'switch';

export interface FieldSpec {
  key: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  maxLength?: number;
  hidden?: boolean;
  min?: number;
  max?: number;
}

export function validate(fields: FieldSpec[], values: Record<string, any>, t: ShgContext['t']): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.hidden) continue;
    const v = values[f.key];
    const empty = v === undefined || v === null || String(v).trim() === '';
    if (f.required && empty && f.type !== 'switch') {
      errors[f.key] = t('val_required');
      continue;
    }
    if (empty) continue;
    if (f.type === 'money' || f.type === 'decimal' || f.type === 'number') {
      const n = Number(v);
      if (!isFinite(n) || (f.type === 'number' && !Number.isInteger(n))) errors[f.key] = t('val_number');
      else if (f.type === 'money' && n < 0) errors[f.key] = t('val_positive');
      else if (f.min !== undefined && n < f.min) errors[f.key] = t('val_min', { min: f.min });
      else if (f.max !== undefined && n > f.max) errors[f.key] = t('val_max', { max: f.max });
    }
    if (f.type === 'phone' && !/^[6-9]\d{9}$/.test(String(v).replace(/\D/g, '').slice(-10))) errors[f.key] = t('val_phone');
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors[f.key] = t('val_date');
  }
  return errors;
}

export function Form({ fields, values, onChange, errors }: {
  fields: FieldSpec[]; values: Record<string, any>; onChange: (key: string, v: any) => void; errors: Record<string, string>;
}) {
  return (
    <View>
      {fields.filter(f => !f.hidden).map(f => (
        <Field key={f.key} spec={f} value={values[f.key]} onChange={v => onChange(f.key, v)} error={errors[f.key]} />
      ))}
    </View>
  );
}

export function Field({ spec, value, onChange, error }: { spec: FieldSpec; value: any; onChange: (v: any) => void; error?: string }) {
  const { c } = useShg();
  const type = spec.type || 'text';
  const label = `${spec.label}${spec.required ? ' *' : ''}`;
  let control: React.ReactNode;
  if (type === 'switch') {
    return (
      <View style={[s.switchRow, { borderColor: c.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.label, { color: c.text, marginBottom: 0 }]}>{spec.label}</Text>
          {!!spec.help && <Text style={[s.help, { color: c.muted }]}>{spec.help}</Text>}
        </View>
        <Switch value={!!value} onValueChange={onChange} accessibilityLabel={spec.label} trackColor={{ true: c.brand, false: c.border }} />
      </View>
    );
  }
  if (type === 'date') control = <DateInput value={value} onChange={onChange} label={spec.label} />;
  else if (type === 'select') control = <SelectInput value={value} onChange={onChange} options={spec.options || []} label={spec.label} placeholder={spec.placeholder} />;
  else {
    const keyboard = type === 'money' || type === 'decimal' ? 'decimal-pad' : type === 'number' || type === 'phone' ? 'number-pad' : 'default';
    control = (
      <View style={[s.inputWrap, { backgroundColor: c.input, borderColor: error ? c.red : c.border }]}>
        {type === 'money' && <Text style={{ color: c.muted, fontSize: 16, marginRight: 4 }}>₹</Text>}
        <TextInput
          value={value === undefined || value === null ? '' : String(value)}
          onChangeText={onChange}
          keyboardType={keyboard}
          multiline={type === 'multiline'}
          maxLength={spec.maxLength || (type === 'phone' ? 10 : type === 'multiline' ? 4000 : 200)}
          placeholder={spec.placeholder}
          placeholderTextColor={c.muted}
          accessibilityLabel={spec.label}
          accessibilityHint={spec.help}
          style={[s.input, { color: c.text }, type === 'multiline' && { minHeight: 88, textAlignVertical: 'top' }]}
        />
      </View>
    );
  }
  return (
    <View style={s.field}>
      <Text style={[s.label, { color: c.sub }]}>{label}</Text>
      {control}
      {!!spec.help && !error && <Text style={[s.help, { color: c.muted }]}>{spec.help}</Text>}
      {!!error && <Text style={[s.help, { color: c.red }]} accessibilityLiveRegion="polite">{error}</Text>}
    </View>
  );
}

export function SelectInput({ value, onChange, options, label, placeholder }: {
  value: any; onChange: (v: any) => void; options: { value: string; label: string }[]; label: string; placeholder?: string;
}) {
  const { c, t } = useShg();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find(o => String(o.value) === String(value));
  const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label || placeholder || t('common_select')}`}
        style={[s.inputWrap, { backgroundColor: c.input, borderColor: c.border, minHeight: 48 }]}>
        <Text style={{ flex: 1, color: current ? c.text : c.muted, fontSize: 15 }} numberOfLines={1}>{current?.label || placeholder || t('common_select')}</Text>
        <Text style={{ color: c.muted }}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={[s.overlay, { backgroundColor: c.overlay }]} onPress={() => setOpen(false)}>
          <Pressable style={[s.sheet, { backgroundColor: c.card }]} onPress={() => {}}>
            <Text style={[s.sheetTitle, { color: c.text }]}>{label}</Text>
            {options.length > 8 && <SearchBar value={q} onChange={setQ} placeholder={t('common_search')} />}
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              {filtered.map(o => (
                <Pressable
                  key={String(o.value)}
                  onPress={() => { onChange(o.value); setOpen(false); setQ(''); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: String(o.value) === String(value) }}
                  style={[s.option, { borderBottomColor: c.border }]}>
                  <Text style={{ color: c.text, fontSize: 15, fontWeight: String(o.value) === String(value) ? '700' : '400' }}>{o.label}</Text>
                </Pressable>
              ))}
              {!filtered.length && <Text style={{ color: c.muted, padding: 16 }}>{t('common_noResults')}</Text>}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function DateInput({ value, onChange, label }: { value?: string; onChange: (v: string) => void; label: string }) {
  const { c, t } = useShg();
  const [open, setOpen] = useState(false);
  const initial = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date();
  const [cursor, setCursor] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const days = useMemo(() => {
    const first = cursor.getDay();
    const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    return [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  }, [cursor]);
  const pick = (d: number) => { onChange(toIso(new Date(cursor.getFullYear(), cursor.getMonth(), d))); setOpen(false); };
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? fmtDate(value) : t('common_select')}`}
        style={[s.inputWrap, { backgroundColor: c.input, borderColor: c.border, minHeight: 48 }]}>
        <Text style={{ flex: 1, color: value ? c.text : c.muted, fontSize: 15 }}>{value ? fmtDate(value) : t('common_select')}</Text>
        <Text>📅</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[s.overlay, { backgroundColor: c.overlay, justifyContent: 'center' }]} onPress={() => setOpen(false)}>
          <Pressable style={[s.calendar, { backgroundColor: c.card }]} onPress={() => {}}>
            <View style={s.calHead}>
              <Pressable onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} hitSlop={12} accessibilityLabel={t('a11y_prevMonth')} style={s.calNav}>
                <Text style={{ color: c.brand, fontSize: 22 }}>‹</Text>
              </Pressable>
              <Pressable onPress={() => setCursor(new Date(cursor.getFullYear() - 1, cursor.getMonth(), 1))} onLongPress={() => setCursor(new Date(cursor.getFullYear() + 1, cursor.getMonth(), 1))}>
                <Text style={{ color: c.text, fontWeight: '700', fontSize: 16 }}>{MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}</Text>
              </Pressable>
              <Pressable onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} hitSlop={12} accessibilityLabel={t('a11y_nextMonth')} style={s.calNav}>
                <Text style={{ color: c.brand, fontSize: 22 }}>›</Text>
              </Pressable>
            </View>
            <View style={s.calGrid}>
              {WEEKDAYS.map((w, i) => <Text key={`w${i}`} style={[s.calCell, { color: c.muted, fontWeight: '700' }]}>{w}</Text>)}
              {days.map((d, i) => {
                const iso = d ? toIso(new Date(cursor.getFullYear(), cursor.getMonth(), d)) : '';
                const on = iso === value;
                return d ? (
                  <Pressable key={i} onPress={() => pick(d)} style={[s.calCellBox, on && { backgroundColor: c.brand, borderRadius: 20 }]}
                    accessibilityRole="button" accessibilityLabel={fmtDate(iso)}>
                    <Text style={{ color: on ? c.onBrand : iso === isoToday() ? c.brand : c.text, fontWeight: iso === isoToday() ? '800' : '400' }}>{d}</Text>
                  </Pressable>
                ) : <View key={i} style={s.calCellBox} />;
              })}
            </View>
            <BtnRow>
              <Btn title={t('common_today')} small kind="secondary" onPress={() => { onChange(isoToday()); setOpen(false); }} />
              <Btn title={t('common_close')} small kind="ghost" onPress={() => setOpen(false)} />
            </BtnRow>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export function confirm(title: string, message: string, ok: string, cancel: string, onOk: () => void, destructive = false) {
  Alert.alert(title, message, [{ text: cancel, style: 'cancel' }, { text: ok, style: destructive ? 'destructive' : 'default', onPress: onOk }]);
}

/** Bottom-sheet modal used for quick actions inside detail screens. */
export function Sheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const { c, t } = useShg();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[s.overlay, { backgroundColor: c.overlay }]} onPress={onClose}>
        <Pressable style={[s.sheet, { backgroundColor: c.card }]} onPress={() => {}}>
          <View style={s.sheetHead}>
            <Text style={[s.sheetTitle, { color: c.text, marginBottom: 0, flex: 1 }]}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('common_close')}><Text style={{ color: c.muted, fontSize: 18 }}>✕</Text></Pressable>
          </View>
          <ScrollView style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Form inside a sheet with validation and idempotent submit. */
export function FormSheet({ visible, title, fields, initial, onClose, onSubmit, submitLabel, notice }: {
  visible: boolean; title: string; fields: FieldSpec[]; initial?: Record<string, any>; onClose: () => void;
  onSubmit: (values: Record<string, any>, key: string) => Promise<any>; submitLabel?: string; notice?: string;
}) {
  const { t } = useShg();
  const [values, setValues] = useState<Record<string, any>>(initial || {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { submit, busy, pending, error } = useSubmit();
  useEffect(() => { if (visible) { setValues(initial || {}); setErrors({}); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const go = async () => {
    const errs = validate(fields, values, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const ok = await submit(key => onSubmit(values, key));
    if (ok !== null) onClose();
  };
  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      {!!notice && <Notice text={notice} tone="blue" />}
      <Form fields={fields} values={values} onChange={(k, v) => setValues(p => ({ ...p, [k]: v }))} errors={errors} />
      {!!error && <ErrorBox message={error} />}
      <Btn title={pending ? t('common_retrySame') : (submitLabel || t('common_save'))} onPress={go} busy={busy} />
      <View style={{ height: 24 }} />
    </Sheet>
  );
}

export function money(v: unknown) { return inr(v); }

export const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 56 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  backText: { fontSize: 32, lineHeight: 34, fontWeight: '400' },
  title: { fontSize: 18, fontWeight: '800' },
  subtitle: { fontSize: 12, marginTop: 1 },
  body: { padding: 16, paddingBottom: 120 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, marginBottom: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 8 },
  section: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 12 },
  kvLabel: { fontSize: 13, flexShrink: 1 },
  kvValue: { fontSize: 14, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginBottom: 6 },
  statWrap: { width: '50%', padding: 5 },
  stat: { borderRadius: 14, padding: 12, minHeight: 78, justifyContent: 'space-between' },
  statValue: { fontSize: 20, fontWeight: '800' },
  statLabel: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  btn: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginVertical: 5 },
  btnSmall: { minHeight: 40, paddingHorizontal: 12, borderRadius: 10 },
  btnText: { fontSize: 15, fontWeight: '700' },
  btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  item: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, marginBottom: 8, minHeight: 60 },
  itemTitle: { fontSize: 15, fontWeight: '700' },
  itemSub: { fontSize: 12, marginTop: 2 },
  itemRight: { fontSize: 14, fontWeight: '700' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginVertical: 8 },
  notice: { borderRadius: 10, padding: 10, marginVertical: 6 },
  chips: { gap: 8, paddingVertical: 4, paddingRight: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, minHeight: 46, gap: 8, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  field: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  help: { fontSize: 12, marginTop: 4 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 15, paddingVertical: 12, minHeight: 48 },
  switchRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10, marginBottom: 6, gap: 10 },
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '92%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '800', marginBottom: 10 },
  option: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  calendar: { marginHorizontal: 16, borderRadius: 18, padding: 14 },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  calNav: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  calCell: { width: `${100 / 7}%`, textAlign: 'center', paddingVertical: 6 },
  calCellBox: { width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center' },
});
