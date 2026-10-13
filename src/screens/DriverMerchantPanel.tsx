/**
 * DriverMerchantPanel.tsx
 * Auto driver merchant account (Razorpay Route linked account).
 *
 * The driver submits KYC + bank details once and gets a permanent payment QR. Every
 * payment on that QR is recorded by the backend (webhook / polling) and listed here
 * automatically - the driver never enters a transaction by hand.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { TranslationKey } from '../../i18n';

const POLL_INTERVAL_MS = 10000;

interface MerchantAccount {
  legalName: string;
  phone: string;
  email: string;
  panLast4: string;
  bankLast4: string;
  ifsc: string;
  status: string;
  statusNote: string;
  hasQr: boolean;
  /** QR was issued with Razorpay test keys - no real money moves. */
  testMode?: boolean;
  /** The QR lives in the driver's own Razorpay account, so payments go straight to him. */
  ownKeys?: boolean;
  keyIdMasked?: string;
  qrImageUrl: string | null;
}

interface MerchantPayment {
  id: string;
  amount: number;
  payerVpa: string;
  rrn: string;
  gatewayPaymentId: string;
  transferStatus: 'PENDING' | 'SENDING' | 'CREATED' | 'FAILED' | 'MANUAL' | 'DIRECT';
  transferAmount: number | null;
  refundedAmount?: number;
  paidAt: string;
}

interface Props {
  ownerId: number;
  userName?: string;
  userEmail?: string;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  /** Called when new QR payments were recorded, so the trips list can reload. */
  onPaymentsChanged: () => void;
  /** Reports the driver's live payment QR image (null while there is none) so the screen can show
   *  it elsewhere, and whether he can replace his Razorpay keys. */
  onQrChange?: (qrImageUrl: string | null, canUpdateKeys: boolean, testMode: boolean) => void;
  /** Once the account is active, drop the account card: the screen shows the QR and an edit icon itself. */
  compactWhenActive?: boolean;
  /** Reports why the server could not read the driver's payments from the gateway (null when it could). */
  onSyncError?: (message: string | null) => void;
  /** The screen lists QR payments itself (together with cash), so do not render the grid here. */
  hidePaymentsGrid?: boolean;
}

export interface DriverMerchantPanelHandle {
  /** Opens the form where the driver replaces his Razorpay keys. */
  openKeysForm: () => void;
  /** Test keys only: records a made-up payment on the driver's QR. */
  addTestPayment: () => void;
}

const EMPTY_FORM = {
  legalName: '',
  phone: '',
  email: '',
  pan: '',
  street: '',
  city: '',
  state: '',
  postalCode: '',
  accountNumber: '',
  ifsc: '',
  beneficiaryName: '',
  keyId: '',
  keySecret: '',
  webhookSecret: '',
};

type FormState = typeof EMPTY_FORM;

