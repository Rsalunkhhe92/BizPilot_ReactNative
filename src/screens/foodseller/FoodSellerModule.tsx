/**
 * Food Seller - mobile module root.
 *
 * App.tsx keeps its usual gradient header and top tab row, exactly as for a Fruit
 * Seller, and renders this for the Food Seller's tabs (Home plus the food_* tabs).
 * Each tab keeps its own screen stack here. Sections the admin switched off are
 * hidden here AND refused by the backend.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Language } from '../../../i18n';
import { ApiFetch } from '../bachatgat/api';
import { ShgKey, shgTranslate } from '../bachatgat/i18n';
import { Route, ShgContext, ShgCtx, dark, light } from '../bachatgat/ui';
import { createFoodApi } from './api';
import { FoodKey, foodStatus, foodTranslate } from './i18n';
import { FoodContext, FoodCtx, FoodMeta, Section } from './ui';
import { DashboardScreen, NotificationsScreen } from './screens/Dashboard';
import { AdjustmentScreen, CategoriesScreen, InventoryScreen, ProductDetailScreen, ProductFormScreen, SettingsScreen, SupplierDetailScreen, SuppliersScreen, UnitsScreen } from './screens/Inventory';
import { PurchaseDetailScreen, PurchaseFormScreen, PurchasesScreen } from './screens/Purchases';
import { ConsumptionFormScreen, ConsumptionHistoryScreen, ConsumptionScreen } from './screens/Consumption';
import { FoodFormScreen, MenuScreen } from './screens/Menu';
import { PendingScreen, SaleDetailScreen, SaleFormScreen, SalesScreen } from './screens/Sales';
import { ExpensesScreen } from './screens/Expenses';
import { PnlScreen, ReportViewScreen, ReportsScreen } from './screens/Reports';
import { AssistantScreen } from './screens/Assistant';

export const FOOD_SELLER_FEATURES = ['food_inventory', 'food_purchases', 'food_consumption', 'food_menu', 'food_sales', 'food_expenses', 'food_reports', 'food_ai'];
export const FOOD_SELLER_TYPE = 'food seller';

export function isFoodSellerUser(businessType?: string, enabledFeatures?: string[]) {
  return (businessType || '').trim().toLowerCase() === FOOD_SELLER_TYPE
    || (Array.isArray(enabledFeatures) && enabledFeatures.some(f => FOOD_SELLER_FEATURES.includes(f)));
}

/** Features to show: explicit admin selection, else the type's defaults. */
export function foodFeaturesFor(enabledFeatures?: string[]) {
  const explicit = (enabledFeatures || []).filter(f => FOOD_SELLER_FEATURES.includes(f));
  return explicit.length ? explicit : FOOD_SELLER_FEATURES;
}

export function foodTabs(language: Language, enabledFeatures?: string[]) {
  const features = foodFeaturesFor(enabledFeatures);
  const tabs: { key: Section; label: FoodKey; icon: string }[] = [
    { key: 'food_inventory', label: 'nav_inventory', icon: '📦' },
    { key: 'food_purchases', label: 'nav_purchases', icon: '🛒' },
    { key: 'food_consumption', label: 'nav_consumption', icon: '🍳' },
    { key: 'food_menu', label: 'nav_menu', icon: '🍔' },
    { key: 'food_sales', label: 'nav_sales', icon: '💰' },
    { key: 'food_expenses', label: 'nav_expenses', icon: '🧾' },
    { key: 'food_reports', label: 'nav_reports', icon: '📊' },
    { key: 'food_ai', label: 'nav_ai', icon: '🤖' },
  ];
  return tabs.filter(tab => features.includes(tab.key)).map(tab => ({ key: tab.key as string, label: foodTranslate(language, tab.label), icon: tab.icon }));
}

const ROOT: Record<Section, string> = {
  home: 'dashboard', food_inventory: 'inventory', food_purchases: 'purchases', food_consumption: 'consumption', food_menu: 'menu',
  food_sales: 'sales', food_expenses: 'expenses', food_reports: 'reports', food_ai: 'assistant',
};

const SCREENS: Record<string, (p: { params: any }) => React.ReactElement> = {
  dashboard: () => <DashboardScreen />,
  notifications: () => <NotificationsScreen />,
  inventory: () => <InventoryScreen />,
  productForm: ({ params }) => <ProductFormScreen params={params} />,
  productDetail: ({ params }) => <ProductDetailScreen params={params} />,
  adjustment: ({ params }) => <AdjustmentScreen params={params} />,
  suppliers: () => <SuppliersScreen />,
  supplierDetail: ({ params }) => <SupplierDetailScreen params={params} />,
  categories: () => <CategoriesScreen />,
  units: () => <UnitsScreen />,
  settings: () => <SettingsScreen />,
  purchases: () => <PurchasesScreen />,
  purchaseForm: ({ params }) => <PurchaseFormScreen params={params} />,
  purchaseDetail: ({ params }) => <PurchaseDetailScreen params={params} />,
  consumption: () => <ConsumptionScreen />,
  consumptionForm: () => <ConsumptionFormScreen />,
  consumptionHistory: () => <ConsumptionHistoryScreen />,
  menu: () => <MenuScreen />,
  foodForm: ({ params }) => <FoodFormScreen params={params} />,
  sales: () => <SalesScreen />,
  saleForm: () => <SaleFormScreen />,
  saleDetail: ({ params }) => <SaleDetailScreen params={params} />,
  pending: () => <PendingScreen />,
  expenses: () => <ExpensesScreen />,
  reports: () => <ReportsScreen />,
  pnl: () => <PnlScreen />,
  reportView: ({ params }) => <ReportViewScreen params={params} />,
  assistant: () => <AssistantScreen />,
};

