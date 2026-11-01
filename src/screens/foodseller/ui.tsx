/**
 * Food Seller - UI helpers on top of the app's shared kit (src/screens/bachatgat/ui.tsx),
 * so forms, cards and states look and behave the same across business types.
 * Everything here adapts to phone, tablet and desktop widths.
 */

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Alert, Platform, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { newIdempotencyKey } from '../bachatgat/api';
import { ShgContext, errorText, useShg } from '../bachatgat/ui';
import { FoodApi, FoodApiError } from './api';
import { FoodKey } from './i18n';

export {
  Badge, Btn, BtnRow, Card, Chips, Empty, ErrorBox, Field, Form, FormSheet, Gate, KV, ListItem, LoadMore, Loading, Notice, Screen,
  SearchBar, SectionTitle, SelectInput, DateInput, Sheet, errorText, useDebounced, useLoad, usePaged, validate,
} from '../bachatgat/ui';
export type { FieldSpec } from '../bachatgat/ui';

export interface FoodMeta {
  units: any[]; categories: any[]; expenseCategories: any[]; suppliers: any[]; settings: any; features: string[]; needsSetup: boolean; today: string;
}

export type Section = 'home' | 'food_inventory' | 'food_purchases' | 'food_consumption' | 'food_menu' | 'food_sales' | 'food_expenses' | 'food_reports' | 'food_ai';

export interface FoodContext {
  api: FoodApi;
  tf: (key: FoodKey, vars?: Record<string, string | number>) => string;
  meta: FoodMeta | null;
  reloadMeta: () => Promise<void>;
  open: (section: Section, route?: string, params?: Record<string, any>) => void;
  has: (feature: string) => boolean;
  lang: string;
}

export const FoodCtx = createContext<FoodContext | null>(null);

/** The shared kit's context (colours, navigation, toast) plus Food Seller's own. */
export function useFood(): Omit<ShgContext, 'api'> & FoodContext {
  const food = useContext(FoodCtx);
  const shg = useShg();
  if (!food) throw new Error('useFood outside FoodCtx');
  return { ...shg, ...food };
}

/** Columns for cards: 2 on a phone, 3 on a tablet, 4 on a desktop browser. */
export function useColumns() {
  const { width } = useWindowDimensions();
  return { columns: width >= 1024 ? 4 : width >= 640 ? 3 : 2, wide: width >= 640 };
}

