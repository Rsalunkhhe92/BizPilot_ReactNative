/**
 * Mahila Bachat Gat (महिला बचत गट) - mobile module root.
 *
 * Mounted by App.tsx as the "Bachat Gat" tab for customers whose business type is
 * Mahila Bachat Gat (or who have shg_* features enabled by the admin). It reuses
 * the app's login token through the apiFetch prop and the app's language setting.
 * Sections the admin has switched off are hidden here AND refused by the backend.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, Text, View, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Language } from '../../../i18n';
import { ApiFetch, createShgApi } from './api';
import { inr } from './format';
import { ShgKey, shgStatus, shgTranslate } from './i18n';
import { Route, ShgContext, ShgCtx, dark, light, useLoad } from './ui';
import { ApprovalsScreen, DashboardScreen, MoreScreen, NotificationsScreen, ReceiptScreen } from './screens/Dashboard';
import { GroupDetailScreen, GroupFormScreen, GroupsScreen } from './screens/Groups';
import { MemberDetailScreen, MemberExitScreen, MemberFormScreen, MembersScreen } from './screens/Members';
import {
  CollectSavingsScreen, MoneyScreen, SavingsDuesScreen, SavingsLedgerScreen, TransactionsScreen, WithdrawSavingsScreen,
} from './screens/Savings';
import { CollectRepaymentScreen, InstallmentsScreen, LoanDetailScreen, LoanFormScreen, LoansScreen, RepayScreen } from './screens/Loans';
import { MeetingDetailScreen, MeetingFormScreen, MeetingsScreen } from './screens/Meetings';
import { AccountsScreen, BookScreen, PeriodCloseScreen, ReconciliationScreen, TxnFormScreen } from './screens/Accounts';
import { ActivityDetailScreen, BusinessScreen, OrderDetailScreen, OrderFormScreen } from './screens/Business';
import { SchemeDetailScreen, SchemeFormScreen, SchemesScreen } from './screens/Schemes';
import { ReportViewScreen, ReportsScreen } from './screens/Reports';
import { PolicyScreen, SettingsScreen } from './screens/Settings';
import { GatewayPaymentsScreen } from './screens/Online';

const GROUP_KEY = 'shg:currentGroupId';

type Tab = 'home' | 'groups' | 'members' | 'money' | 'more';
const TAB_ROOT: Record<Tab, string> = { home: 'dashboard', groups: 'groups', members: 'members', money: 'money', more: 'more' };

const SCREENS: Record<string, (p: { params: any }) => React.ReactElement> = {
  dashboard: () => <DashboardScreen />,
  approvals: ({ params }) => <ApprovalsScreen params={params} />,
  notifications: () => <NotificationsScreen />,
  receipt: ({ params }) => <ReceiptScreen params={params} />,
  more: () => <MoreScreen />,
  groups: ({ params }) => <GroupsScreen params={params} />,
  groupForm: ({ params }) => <GroupFormScreen params={params} />,
  groupDetail: ({ params }) => <GroupDetailScreen params={params} />,
  members: ({ params }) => <MembersScreen params={params} />,
  memberForm: ({ params }) => <MemberFormScreen params={params} />,
  memberDetail: ({ params }) => <MemberDetailScreen params={params} />,
  memberExit: ({ params }) => <MemberExitScreen params={params} />,
  money: () => <MoneyScreen />,
  collectSavings: ({ params }) => <CollectSavingsScreen params={params} />,
  savingsDues: ({ params }) => <SavingsDuesScreen params={params} />,
  savingsLedger: () => <SavingsLedgerScreen />,
  withdrawSavings: () => <WithdrawSavingsScreen />,
  transactions: ({ params }) => <TransactionsScreen params={params} />,
  loans: ({ params }) => <LoansScreen params={params} />,
  loanForm: ({ params }) => <LoanFormScreen params={params} />,
  loanDetail: ({ params }) => <LoanDetailScreen params={params} />,
  collectRepayment: () => <CollectRepaymentScreen />,
  repay: ({ params }) => <RepayScreen params={params} />,
  installments: ({ params }) => <InstallmentsScreen params={params} />,
  meetings: () => <MeetingsScreen />,
  meetingForm: () => <MeetingFormScreen />,
  meetingDetail: ({ params }) => <MeetingDetailScreen params={params} />,
  accounts: () => <AccountsScreen />,
  cashbook: ({ params }) => <BookScreen params={params} kind="cash" />,
  bankbook: ({ params }) => <BookScreen params={params} kind="bank" />,
  txnForm: ({ params }) => <TxnFormScreen params={params} />,
  reconciliation: () => <ReconciliationScreen />,
  periodClose: () => <PeriodCloseScreen />,
  business: () => <BusinessScreen />,
  activityDetail: ({ params }) => <ActivityDetailScreen params={params} />,
  orderForm: ({ params }) => <OrderFormScreen params={params} />,
  orderDetail: ({ params }) => <OrderDetailScreen params={params} />,
  schemes: () => <SchemesScreen />,
  schemeForm: ({ params }) => <SchemeFormScreen params={params} />,
  schemeDetail: ({ params }) => <SchemeDetailScreen params={params} />,
  reports: () => <ReportsScreen />,
  reportView: ({ params }) => <ReportViewScreen params={params} />,
  settings: () => <SettingsScreen />,
  policy: ({ params }) => <PolicyScreen params={params} />,
  gatewayPayments: ({ params }) => <GatewayPaymentsScreen params={params} />,
};

// Which feature a route needs (routes not listed are always available).
const ROUTE_FEATURE: Record<string, string> = {
  groups: 'shg_groups', groupForm: 'shg_groups', groupDetail: 'shg_groups',
  members: 'shg_members', memberForm: 'shg_members', memberDetail: 'shg_members', memberExit: 'shg_members',
  collectSavings: 'shg_savings', savingsDues: 'shg_savings', savingsLedger: 'shg_savings', withdrawSavings: 'shg_savings',
  loans: 'shg_loans', loanForm: 'shg_loans', loanDetail: 'shg_loans', collectRepayment: 'shg_loans', repay: 'shg_loans', installments: 'shg_loans',
  meetings: 'shg_meetings', meetingForm: 'shg_meetings', meetingDetail: 'shg_meetings',
  accounts: 'shg_accounts', cashbook: 'shg_accounts', bankbook: 'shg_accounts', txnForm: 'shg_accounts', reconciliation: 'shg_accounts',
  periodClose: 'shg_accounts', transactions: 'shg_accounts',
  business: 'shg_business', activityDetail: 'shg_business', orderForm: 'shg_business', orderDetail: 'shg_business',
  schemes: 'shg_schemes', schemeForm: 'shg_schemes', schemeDetail: 'shg_schemes',
  reports: 'shg_reports', reportView: 'shg_reports', settings: 'shg_settings', policy: 'shg_settings',
  gatewayPayments: 'shg_savings',
};

export const BACHAT_GAT_FEATURES = ['shg_groups', 'shg_members', 'shg_savings', 'shg_loans', 'shg_meetings', 'shg_accounts',
  'shg_business', 'shg_schemes', 'shg_reports', 'shg_settings'];

export function isBachatGatUser(businessType?: string, enabledFeatures?: string[]) {
  return (businessType || '').trim().toLowerCase() === 'mahila bachat gat'
    || (Array.isArray(enabledFeatures) && enabledFeatures.some(f => BACHAT_GAT_FEATURES.includes(f)));
}

/** Features the module should show: explicit admin selection, else the type defaults. */
export function shgFeaturesFor(enabledFeatures?: string[]) {
  const explicit = (enabledFeatures || []).filter(f => BACHAT_GAT_FEATURES.includes(f));
  return explicit.length ? explicit : BACHAT_GAT_FEATURES;
}

