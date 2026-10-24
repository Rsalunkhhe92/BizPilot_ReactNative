/**
 * Online savings collection through the group's Razorpay account:
 * connect keys, member QR / payment link, background sync, and the list of online payments.
 */
import React, { useEffect, useState } from 'react';
import { Alert, Image, Linking, Share, Text, View } from 'react-native';
import { fmtDate, inr } from '../format';
import { Badge, Btn, BtnRow, Card, ErrorBox, FormSheet, Gate, KV, ListItem, Notice, Screen, SectionTitle, Sheet, confirm, errorText, useLoad, useShg } from '../ui';

/** Pulls new Razorpay payments for the group when a money screen opens (server throttles it). */
export function useGatewaySync(groupId: number | null) {
  const { api, bump, has, toast, t } = useShg();
  useEffect(() => {
    if (!groupId || !has('shg_savings')) return;
    let cancelled = false;
    api.post(`/groups/${groupId}/gateway/sync`)
      .then((r: any) => {
        if (!cancelled && r?.posted > 0) {
          toast(t('onl_synced', { n: r.posted }));
          bump();
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function OnlinePaymentsCard({ groupId }: { groupId: number }) {
  const { api, t, push, c } = useShg();
  const { data, loading, error, reload } = useLoad(() => api.get(`/groups/${groupId}/gateway`), [groupId]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const gw = (data as any)?.gateway;
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post(`/groups/${groupId}/gateway/sync?force=1`);
      Alert.alert(t('onl_title'), r.errors?.length ? `${t('onl_syncedN', { n: r.posted })}\n${r.errors.join('\n')}` : t('onl_syncedN', { n: r.posted }));
      reload();
    } catch (e) {
      Alert.alert(t('common_error'), errorText(t, e));
    } finally {
      setSyncing(false);
    }
  };
  return (
    <>
      <SectionTitle>{t('onl_title')}</SectionTitle>
      <Gate loading={loading} error={error} onRetry={reload}>
        {gw && (
          <Card>
            {gw.connected ? (
              <>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
                  <Badge value="Active" label={t('onl_connected')} />
                  <Badge value={gw.mode === 'live' ? 'Posted' : 'Pending'} label={gw.mode === 'live' ? t('onl_live') : t('onl_test')} />
                </View>
                <KV label={t('onl_keyId')} value={gw.keyIdMasked} />
                <KV label={t('onl_memberQrs')} value={String(gw.memberQrs)} />
                <KV label={t('onl_postedCount')} value={String(gw.posted)} />
                {gw.unposted > 0 && <KV label={t('onl_unpostedCount')} value={String(gw.unposted)} color={c.red} />}
                <Text style={{ color: c.muted, fontSize: 12, marginTop: 6 }}>{t('onl_webhookUrl')}</Text>
                <Text selectable style={{ color: c.text, fontSize: 12, marginBottom: 4 }}>{gw.webhookUrl}</Text>
                {!gw.hasWebhookSecret && <Notice text={t('onl_noWebhook')} />}
                <BtnRow>
                  <Btn small title={t('onl_syncNow')} onPress={sync} busy={syncing} />
                  <Btn small kind="secondary" title={t('onl_viewPayments')} onPress={() => push('gatewayPayments', { groupId })} />
                  <Btn small kind="ghost" title={t('onl_updateKeys')} onPress={() => setConnectOpen(true)} />
                  <Btn small kind="ghost" title={t('onl_disconnect')} onPress={() => confirm(t('onl_disconnect'), t('onl_disconnectMsg'), t('onl_disconnect'),
                    t('common_cancel'), async () => { try { await api.del(`/groups/${groupId}/gateway`); reload(); } catch (e) { Alert.alert(t('common_error'), errorText(t, e)); } }, true)} />
                </BtnRow>
              </>
            ) : (
              <>
                <Text style={{ color: c.sub, marginBottom: 8 }}>{t('onl_intro')}</Text>
                <Btn title={t('onl_connect')} onPress={() => setConnectOpen(true)} />
                <Btn small kind="ghost" title={t('onl_whereKeys')} onPress={() => Linking.openURL('https://dashboard.razorpay.com/app/website-app-settings/api-keys').catch(() => {})} />
              </>
            )}
          </Card>
        )}
      </Gate>
      <FormSheet
        visible={connectOpen}
        title={gw?.connected ? t('onl_updateKeys') : t('onl_connect')}
        onClose={() => setConnectOpen(false)}
        notice={t('onl_keysHint')}
        fields={[
          { key: 'keyId', label: t('onl_keyId'), required: true, placeholder: 'rzp_live_…' },
          { key: 'keySecret', label: t('onl_keySecret'), required: true },
          { key: 'webhookSecret', label: t('onl_webhookSecret'), help: t('onl_webhookSecretHelp') },
        ]}
        onSubmit={async v => { const r = await api.put(`/groups/${groupId}/gateway`, v); reload(); return r; }}
      />
    </>
  );
}

/** Member profile actions: show/share her QR, send a payment link for her due. */
export function MemberOnlineActions({ member }: { member: any }) {
  const { api, t, c } = useShg();
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState<'qr' | 'link' | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const showQr = async () => {
    setBusy('qr');
    try {
      const r = await api.post(`/members/${member.id}/payment-qr`);
      setQr(r.qrImageUrl);
    } catch (e) {
      Alert.alert(t('common_error'), errorText(t, e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <BtnRow>
        <Btn small kind="secondary" icon="📱" title={t('onl_paymentQr')} onPress={showQr} busy={busy === 'qr'} />
        <Btn small kind="secondary" icon="🔗" title={t('onl_sendLink')} onPress={() => setLinkOpen(true)} />
      </BtnRow>
      <Sheet visible={!!qr} title={`${t('onl_paymentQr')} · ${member.fullName}`} onClose={() => setQr(null)}>
        <Text style={{ color: c.sub, marginBottom: 8 }}>{t('onl_qrHint')}</Text>
        {!!qr && <Image source={{ uri: qr }} style={{ width: '100%', aspectRatio: 0.7, maxHeight: 460 }} resizeMode="contain" />}
        <Btn title={t('onl_shareQr')} icon="📤" onPress={() => qr && Share.share({ message: `${t('onl_shareQrMsg', { name: member.fullName })}\n${qr}` })} />
      </Sheet>
      <FormSheet
        visible={linkOpen}
        title={t('onl_sendLink')}
        onClose={() => setLinkOpen(false)}
        notice={t('onl_linkHint')}
        fields={[{ key: 'amount', label: t('common_amount'), type: 'money', help: t('onl_linkAmountHelp') }]}
        onSubmit={async v => {
          const r = await api.post(`/members/${member.id}/payment-link`, { amount: v.amount || undefined });
          await Share.share({ message: t('onl_linkMsg', { name: member.fullName, group: r.groupName, amount: inr(r.link.amount), url: r.link.shortUrl }) });
          return r;
        }}
      />
    </>
  );
}

export function GatewayPaymentsScreen({ params }: { params: { groupId: number } }) {
  const { api, t, push, bump } = useShg();
  const { data, loading, error, reload, refreshing } = useLoad(() => api.get(`/groups/${params.groupId}/gateway/payments`), [params.groupId]);
  const [retryErr, setRetryErr] = useState<string | null>(null);
  const list = (data as any)?.payments || [];
  const retry = async (p: any) => {
    setRetryErr(null);
    try { await api.post(`/gateway-payments/${p.id}/retry`); reload(); bump(); } catch (e) { setRetryErr(errorText(t, e)); }
  };
  return (
    <Screen title={t('onl_payments')} onRefresh={reload} refreshing={refreshing}>
      <Notice tone="blue" text={t('onl_paymentsHint')} />
      {!!retryErr && <ErrorBox message={retryErr} />}
      <Gate loading={loading} error={error} onRetry={reload} empty={!list.length} emptyText={t('onl_none')}>
        {list.map((p: any) => (
          <View key={p.id}>
            <ListItem
              title={`#${p.memberNumber} ${p.memberName}`}
              subtitle={`${fmtDate(p.paidAt)} · ${p.source === 'QR' ? 'QR' : t('onl_link')}${p.payerVpa ? ` · ${p.payerVpa}` : ''}`}
              meta={p.status === 'Posted' ? `${p.receiptNumber || ''}${Number(p.fee) ? ` · ${t('onl_fee')} ${inr(p.fee)}` : ''}` : p.note}
              right={inr(p.amount)}
              badge={p.status === 'Posted' ? 'Posted' : 'Failed'}
              onPress={p.txnId ? () => push('receipt', { id: p.txnId }) : undefined}
            />
            {p.status === 'Unposted' && <Btn small kind="ghost" title={t('onl_retry')} onPress={() => retry(p)} />}
          </View>
        ))}
      </Gate>
    </Screen>
  );
}