export function confirmDialog(title: string, message: string, ok: string, cancel: string, destructive = false): Promise<boolean> {
  if (Platform.OS === 'web') {
    // Alert.alert does nothing on react-native-web.
    return Promise.resolve((globalThis as any).confirm?.(`${title}\n\n${message}`) ?? false);
  }
  return new Promise(resolve => {
    Alert.alert(title, message, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/**
 * Sends a stock-moving request at most once (same key across retries of one
 * submission). When the server reports a shortage, the owner decides: nothing is
 * saved unless they explicitly choose to let stock go negative.
 */
export function useStockSubmit() {
  const { t, tf } = useFood();
  const keyRef = useRef(newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async <T,>(fn: (key: string, extra: Record<string, any>) => Promise<T>): Promise<T | null> => {
    if (busy) return null;
    setBusy(true);
    setError(null);
    try {
      let extra: Record<string, any> = {};
      for (;;) {
        try {
          const result = await fn(keyRef.current, extra);
          keyRef.current = newIdempotencyKey();
          setPending(false);
          return result;
        } catch (e) {
          if (e instanceof FoodApiError && e.code === 'INSUFFICIENT_STOCK' && !extra.allowNegative) {
            keyRef.current = newIdempotencyKey();
            const list = (e.shortages || []).map(s => `• ${s.name}: ${tf('stock_shortBy', { qty: Number(s.shortBy).toFixed(2), unit: s.unit })}`).join('\n');
            const go = await confirmDialog(tf('stock_notEnough'), `${list}\n\n${tf('stock_saveAnywayHint')}`, tf('stock_saveAnyway'), t('common_cancel'), true);
            if (!go) return null;
            extra = { allowNegative: true };
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      if (e instanceof FoodApiError && e.uncertain) {
        setPending(true);
        setError(t('err_unconfirmed'));
      } else {
        keyRef.current = newIdempotencyKey();
        setPending(false);
        setError(errorText(t, e));
      }
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, t, tf]);

  return { send, busy, pending, error };
}

/** Summary card with an icon, sized by screen width. */
export function StatCard({ icon, label, value, hint, tone = 'brand', onPress }: {
  icon: string; label: string; value: string; hint?: string; tone?: 'brand' | 'green' | 'red' | 'amber' | 'blue'; onPress?: () => void;
}) {
  const { c } = useShg();
  const { columns } = useColumns();
  const fg = { brand: c.brandText, green: c.green, red: c.red, amber: c.amber, blue: c.blue }[tone];
  const bg = { brand: c.brandBg, green: c.greenBg, red: c.redBg, amber: c.amberBg, blue: c.blueBg }[tone];
  const body = (
    <View style={{ backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 14, padding: 12, minHeight: 96, flexGrow: 1 }}>
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
        <Text style={{ fontSize: 16 }}>{icon}</Text>
      </View>
      <Text style={{ color: tone === 'red' ? fg : c.text, fontSize: 19, fontWeight: '800' }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600', marginTop: 2 }} numberOfLines={2}>{label}</Text>
      {!!hint && <Text style={{ color: c.muted, fontSize: 11, marginTop: 2 }} numberOfLines={1}>{hint}</Text>}
    </View>
  );
  const style = { width: `${100 / columns}%` as const, padding: 4 };
  return onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [style, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}>{body}</Pressable>
  ) : <View style={style} accessible accessibilityLabel={`${label}: ${value}`}>{body}</View>;
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 8 }}>{children}</View>;
}

/** Lays children out in one column on phones and two on wider screens. */
export function Grid({ children }: { children: React.ReactNode }) {
  const { wide } = useColumns();
  const items = React.Children.toArray(children);
  if (!wide) return <>{items}</>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 }}>
      {items.map((item, i) => <View key={i} style={{ width: '50%', paddingHorizontal: 5 }}>{item}</View>)}
    </View>
  );
}

export function StockPill({ state }: { state: string }) {
  const { c } = useShg();
  const { tf } = useFood();
  const look: any = {
    OUT: { fg: c.red, bg: c.redBg, text: tf('stock_out'), icon: '⛔' },
    LOW: { fg: c.amber, bg: c.amberBg, text: tf('stock_low'), icon: '⚠️' },
    OK: { fg: c.green, bg: c.greenBg, text: tf('stock_ok'), icon: '✓' },
  }[state] || { fg: c.muted, bg: c.border, text: state, icon: '' };
  return (
    <View style={{ backgroundColor: look.bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: look.fg, fontSize: 11, fontWeight: '700' }}>{look.icon} {look.text}</Text>
    </View>
  );
}

/** Compact labelled number input for table-like rows. */
export function NumInput({ label, value, onChange, prefix, flex = 1 }: { label: string; value: any; onChange: (v: string) => void; prefix?: string; flex?: number }) {
  const { c } = useShg();
  return (
    <View style={{ flex, minWidth: 0 }}>
      <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', marginBottom: 4 }} numberOfLines={1}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 10, backgroundColor: c.input, paddingHorizontal: 8, minHeight: 48 }}>
        {!!prefix && <Text style={{ color: c.muted, marginRight: 3 }}>{prefix}</Text>}
        <TextInput
          value={value === undefined || value === null ? '' : String(value)}
          onChangeText={v => onChange(v.replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          // On web this re-selects while typing and the next digit overwrites the first.
          selectTextOnFocus={Platform.OS !== 'web'}
          accessibilityLabel={label}
          style={{ flex: 1, minWidth: 0, color: c.text, fontSize: 15, fontWeight: '600', paddingVertical: 8 }}
        />
      </View>
    </View>
  );
}

/** Units a stock product can be entered in: its own, and any of the same kind (KG/Gram, Liter/ML). */
export function unitsFor(product: any, units: any[]) {
  if (!product) return [];
  const own = units.find(u => u.id === product.unitId);
  if (!own || own.dimension === 'custom') return own ? [own] : [];
  return units.filter(u => u.dimension === own.dimension);
}

export function num(value: any) {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

/** Quantities without noise: 1.5, 40, 0.25. */
export function qty(value: any) {
  return String(Math.round(num(value) * 100) / 100);
}

export function nextRowId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