export interface BachatGatEntry { route: string; params?: any; nonce: number }

export default function BachatGatModule({ apiFetch, language, ownerName, enabledFeatures, entry }: {
  apiFetch: ApiFetch; language: Language; ownerName: string; enabledFeatures?: string[]; entry?: BachatGatEntry | null;
}) {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? dark : light;
  const insets = useSafeAreaInsets();
  const api = useMemo(() => createShgApi(apiFetch), [apiFetch]);
  const t = useCallback((key: ShgKey, vars?: Record<string, string | number>) => shgTranslate(language, key, vars), [language]);
  const st = useCallback((v?: string | null) => shgStatus(language, v), [language]);
  const features = useMemo(() => shgFeaturesFor(enabledFeatures), [enabledFeatures]);
  const has = useCallback((f: string) => features.includes(f), [features]);

  const [tab, setTab] = useState<Tab>('home');
  const [stacks, setStacks] = useState<Record<Tab, Route[]>>({
    home: [{ name: 'dashboard' }], groups: [{ name: 'groups' }], members: [{ name: 'members' }], money: [{ name: 'money' }], more: [{ name: 'more' }],
  });
  const [groupId, setGroupIdState] = useState<number | null>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const [toastMsg, setToastMsg] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reloadGroups = useCallback(async () => {
    try {
      const r = await api.get('/groups', { pageSize: 100 });
      setGroups(r.groups || []);
      setGroupIdState(cur => {
        if (cur && (r.groups || []).some((g: any) => g.id === cur)) return cur;
        const first = (r.groups || []).find((g: any) => g.status === 'Active') || (r.groups || [])[0];
        return first ? first.id : null;
      });
    } catch {
      // Lists show their own error states; the picker simply stays empty.
    }
  }, [api]);

  useEffect(() => {
    AsyncStorage.getItem(GROUP_KEY).then(v => { if (v) setGroupIdState(Number(v)); }).catch(() => {}).finally(reloadGroups);
  }, [reloadGroups]);

  const setGroupId = useCallback((id: number | null) => {
    setGroupIdState(id);
    try { if (id) AsyncStorage.setItem(GROUP_KEY, String(id)).catch(() => {}); } catch { /* storage unavailable */ }
  }, []);

  const push = useCallback((name: string, params?: any) => {
    if (ROUTE_FEATURE[name] && !features.includes(ROUTE_FEATURE[name])) return;
    setStacks(s => ({ ...s, [tab]: [...s[tab], { name, params }] }));
  }, [tab, features]);
  const replace = useCallback((name: string, params?: any) => {
    setStacks(s => ({ ...s, [tab]: [...s[tab].slice(0, -1), { name, params }] }));
  }, [tab]);
  const back = useCallback(() => {
    setStacks(s => (s[tab].length > 1 ? { ...s, [tab]: s[tab].slice(0, -1) } : s));
  }, [tab]);
  const bump = useCallback(() => { setDataVersion(v => v + 1); reloadGroups(); }, [reloadGroups]);
  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    setToastMsg({ text, kind });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2500);
  }, []);

  // Deep entry from the app's home card (quick actions)
  useEffect(() => {
    if (!entry) return;
    setTab('home');
    setStacks(s => ({ ...s, home: entry.route === 'dashboard' ? [{ name: 'dashboard' }] : [{ name: 'dashboard' }, { name: entry.route, params: entry.params }] }));
  }, [entry?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Android back button walks back through the module before leaving it
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stacks[tab].length > 1) { back(); return true; }
      if (tab !== 'home') { setTab('home'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stacks, tab, back]);

  const ctx: ShgContext = {
    api, t, st, c, push, replace, back, groupId, setGroupId, groups, reloadGroups, features, has, dataVersion, bump, toast,
    ownerName, lang: language,
  };

  const tabs: { key: Tab; icon: string; label: ShgKey; feature?: string }[] = [
    { key: 'home', icon: '🏠', label: 'nav_dashboard' },
    { key: 'groups', icon: '🏘️', label: 'nav_groups', feature: 'shg_groups' },
    { key: 'members', icon: '👩‍👩‍👧', label: 'nav_members', feature: 'shg_members' },
    { key: 'money', icon: '💰', label: 'nav_money' },
    { key: 'more', icon: '☰', label: 'nav_more' },
  ];
  const visibleTabs = tabs.filter(x => !x.feature || has(x.feature));
  const stack = stacks[tab];

  return (
    <ShgCtx.Provider value={ctx}>
      <View style={{ flex: 1, backgroundColor: c.page }}>
        {/* Screens below the top stay mounted (hidden) so Back keeps their scroll and form state. */}
        {stack.map((route, i) => {
          const Render = SCREENS[route.name] || SCREENS.dashboard;
          const top = i === stack.length - 1;
          return (
            <View key={`${tab}:${i}:${route.name}`} style={{ flex: 1, display: top ? 'flex' : 'none' }}
              importantForAccessibility={top ? 'auto' : 'no-hide-descendants'} accessibilityElementsHidden={!top}>
              <Render params={route.params} />
            </View>
          );
        })}
        {toastMsg && (
          <View style={{ position: 'absolute', left: 16, right: 16, bottom: 80 + insets.bottom, backgroundColor: toastMsg.kind === 'ok' ? c.green : c.red,
            borderRadius: 12, padding: 12 }} accessibilityLiveRegion="polite">
            <Text style={{ color: '#fff', fontWeight: '700' }}>{toastMsg.text}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.nav, paddingBottom: Math.max(insets.bottom, 6) }}
          accessibilityRole="tablist">
          {visibleTabs.map(x => {
            const on = x.key === tab;
            return (
              <Pressable key={x.key} onPress={() => {
                if (on) setStacks(s => ({ ...s, [x.key]: [{ name: TAB_ROOT[x.key] }] }));
                setTab(x.key);
              }}
                accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t(x.label)}
                style={{ flex: 1, alignItems: 'center', paddingTop: 8, paddingBottom: 4, minHeight: 56 }}>
                <Text style={{ fontSize: 20, opacity: on ? 1 : 0.6 }}>{x.icon}</Text>
                <Text style={{ fontSize: 11, fontWeight: on ? '800' : '600', color: on ? c.brand : c.muted, marginTop: 2 }} numberOfLines={1}>{t(x.label)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ShgCtx.Provider>
  );
}

/**
 * Compact card for the app's existing Home tab: key figures from the backend
 * and shortcuts into the module.
 */
export function BachatGatHomeCard({ apiFetch, language, enabledFeatures, onOpen }: {
  apiFetch: ApiFetch; language: Language; enabledFeatures?: string[]; onOpen: (route: string, params?: any) => void;
}) {
  const scheme = useColorScheme();
  const c = scheme === 'dark' ? dark : light;
  const api = useMemo(() => createShgApi(apiFetch), [apiFetch]);
  const t = (key: ShgKey, vars?: Record<string, string | number>) => shgTranslate(language, key, vars);
  const features = shgFeaturesFor(enabledFeatures);
  const ctx = { api, t, c, dataVersion: 0 } as unknown as ShgContext;
  return (
    <ShgCtx.Provider value={ctx}>
      <HomeCardBody onOpen={onOpen} features={features} />
    </ShgCtx.Provider>
  );
}

function HomeCardBody({ onOpen, features }: { onOpen: (route: string, params?: any) => void; features: string[] }) {
  const ctx = React.useContext(ShgCtx)!;
  const { api, t, c } = ctx;
  const { data, loading, error, reload } = useLoad(() => api.get('/dashboard'), []);
  const d = data as any;
  const tile = (label: string, value: string, route: string, params?: any) => (
    <Pressable key={label} onPress={() => onOpen(route, params)} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`}
      style={{ width: '50%', padding: 4 }}>
      <View style={{ backgroundColor: c.brandBg, borderRadius: 12, padding: 10, minHeight: 64 }}>
        <Text style={{ color: c.brandText, fontWeight: '800', fontSize: 16 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        <Text style={{ color: c.brandText, fontSize: 11, fontWeight: '600' }} numberOfLines={2}>{label}</Text>
      </View>
    </Pressable>
  );
  const quick: { label: ShgKey; route: string; feature: string }[] = [
    { label: 'qa_collectSavings', route: 'collectSavings', feature: 'shg_savings' },
    { label: 'qa_collectRepayment', route: 'collectRepayment', feature: 'shg_loans' },
    { label: 'qa_addMember', route: 'memberForm', feature: 'shg_members' },
    { label: 'qa_scheduleMeeting', route: 'meetingForm', feature: 'shg_meetings' },
  ];
  return (
    <View style={{ backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ fontSize: 22, marginRight: 8 }}>👩‍👩‍👧‍👧</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontWeight: '800', fontSize: 16 }}>{t('mod_title')}</Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>{t('mod_subtitle')}</Text>
        </View>
        <Pressable onPress={() => onOpen('dashboard')} accessibilityRole="button" hitSlop={8}>
          <Text style={{ color: c.brand, fontWeight: '800' }}>{t('common_open')} ›</Text>
        </Pressable>
      </View>
      {loading && !d ? <Text style={{ color: c.muted }}>{t('common_loading')}</Text> : error ? (
        <Pressable onPress={reload}><Text style={{ color: c.red }}>{error} · {t('common_retry')}</Text></Pressable>
      ) : d ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 }}>
            {tile(t('dash_groups'), `${d.groups.active}/${d.groups.total}`, 'groups')}
            {tile(t('dash_activeMembers'), String(d.members.active), 'members')}
            {tile(t('dash_savingsLiability'), inr(d.savingsLiability), 'savingsLedger')}
            {tile(t('dash_loanOutstanding'), inr(d.loanOutstanding), 'loans', { status: 'open' })}
            {tile(t('dash_overdue'), String(d.overdue.installments), 'installments', { overdue: true })}
            {tile(t('dash_pendingApprovals'), String(d.pendingApprovals.total), 'approvals', { counts: d.pendingApprovals })}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {quick.filter(q => features.includes(q.feature)).map(q => (
              <Pressable key={q.route} onPress={() => onOpen(q.route)} accessibilityRole="button"
                style={{ borderWidth: 1, borderColor: c.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 36, justifyContent: 'center' }}>
                <Text style={{ color: c.brandText, fontWeight: '700', fontSize: 12 }}>{t(q.label)}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}