const initialStacks = () => Object.fromEntries((Object.keys(ROOT) as Section[]).map(s => [s, [{ name: ROOT[s] }]])) as Record<Section, Route[]>;

export default function FoodSellerModule({ apiFetch, language, ownerName, enabledFeatures, section, onSection, entry }: {
  apiFetch: ApiFetch; language: Language; ownerName: string; enabledFeatures?: string[]; section: Section; onSection: (section: Section) => void;
  entry?: { route: string; nonce: number } | null;
}) {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? dark : light;
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createFoodApi(apiFetch), [apiFetch]);
  const features = useMemo(() => foodFeaturesFor(enabledFeatures), [enabledFeatures]);
  const has = useCallback((f: string) => features.includes(f), [features]);
  const t = useCallback((key: ShgKey, vars?: Record<string, string | number>) => shgTranslate(language, key, vars), [language]);
  const tf = useCallback((key: FoodKey, vars?: Record<string, string | number>) => foodTranslate(language, key, vars), [language]);
  const st = useCallback((v?: string | null) => foodStatus(language, v), [language]);

  const [stacks, setStacks] = useState(initialStacks);
  const [meta, setMeta] = useState<FoodMeta | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [toastMsg, setToastMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reloadMeta = useCallback(async () => {
    try { setMeta(await api.get('/bootstrap')); } catch { /* screens show their own error state */ }
  }, [api]);
  useEffect(() => { reloadMeta(); }, [reloadMeta]);

  const push = useCallback((name: string, params?: any) => {
    setStacks(s => ({ ...s, [section]: [...s[section], { name, params }] }));
  }, [section]);
  const replace = useCallback((name: string, params?: any) => {
    setStacks(s => ({ ...s, [section]: [...s[section].slice(0, -1), { name, params }] }));
  }, [section]);
  const back = useCallback(() => {
    setStacks(s => (s[section].length > 1 ? { ...s, [section]: s[section].slice(0, -1) } : s));
  }, [section]);
  const bump = useCallback(() => { setDataVersion(v => v + 1); reloadMeta(); }, [reloadMeta]);
  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setToastMsg({ text, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3200);
  }, []);
  const open = useCallback((target: Section, route?: string, params?: Record<string, any>) => {
    setStacks(s => ({ ...s, [target]: route ? [{ name: ROOT[target] }, { name: route, params }] : [{ name: ROOT[target] }] }));
    onSection(target);
  }, [onSection]);

  // Deep entry from the app's header (the alerts bell).
  useEffect(() => {
    if (entry) open('home', entry.route);
  }, [entry?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stacks[section].length > 1) { back(); return true; }
      if (section !== 'home') { onSection('home'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stacks, section, back, onSection]);

  const shgCtx: ShgContext = {
    api: api as any, t, st, c, push, replace, back, groupId: null, setGroupId: () => {}, groups: [], reloadGroups: async () => {},
    features, has, dataVersion, bump, toast, ownerName, lang: language,
  };
  const foodCtx: FoodContext = { api, tf, meta, reloadMeta, open, has, lang: language };
  const stack = stacks[section];

  return (
    <ShgCtx.Provider value={shgCtx}>
      <FoodCtx.Provider value={foodCtx}>
        <View style={{ flex: 1, backgroundColor: c.page, alignItems: 'center' }}>
          {/* Centred column on tablets and desktop browsers; full width on phones. */}
          <View style={{ flex: 1, width: '100%', maxWidth: 1180 }}>
            {stack.map((route, i) => {
              const Render = SCREENS[route.name] || SCREENS.dashboard;
              const top = i === stack.length - 1;
              return (
                <View key={`${section}:${i}:${route.name}`} style={{ flex: 1, display: top ? 'flex' : 'none' }}
                  importantForAccessibility={top ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!top}>
                  <Render params={route.params} />
                </View>
              );
            })}
          </View>
          {toastMsg && (
            <View style={{ position: 'absolute', left: 16, right: 16, bottom: 20 + insets.bottom, backgroundColor: toastMsg.kind === 'ok' ? c.green : c.red, borderRadius: 12, padding: 12 }}
              accessibilityLiveRegion="polite">
              <Text style={{ color: '#fff', fontWeight: '700' }}>{toastMsg.text}</Text>
            </View>
          )}
        </View>
      </FoodCtx.Provider>
    </ShgCtx.Provider>
  );
}
