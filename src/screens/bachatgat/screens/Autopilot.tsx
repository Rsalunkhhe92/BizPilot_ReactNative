/**
 * Autopilot: the AI agent that runs the group by itself (backend: bachatgat_agent.py).
 * Shows what it needs from a person, what it did (with Undo), its switches, and the
 * meeting-register photo scan that turns a handwritten page into entries.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { inr } from '../format';
import { Badge, Btn, BtnRow, Card, Empty, FormSheet, Gate, KV, Notice, Screen, SectionTitle, confirm, errorText, useLoad, useShg } from '../ui';

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

const ICONS: Record<string, string> = {
  MEMBER_APPROVED: '👩', MEMBER_ADDED: '🆕', DUES_GENERATED: '🗓️', ONLINE_PAYMENT_POSTED: '📲', SAVINGS_RECORDED: '💰',
  REPAYMENT_RECORDED: '🧾', LOAN_REQUESTED: '📝', LOAN_APPROVED: '✅', LOAN_DISBURSED: '💸', LOAN_OVERDUE: '⏰',
  LOAN_CLOSED: '🎉', LOAN_ACTIVE: '🔄', PAYMENT_LINK_SENT: '🔗', MEETING_SCHEDULED: '📅', ATTENDANCE_RECORDED: '🙋',
  BOOKS_CLOSED: '📒',
};

// Where an item's record opens.
const ENTITY_ROUTE: Record<string, string> = { LOAN: 'loanDetail', MEMBER: 'memberDetail', MEETING: 'meetingDetail' };

function when(iso?: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(iso).slice(0, 16).replace('T', ' ');
  }
}

export function AutopilotScreen() {
  const { api, t, c, push, groupId, groups, bump } = useShg();
  const group = groups.find(g => g.id === groupId);
  const { data, loading, error, reload, refreshing } = useLoad(
    () => (groupId ? api.get('/agent/overview', { groupId }) : Promise.resolve(null)),
    [groupId],
  );
  const [running, setRunning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const d = data as any;

  // Catch up when the screen opens (the server skips it if the Autopilot ran within the hour).
  useEffect(() => {
    if (!groupId) return;
    api.post('/agent/run', { groupId, ifStale: true }).then((r: any) => { if (r?.run) bump(); }).catch(() => {});
  }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await api.post('/agent/run', { groupId });
      const run = r.run;
      Alert.alert(t('ap_title'), run ? t('ap_runResult', { done: run.doneCount, attention: run.attentionCount }) : t('ap_runSkipped'));
      bump();
    } catch (e) {
      Alert.alert(t('common_error'), errorText(t, e));
    } finally {
      setRunning(false);
    }
  };

  const scan = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert(t('common_error'), t('doc_permission'));
    const opts: ImagePicker.ImagePickerOptions = { base64: true, quality: 0.5, mediaTypes: ['images'] };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]?.base64) return;
    const a = res.assets[0];
    if ((a.base64!.length * 3) / 4 > MAX_PHOTO_BYTES) return Alert.alert(t('common_error'), t('doc_tooLarge'));
    setScanning(true);
    try {
      const r = await api.post('/agent/scan', { groupId, imageBase64: a.base64, mimeType: a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg' });
      Alert.alert(t('ap_scanDone'), t('ap_runResult', { done: r.run?.doneCount ?? 0, attention: r.run?.attentionCount ?? 0 }));
      bump();
    } catch (e) {
      Alert.alert(t('common_error'), errorText(t, e));
    } finally {
      setScanning(false);
    }
  };

  const act = async (id: number, fn: () => Promise<any>, okMsg?: string) => {
    setBusyId(id);
    try {
      await fn();
      if (okMsg) Alert.alert(t('ap_title'), okMsg);
      bump();
    } catch (e) {
      Alert.alert(t('common_error'), errorText(t, e));
    } finally {
      setBusyId(null);
    }
  };

  if (!groupId) {
    return <Screen title={t('ap_title')}><Empty text={t('ap_noGroup')} action={t('nav_groups')} onAction={() => push('groups')} /></Screen>;
  }
  const s = d?.settings;
  const attention: any[] = d?.attention || [];
  const recent: any[] = d?.recent || [];

  return (
    <Screen title={`🤖 ${t('ap_title')}`} subtitle={group?.nameEn} onRefresh={reload} refreshing={refreshing}>
      <Gate loading={loading && !d} error={error} onRetry={reload}>
        {s && (
          <>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Badge value={s.enabled ? 'Active' : 'Suspended'} label={s.enabled ? t('ap_on') : t('ap_off')} />
                <Text style={{ color: c.muted, fontSize: 12, flex: 1 }}>
                  {d.lastRun ? t('ap_lastRun', { when: when(d.lastRun.startedAt) }) : t('ap_neverRun')}
                </Text>
              </View>
              <Text style={{ color: c.sub, marginBottom: 8 }}>{t('ap_intro', { hours: d.everyHours })}</Text>
              <KV label={t('ap_loanLimit')} value={Number(s.effectiveLoanLimit) > 0 ? inr(s.effectiveLoanLimit) : t('ap_limitNotSet')}
                color={Number(s.effectiveLoanLimit) > 0 ? undefined : c.red} />
              <KV label={t('ap_collectedMonth')} value={inr(d.month?.collected || 0)} />
              <BtnRow>
                <Btn small icon="📷" title={t('ap_scanCamera')} onPress={() => scan(true)} busy={scanning} disabled={!d.aiReady} />
                <Btn small kind="secondary" icon="🖼️" title={t('ap_scanGallery')} onPress={() => scan(false)} disabled={!d.aiReady || scanning} />
              </BtnRow>
              <BtnRow>
                <Btn small kind="secondary" icon="▶️" title={t('ap_runNow')} onPress={runNow} busy={running} disabled={!s.enabled} />
                <Btn small kind="ghost" icon="⚙️" title={t('ap_settings')} onPress={() => setSettingsOpen(true)} />
              </BtnRow>
              {!d.aiReady && <Notice text={t('ap_noAi')} />}
              {!d.gatewayConnected && <Notice tone="blue" text={t('ap_noGateway')} />}
              {Number(s.effectiveLoanLimit) <= 0 && s.autoLoans && <Notice text={t('ap_setLimit')} />}
            </Card>

            <SectionTitle>{`${t('ap_needsYou')} (${attention.length})`}</SectionTitle>
            {attention.length === 0 ? (
              <Card><Text style={{ color: c.green, fontWeight: '700' }}>✓ {t('ap_allClear')}</Text></Card>
            ) : attention.map(a => (
              <Card key={a.id}>
                <Text style={{ color: c.text, fontWeight: '600', marginBottom: 6 }}>{a.message}</Text>
                <Text style={{ color: c.muted, fontSize: 11, marginBottom: 6 }}>{when(a.updatedAt)}</Text>
                <BtnRow>
                  {a.canApprove && (
                    <Btn small icon="✅" title={t('ap_approve')} busy={busyId === a.id}
                      onPress={() => confirm(t('ap_approve'), t('ap_approveMsg', { amount: inr(a.amount) }), t('ap_approve'), t('common_cancel'),
                        () => act(a.id, () => api.post(`/agent/loans/${a.entityId}/approve`, {}), t('ap_approved')))} />
                  )}
                  {!!ENTITY_ROUTE[a.entityType] && a.entityId && (
                    <Btn small kind="secondary" title={t('common_open')} onPress={() => push(ENTITY_ROUTE[a.entityType], { id: a.entityId })} />
                  )}
                  <Btn small kind="ghost" title={t('ap_dismiss')} disabled={busyId === a.id}
                    onPress={() => act(a.id, () => api.post(`/agent/actions/${a.id}/dismiss`))} />
                </BtnRow>
              </Card>
            ))}

            <SectionTitle>{t('ap_didRecently')}</SectionTitle>
            {recent.length === 0 ? <Card><Text style={{ color: c.muted }}>{t('ap_nothingYet')}</Text></Card> : recent.map(a => (
              <Card key={a.id}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Text style={{ fontSize: 18 }}>{ICONS[a.actionType] || '•'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: a.status === 'Undone' ? c.muted : c.text, textDecorationLine: a.status === 'Undone' ? 'line-through' : 'none' }}>
                      {a.message}
                    </Text>
                    <Text style={{ color: c.muted, fontSize: 11, marginTop: 2 }}>
                      {when(a.createdAt)}{a.status === 'Undone' ? ` · ${t('ap_undone')}` : ''}
                    </Text>
                  </View>
                </View>
                {(a.canUndo || a.txnId) && (
                  <BtnRow>
                    {!!a.txnId && <Btn small kind="ghost" title={t('ap_receipt')} onPress={() => push('receipt', { id: a.txnId })} />}
                    {a.canUndo && (
                      <Btn small kind="ghost" title={t('ap_undo')} busy={busyId === a.id}
                        onPress={() => confirm(t('ap_undo'), t('ap_undoMsg'), t('ap_undo'), t('common_cancel'),
                          () => act(a.id, () => api.post(`/agent/actions/${a.id}/undo`, {})), true)} />
                    )}
                  </BtnRow>
                )}
              </Card>
            ))}
            <Btn small kind="ghost" title={t('ap_refresh')} onPress={reload} />
          </>
        )}
      </Gate>
      {s && (
        <FormSheet
          visible={settingsOpen}
          title={t('ap_settings')}
          onClose={() => setSettingsOpen(false)}
          notice={t('ap_settingsHint')}
          initial={{ ...s, autoLoanLimit: s.autoLoanLimit == null ? '' : String(s.autoLoanLimit) }}
          fields={[
            { key: 'enabled', label: t('ap_enabled'), type: 'switch' },
            { key: 'autoMembers', label: t('ap_autoMembers'), type: 'switch' },
            { key: 'autoDues', label: t('ap_autoDues'), type: 'switch' },
            { key: 'autoPaymentLinks', label: t('ap_autoLinks'), type: 'switch', help: t('ap_autoLinksHelp') },
            { key: 'autoLoans', label: t('ap_autoLoans'), type: 'switch' },
            { key: 'autoLoanLimit', label: t('ap_loanLimit'), type: 'money', help: t('ap_loanLimitHelp', { amount: inr(s.policyLoanLimit) }) },
            { key: 'autoDisburse', label: t('ap_autoDisburse'), type: 'switch', help: t('ap_autoDisburseHelp') },
            { key: 'disburseMethod', label: t('ap_disburseMethod'), type: 'select', options: [
              { value: 'Cash', label: t('ap_cash') }, { value: 'Bank Transfer', label: t('ap_bank') }, { value: 'UPI', label: 'UPI' }] },
            { key: 'autoMeetings', label: t('ap_autoMeetings'), type: 'switch' },
            { key: 'autoCloseBooks', label: t('ap_autoClose'), type: 'switch' },
          ]}
          onSubmit={async v => {
            const limit = v.autoLoanLimit === '' || v.autoLoanLimit == null ? null : Number(v.autoLoanLimit);
            const r = await api.put(`/agent/settings/${groupId}`, {
              enabled: !!v.enabled, autoMembers: !!v.autoMembers, autoDues: !!v.autoDues, autoPaymentLinks: !!v.autoPaymentLinks,
              autoLoans: !!v.autoLoans, autoLoanLimit: limit, autoDisburse: !!v.autoDisburse, disburseMethod: v.disburseMethod,
              autoMeetings: !!v.autoMeetings, autoCloseBooks: !!v.autoCloseBooks,
            });
            bump();
            return r;
          }}
        />
      )}
    </Screen>
  );
}

/** Small banner for the dashboard: how many things the Autopilot needs from a person. */
export function AutopilotBanner() {
  const { api, t, c, push, groupId, has } = useShg();
  const { data } = useLoad(() => (groupId ? api.get('/agent/overview', { groupId }) : Promise.resolve(null)), [groupId]);
  const d = data as any;
  if (!groupId || !d || !has('shg_groups')) return null;
  const n = (d.attention || []).length;
  return (
    <Card onPress={() => push('autopilot')} a11y={t('ap_title')}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 24 }}>🤖</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.text, fontWeight: '800' }}>{t('ap_title')} · {d.settings.enabled ? t('ap_on') : t('ap_off')}</Text>
          <Text style={{ color: n ? c.red : c.green, fontSize: 12, fontWeight: '600' }}>
            {n ? t('ap_bannerNeeds', { n }) : t('ap_allClear')}
          </Text>
        </View>
        <Text style={{ color: c.brand, fontWeight: '800' }}>›</Text>
      </View>
    </Card>
  );
}
