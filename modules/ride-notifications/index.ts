import { requireOptionalNativeModule } from 'expo';

export type RideNotification = {
  id: string;
  packageName: string;
  title: string;
  text: string;
  /** Labels of the notification's buttons, joined with " | " (empty when it has none). */
  actions: string;
  date: number;
};

type RideNotificationsNative = {
  isListenerIncluded(): Promise<boolean>;
  isAccessGranted(): Promise<boolean>;
  openAccessSettings(): Promise<void>;
  readSince(sinceMs: number, maxCount: number): Promise<RideNotification[]>;
  clear(): Promise<void>;
  postTestNotification(title: string, text: string): Promise<void>;
};

// null in Expo Go / iOS / builds made before this module existed
const native = requireOptionalNativeModule<RideNotificationsNative>('RideNotifications');

export const isRideNotificationsAvailable = native !== null;

/** Whether this build contains the notification listener at all (only test builds made with -PrideAlerts=true do). */
export async function isRideListenerIncluded(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.isListenerIncluded();
  } catch {
    return false;
  }
}

/** Whether the driver has turned on "Notification access" for this app in Android Settings. */
export async function isRideNotificationAccessGranted(): Promise<boolean> {
  if (!native) return false;
  return native.isAccessGranted();
}

export async function openRideNotificationAccessSettings(): Promise<void> {
  if (native) await native.openAccessSettings();
}

/** Notifications from ride-hailing apps posted after sinceMs, newest first. */
export async function readRideNotifications(sinceMs = 0, maxCount = 300): Promise<RideNotification[]> {
  if (!native) return [];
  return native.readSince(sinceMs, maxCount);
}

/** Posts a real notification from this app, marked as a test, to check that capture works. */
export async function postTestRideNotification(title: string, text: string): Promise<void> {
  if (native) await native.postTestNotification(title, text);
}

export async function clearRideNotifications(): Promise<void> {
  if (native) await native.clear();
}