export default forwardRef<DriverMerchantPanelHandle, Props>(function DriverMerchantPanel(
  { ownerId, userName, userEmail, apiFetch, t, onPaymentsChanged, onQrChange, compactWhenActive, hidePaymentsGrid, onSyncError },
  ref,
) {
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<MerchantAccount | null>(null);
  const [gatewayConfigured, setGatewayConfigured] = useState(true);
  // Without Route the platform pays drivers out itself, so only bank details are collected.
  const [routeEnabled, setRouteEnabled] = useState(false);
  // Each driver connects his own Razorpay account (Key Id + Secret) and is paid directly.
  const [ownKeysMode, setOwnKeysMode] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [payments, setPayments] = useState<MerchantPayment[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [tncAccepted, setTncAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const lastTopPaymentId = useRef<string | null | undefined>(undefined);

  // A QR issued before the driver connected his own account belongs to the platform, so it is not shown.
  const needsKeys = ownKeysMode && !!account && !account.ownKeys;
  const isActive = account?.status === 'ACTIVATED' && account.hasQr && !needsKeys;

  async function loadAccount() {
    try {
      const res = await apiFetch(`/api/driver/merchant-account?owner_id=${ownerId}`);
      if (!res.ok) return;
      const data = await res.json();
      setAccount(data.account || null);
      setGatewayConfigured(data.gatewayConfigured !== false);
      setRouteEnabled(data.routeEnabled === true);
      setOwnKeysMode(data.ownKeysMode === true);
      setWebhookUrl(data.webhookUrl || '');
    } catch (e) {
      console.error('Error loading merchant account:', e);
    } finally {
      setLoading(false);
    }
  }

  async function loadPayments() {
    try {
      const res = await apiFetch(`/api/driver/merchant-payments?owner_id=${ownerId}`);
      if (!res.ok) return;
      const data = await res.json();
      const list: MerchantPayment[] = data.payments || [];
      setPayments(list);
      setTodayTotal(data.todayTotal || 0);
      setTodayCount(data.todayCount || 0);
      onSyncError?.(data.syncError || null);
      // undefined = first load. Later, any change (including the list emptying) means trips changed too.
      const topId = list[0]?.id ?? null;
      const previous = lastTopPaymentId.current;
      if (previous === undefined ? topId !== null : topId !== previous) onPaymentsChanged();
      lastTopPaymentId.current = topId;
    } catch (e) {
      console.error('Error loading merchant payments:', e);
    }
  }

  useEffect(() => {
    loadAccount();
  }, [ownerId]);

  const liveQrUrl = isActive ? account?.qrImageUrl ?? null : null;
  useEffect(() => {
    onQrChange?.(liveQrUrl, !!liveQrUrl && ownKeysMode, !!liveQrUrl && !!account?.testMode);
  }, [liveQrUrl, ownKeysMode, account?.testMode]);

  useImperativeHandle(ref, () => ({ openKeysForm: openForm, addTestPayment: handleAddTestPayment }));

  // While the panel is on screen, keep pulling so a payment shows up seconds after the scan.
  useEffect(() => {
    if (!isActive) return;
    loadPayments();
    const timer = setInterval(loadPayments, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isActive, ownerId]);

  function openForm() {
    setForm({
      ...EMPTY_FORM,
      legalName: account?.legalName || userName || '',
      phone: account?.phone || '',
      email: account?.email || userEmail || '',
      ifsc: account?.ifsc || '',
    });
    setTncAccepted(false);
    setShowForm(true);
  }

  function setField(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleRefreshStatus() {
    setRefreshing(true);
    await loadAccount();
    setRefreshing(false);
  }

  async function handleSubmit() {
    const required: (keyof FormState)[] = ownKeysMode
      ? ['legalName', 'phone', 'keyId', 'keySecret']
      : routeEnabled
      ? ['legalName', 'phone', 'email', 'pan', 'street', 'city', 'state', 'postalCode', 'accountNumber', 'ifsc']
      : ['legalName', 'phone', 'accountNumber', 'ifsc'];
    if (required.some(key => !form[key].trim()) || !tncAccepted) {
      Alert.alert(t('common_error'), t('drv_mchMissing'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch('/api/driver/merchant-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, ...form, tncAccepted: true }),
      });
      const data = await res.json();
      if (res.ok) {
        setAccount(data.account);
        setShowForm(false);
        Alert.alert(t('common_success'), t('drv_mchSubmitted'));
      } else {
        // A step may have gone through before the failure - pick up whatever was saved.
        loadAccount();
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddTestPayment() {
    try {
      const res = await apiFetch('/api/driver/merchant-payments/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId }),
      });
      if (res.ok) {
        loadPayments();
      } else {
        const data = await res.json();
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    }
  }

  function transferLabel(status: MerchantPayment['transferStatus']) {
    if (status === 'CREATED') return t('drv_mchTrfCreated');
    if (status === 'FAILED') return t('drv_mchTrfFailed');
    if (status === 'MANUAL') return t('drv_mchTrfManual');
    if (status === 'DIRECT') return t('drv_mchTrfDirect');
    return t('drv_mchTrfPending');
  }

  function renderStatusBadge() {
    if (!account) return null;
    const tone =
      account.status === 'ACTIVATED' ? styles.badgeGreen : account.status === 'NEEDS_CLARIFICATION' ? styles.badgeRed : styles.badgeAmber;
    const toneText =
      account.status === 'ACTIVATED' ? styles.badgeGreenText : account.status === 'NEEDS_CLARIFICATION' ? styles.badgeRedText : styles.badgeAmberText;
    const label =
      account.status === 'ACTIVATED'
        ? t('drv_mchStatusActive')
        : account.status === 'NEEDS_CLARIFICATION'
        ? t('drv_mchStatusAction')
        : t('drv_mchStatusReview');
    return (
      <View style={[styles.badge, tone]}>
        <Text style={[styles.badgeText, toneText]}>{label}</Text>
      </View>
    );
  }

  function renderInput(key: keyof FormState, label: TranslationKey, extra?: Partial<React.ComponentProps<typeof TextInput>>) {
    return (
      <View style={styles.fieldWrap}>
        <Text style={styles.fieldLabel}>{t(label)}</Text>
        <TextInput
          value={form[key]}
          onChangeText={value => setField(key, value)}
          style={styles.input}
          placeholderTextColor={palette.muted}
          {...extra}
        />
      </View>
    );
  }

  if (loading) return null;

  return (
    <View>
      {!(isActive && compactWhenActive) && (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          {isActive && account?.qrImageUrl ? (
            <Pressable onPress={() => setShowQr(true)}>
              <Image source={{ uri: account.qrImageUrl }} style={styles.qrThumb} resizeMode="cover" />
            </Pressable>
          ) : (
            <View style={styles.iconBox}>
              <Text style={{ fontSize: 22 }}>🏦</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t('drv_mchTitle')}</Text>
              {renderStatusBadge()}
            </View>
            <Text style={styles.hint}>
              {!account
                ? !gatewayConfigured
                  ? t('drv_mchNotConfigured')
                  : ownKeysMode
                  ? t('drv_mchOwnSetupHint')
                  : t('drv_mchSetupHint')
                : needsKeys
                ? t('drv_mchNeedsKeys')
                : isActive
                ? t('drv_mchShowQr')
                : account.status === 'NEEDS_CLARIFICATION'
                ? t('drv_mchActionHint', { fields: account.statusNote || '-' })
                : t('drv_mchReviewHint')}
            </Text>
            {isActive && (
              <Text style={styles.metaLine}>
                {account!.ownKeys ? account!.keyIdMasked : t('drv_mchBankLine', { last4: account!.bankLast4 })} · {t('drv_mchTodayLine', { amount: todayTotal.toLocaleString(), count: todayCount })}
              </Text>
            )}
          </View>
        </View>

        {!account && gatewayConfigured && (
          <Pressable onPress={openForm} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>{t('drv_mchSetupBtn')}</Text>
          </Pressable>
        )}
        {account && !isActive && (
          <View style={styles.btnRow}>
            <Pressable onPress={handleRefreshStatus} disabled={refreshing} style={[styles.outlineBtn, { flex: 1 }]}>
              {refreshing ? <ActivityIndicator size="small" color={palette.brand} /> : <Text style={styles.outlineBtnText}>{t('drv_mchRefresh')}</Text>}
            </Pressable>
            {(account.status !== 'ACTIVATED' || ownKeysMode) && (
              <Pressable onPress={openForm} style={[styles.outlineBtn, { flex: 1 }]}>
                <Text style={styles.outlineBtnText}>{ownKeysMode ? t('drv_mchUpdateKeys') : t('drv_mchEditDetails')}</Text>
              </Pressable>
            )}
          </View>
        )}
        {isActive && ownKeysMode && (
          <Pressable onPress={openForm} style={styles.outlineBtn}>
            <Text style={styles.outlineBtnText}>{t('drv_mchUpdateKeys')}</Text>
          </Pressable>
        )}
      </View>
      )}

      {isActive && !hidePaymentsGrid && (
        <View style={styles.card}>
          <View style={[styles.titleRow, { justifyContent: 'space-between' }]}>
            <Text style={styles.title}>{t('drv_mchTxTitle')}</Text>
            {account?.testMode && (
              <Pressable onPress={handleAddTestPayment} style={[styles.badge, styles.badgeAmber]}>
                <Text style={[styles.badgeText, styles.badgeAmberText]}>{t('drv_mchTestBtn')}</Text>
              </Pressable>
            )}
          </View>
          {payments.length === 0 ? (
            <Text style={[styles.hint, { marginTop: 8 }]}>{t('drv_mchTxEmpty')}</Text>
          ) : (
            <View style={{ marginTop: 8 }}>
              <View style={[styles.gridRow, styles.gridHeader]}>
                <Text style={[styles.gridHeadText, styles.colTime]}>{t('drv_mchColTime')}</Text>
                <Text style={[styles.gridHeadText, styles.colPayer]}>{t('drv_mchColPayer')}</Text>
                <Text style={[styles.gridHeadText, styles.colAmount]}>{t('drv_mchColAmount')}</Text>
                <Text style={[styles.gridHeadText, styles.colStatus, { textAlign: 'right' }]}>{t('drv_mchColStatus')}</Text>
              </View>
              {payments.map(payment => {
                const paid = new Date(payment.paidAt);
                return (
                  <View key={payment.id} style={styles.gridRow}>
                    <View style={styles.colTime}>
                      <Text style={styles.gridCell}>{paid.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                      <Text style={styles.gridSub}>{paid.toLocaleDateString([], { day: '2-digit', month: 'short' })}</Text>
                    </View>
                    <View style={styles.colPayer}>
                      <Text style={styles.gridCell} numberOfLines={1}>{payment.payerVpa || t('drv_mchUnknownPayer')}</Text>
                      <Text style={styles.gridSub} numberOfLines={1}>{t('drv_mchRef', { ref: payment.rrn || payment.gatewayPaymentId })}</Text>
                    </View>
                    <Text style={[styles.gridCell, styles.colAmount, styles.amountText]}>₹{payment.amount.toLocaleString()}</Text>
                    <View style={styles.colStatus}>
                      {payment.refundedAmount ? (
                        <Text style={[styles.gridSub, styles.badgeRedText]}>
                          {t('drv_mchRefunded', { amount: payment.refundedAmount.toLocaleString() })}
                        </Text>
                      ) : (
                        <Text
                          style={[
                            styles.gridSub,
                            payment.transferStatus === 'CREATED' || payment.transferStatus === 'DIRECT' ? styles.badgeGreenText : payment.transferStatus === 'FAILED' ? styles.badgeRedText : styles.badgeAmberText,
                          ]}>
                          {transferLabel(payment.transferStatus)}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* Modal: enlarged payment QR for passengers to scan */}
      <Modal visible={showQr} animationType="fade" transparent onRequestClose={() => setShowQr(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeading}>📱 {t('drv_mchQrTitle')}</Text>
              <Pressable onPress={() => setShowQr(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>
            {account?.qrImageUrl && (
              <Image source={{ uri: account.qrImageUrl }} style={styles.qrLarge} resizeMode="contain" />
            )}
            <Text style={[styles.hint, { textAlign: 'center', marginTop: 10 }]}>{t('drv_mchQrHint')}</Text>
          </View>
        </View>
      </Modal>

      {/* Modal: KYC + bank details */}
      <Modal visible={showForm} animationType="slide" transparent onRequestClose={() => setShowForm(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeading}>{t('drv_mchFormTitle')}</Text>
              <Pressable onPress={() => setShowForm(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {renderInput('legalName', 'drv_mchFName', { autoCapitalize: 'words' })}
              {renderInput('phone', 'drv_mchFPhone', { keyboardType: 'phone-pad', maxLength: 10 })}
              {ownKeysMode && (
                <>
                  {renderInput('keyId', 'drv_mchFKeyId', { autoCapitalize: 'none', autoCorrect: false, placeholder: 'rzp_live_...' })}
                  {renderInput('keySecret', 'drv_mchFKeySecret', { autoCapitalize: 'none', autoCorrect: false, secureTextEntry: true })}
                  {renderInput('webhookSecret', 'drv_mchFWebhookSecret', { autoCapitalize: 'none', autoCorrect: false, secureTextEntry: true })}
                  <Text style={[styles.hint, { marginTop: -4, marginBottom: 10 }]}>{t('drv_mchWebhookHint')}</Text>
                  {!!webhookUrl && (
                    <Text selectable style={[styles.hint, { marginTop: -6, marginBottom: 10, color: palette.navy }]}>{webhookUrl}</Text>
                  )}
                </>
              )}
              {!ownKeysMode && routeEnabled && (
                <>
              {renderInput('email', 'drv_mchFEmail', { keyboardType: 'email-address', autoCapitalize: 'none' })}
              {renderInput('pan', 'drv_mchFPan', { autoCapitalize: 'characters', maxLength: 10, placeholder: 'ABCDE1234F' })}
              {renderInput('street', 'drv_mchFStreet')}
              <View style={styles.btnRow}>
                <View style={{ flex: 1 }}>{renderInput('city', 'drv_mchFCity', { autoCapitalize: 'words' })}</View>
                <View style={{ flex: 1 }}>{renderInput('postalCode', 'drv_mchFPin', { keyboardType: 'number-pad', maxLength: 6 })}</View>
              </View>
              {renderInput('state', 'drv_mchFState', { autoCapitalize: 'words' })}
                </>
              )}
              {!ownKeysMode && (
                <>
              {renderInput('accountNumber', 'drv_mchFAccount', { keyboardType: 'number-pad', maxLength: 18 })}
              {renderInput('ifsc', 'drv_mchFIfsc', { autoCapitalize: 'characters', maxLength: 11, placeholder: 'SBIN0001234' })}
              {renderInput('beneficiaryName', 'drv_mchFBeneficiary', { autoCapitalize: 'words', placeholder: form.legalName })}
                </>
              )}

              <Pressable onPress={() => setTncAccepted(v => !v)} style={styles.tncRow}>
                <View style={[styles.checkbox, tncAccepted && styles.checkboxOn]}>
                  {tncAccepted && <Text style={styles.checkboxTick}>✓</Text>}
                </View>
                <Text style={[styles.hint, { flex: 1, marginTop: 0 }]}>{ownKeysMode ? t('drv_mchOwnTnc') : t('drv_mchTnc')}</Text>
              </Pressable>

              <Pressable onPress={handleSubmit} disabled={submitting} style={[styles.primaryBtn, submitting && { opacity: 0.6 }]}>
                <Text style={styles.primaryBtnText}>{submitting ? t('common_saving') : t('drv_mchSubmit')}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
});

// Mirrors the palette in App.tsx.
const palette = {
  brand: '#4F46E5',
  brandBg: '#EEF2FF',
  navy: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  panel: '#FFFFFF',
  page: '#F8FAFC',
  green: '#059669',
  greenBg: '#ECFDF5',
  red: '#DC2626',
  redBg: '#FEF2F2',
  amber: '#D97706',
  amberBg: '#FFFBEB',
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.panel,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  title: { fontSize: 13, fontWeight: '800', color: palette.navy },
  hint: { fontSize: 11, color: palette.muted, marginTop: 2 },
  metaLine: { fontSize: 11, color: palette.navy, fontWeight: '600', marginTop: 4 },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.brandBg,
  },
  qrThumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#fff' },
  qrLarge: { width: '100%', aspectRatio: 0.7, backgroundColor: '#fff', borderRadius: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  badgeGreen: { backgroundColor: palette.greenBg },
  badgeGreenText: { color: palette.green },
  badgeAmber: { backgroundColor: palette.amberBg },
  badgeAmberText: { color: palette.amber },
  badgeRed: { backgroundColor: palette.redBg },
  badgeRedText: { color: palette.red },
  btnRow: { flexDirection: 'row', gap: 8 },
  primaryBtn: {
    backgroundColor: palette.brand,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  outlineBtn: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  outlineBtnText: { color: palette.brand, fontSize: 12, fontWeight: '700' },

  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    gap: 6,
  },
  gridHeader: { backgroundColor: palette.page, paddingHorizontal: 4, borderRadius: 6, borderBottomWidth: 0 },
  gridHeadText: { fontSize: 10, fontWeight: '700', color: palette.muted, textTransform: 'uppercase' },
  gridCell: { fontSize: 12, color: palette.navy, fontWeight: '600' },
  gridSub: { fontSize: 10, color: palette.muted, marginTop: 1 },
  colTime: { width: 58 },
  colPayer: { flex: 1 },
  colAmount: { width: 62, textAlign: 'right' },
  colStatus: { width: 72, alignItems: 'flex-end' },
  amountText: { color: palette.green, fontWeight: '800' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', justifyContent: 'center', padding: 18 },
  modalContent: { backgroundColor: palette.panel, borderRadius: 16, padding: 18 },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalHeading: { fontSize: 18, fontWeight: '800', color: palette.navy },
  modalCloseText: { fontSize: 18, color: palette.muted, fontWeight: '700' },
  fieldWrap: { marginBottom: 10 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: palette.muted, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: palette.navy,
    backgroundColor: palette.page,
  },
  tncRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: palette.brand, borderColor: palette.brand },
  checkboxTick: { color: '#fff', fontSize: 13, fontWeight: '800' },
});
