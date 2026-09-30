import { requireOptionalNativeModule } from 'expo';

export type InboxSms = { id: string; address: string; body: string; date: number };

type SmsReaderNative = {
  readInbox(sinceMs: number, maxCount: number): Promise<InboxSms[]>;
};

// null in Expo Go / iOS / builds made before this module existed
const native = requireOptionalNativeModule<SmsReaderNative>('SmsReader');

export const isSmsReaderAvailable = native !== null;

export async function readInbox(sinceMs: number, maxCount = 40): Promise<InboxSms[]> {
  if (!native) return [];
  return native.readInbox(sinceMs, maxCount);
}
