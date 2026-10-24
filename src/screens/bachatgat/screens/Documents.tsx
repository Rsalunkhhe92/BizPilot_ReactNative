import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { fmtDate } from '../format';
import { Badge, Btn, BtnRow, Card, ErrorBox, FormSheet, Gate, KV, Loading, SectionTitle, confirm, errorText, useLoad, useShg } from '../ui';

const DOC_TYPES = ['Aadhaar / ID proof', 'Photograph', 'Address proof', 'Bank passbook', 'Formation resolution', 'Registration certificate',
  'Loan application form', 'Meeting minutes', 'Scheme application', 'Sanction letter', 'Utilization certificate', 'Other'];

const MAX_BYTES = 3 * 1024 * 1024;

export function DocumentsPanel({ entityType, entityId, canUpload = true, onPhoto }: {
  entityType: 'GROUP' | 'MEMBER' | 'LOAN' | 'SCHEME' | 'MEETING'; entityId: number; canUpload?: boolean; onPhoto?: () => void;
}) {
  const { api, t, bump } = useShg();
  const { data, loading, error, reload } = useLoad(() => api.get('/documents', { entityType, entityId }), [entityType, entityId]);
  const [picked, setPicked] = useState<{ base64: string; mimeType: string; fileName: string; isPhoto?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyDoc, setVerifyDoc] = useState<any>(null);
  const [opErr, setOpErr] = useState<string | null>(null);
  const docs = (data as any)?.documents || [];

  const pickImage = async (camera: boolean, isPhoto = false) => {
    setOpErr(null);
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert(t('common_error'), t('doc_permission'));
    const opts: ImagePicker.ImagePickerOptions = { base64: true, quality: 0.6, mediaTypes: ['images'] };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]?.base64) return;
    const a = res.assets[0];
    const mime = a.mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    if ((a.base64!.length * 3) / 4 > MAX_BYTES) return Alert.alert(t('common_error'), t('doc_tooLarge'));
    setPicked({ base64: a.base64!, mimeType: mime, fileName: a.fileName || `photo.${mime === 'image/png' ? 'png' : 'jpg'}`, isPhoto });
  };

  const pickPdf = async () => {
    setOpErr(null);
    let DocumentPicker: typeof import('expo-document-picker');
    try {
      DocumentPicker = require('expo-document-picker');
    } catch {
      return Alert.alert(t('common_error'), t('doc_pickerUnavailable'));
    }
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    const a = res.assets[0];
    if ((a.size || 0) > MAX_BYTES) return Alert.alert(t('common_error'), t('doc_tooLarge'));
    const base64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
    setPicked({ base64, mimeType: 'application/pdf', fileName: a.name || 'document.pdf' });
  };

  const view = async (doc: any) => {
    setBusy(true);
    try {
      const res = await api.get(`/documents/${doc.id}/content`);
      const safe = String(res.fileName || 'document').replace(/[^\w.-]+/g, '_');
      const uri = `${FileSystem.cacheDirectory}shg-${doc.id}-${safe}`;
      await FileSystem.writeAsStringAsync(uri, res.fileBase64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: res.mimeType, dialogTitle: doc.documentType });
      else Alert.alert(t('common_error'), t('err_shareUnavailable'));
    } catch (e) {
      setOpErr(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (doc: any) => confirm(t('doc_delete'), doc.fileName, t('doc_delete'), t('common_cancel'), async () => {
    try { await api.del(`/documents/${doc.id}`); reload(); } catch (e) { setOpErr(errorText(t, e)); }
  }, true);

  return (
    <View>
      <SectionTitle>{t('doc_title')}</SectionTitle>
      {canUpload && (
        <BtnRow>
          <Btn small kind="secondary" icon="📷" title={t('doc_camera')} onPress={() => pickImage(true)} />
          <Btn small kind="secondary" icon="🖼️" title={t('doc_gallery')} onPress={() => pickImage(false)} />
          <Btn small kind="secondary" icon="📄" title={t('doc_pdf')} onPress={pickPdf} />
          {!!onPhoto && <Btn small kind="secondary" icon="🤳" title={t('doc_setPhoto')} onPress={() => pickImage(true, true)} />}
        </BtnRow>
      )}
      {busy && <Loading />}
      {!!opErr && <ErrorBox message={opErr} />}
      <Gate loading={loading} error={error} onRetry={reload} empty={!docs.length} emptyText={t('doc_none')}>
        {docs.map((d: any) => (
          <Card key={d.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>{d.documentType}</Text>
              <Badge value={d.verificationStatus} />
            </View>
            <KV label={d.fileName} value={`${Math.ceil(d.sizeBytes / 1024)} KB · ${fmtDate(d.createdAt)}`} />
            {!!d.verificationRemarks && <KV label={t('common_remarks')} value={d.verificationRemarks} />}
            <BtnRow>
              <Btn small kind="ghost" title={t('doc_view')} onPress={() => view(d)} />
              {d.verificationStatus === 'Pending' && <Btn small kind="secondary" title={t('doc_verify')} onPress={() => setVerifyDoc(d)} />}
              {d.verificationStatus !== 'Verified' && <Btn small kind="ghost" title={t('doc_delete')} onPress={() => remove(d)} />}
            </BtnRow>
          </Card>
        ))}
      </Gate>

      <FormSheet
        visible={!!picked}
        title={t('doc_upload')}
        onClose={() => setPicked(null)}
        initial={{ documentType: picked?.isPhoto ? 'Photograph' : '' }}
        fields={[{ key: 'documentType', label: t('doc_type'), type: 'select', required: true, options: DOC_TYPES.map(x => ({ value: x, label: x })) }]}
        submitLabel={t('doc_upload')}
        notice={picked ? `${picked.fileName}` : undefined}
        onSubmit={async v => {
          await api.post('/documents', {
            entityType, entityId, documentType: v.documentType, fileName: picked!.fileName, mimeType: picked!.mimeType,
            fileBase64: picked!.base64, isPhoto: picked!.isPhoto,
          });
          reload();
          bump();
          if (picked?.isPhoto) onPhoto?.();
          return true;
        }}
      />
      <FormSheet
        visible={!!verifyDoc}
        title={t('doc_verify')}
        onClose={() => setVerifyDoc(null)}
        initial={{ status: 'Verified' }}
        fields={[
          { key: 'status', label: t('common_status'), type: 'select', required: true, options: [{ value: 'Verified', label: t('st_Verified') }, { value: 'Rejected', label: t('st_Rejected') }] },
          { key: 'remarks', label: t('common_remarks'), type: 'multiline' },
        ]}
        onSubmit={async v => { await api.post(`/documents/${verifyDoc.id}/verify`, v); reload(); return true; }}
      />
    </View>
  );
}

