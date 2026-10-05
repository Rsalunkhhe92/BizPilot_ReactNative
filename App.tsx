/**
 * AutoLedger Mobile - Customer Application
 * Dedicated Khata, Ledger, and Subscription Management for Local Businesses
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  Image,
  Linking,
  Modal,
  Platform,
  PermissionsAndroid,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect, Line as SvgLine, Text as SvgText } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import { detectUpiCredit } from './smsPayments';
import { isSmsReaderAvailable, readInbox } from './modules/sms-reader';
import { Language, LANGUAGE_LABELS, TranslationKey, translate } from './i18n';

// Design Tokens for AutoLedger Customer Mobile App
const colors = {
  // Brand Primary
  brand: '#4F46E5',
  brandDark: '#3730A3',
  brandLight: '#6366F1',
  brandBg: '#EEF2FF',

  // Dark & Neutral Palette
  navy: '#0F172A',
  slateDark: '#1E293B',
  slate: '#334155',
  muted: '#64748B',
  border: '#E2E8F0',
  borderDark: '#334155',
  panel: '#FFFFFF',
  panelDark: '#1E293B',
  page: '#F8FAFC',
  pageDark: '#0B1120',

  // Semantic Financial Accents
  green: '#059669',
  greenDark: '#047857',
  greenBg: '#ECFDF5',
  greenBorder: '#A7F3D0',

  red: '#DC2626',
  redDark: '#B91C1C',
  redBg: '#FEF2F2',
  redBorder: '#FECACA',

  amber: '#D97706',
  amberBg: '#FFFBEB',
  amberBorder: '#FDE68A',

  blue: '#2563EB',
  blueBg: '#EFF6FF',
};

// Driver dashboard chart colors - validated categorical/sequential slots (CVD-safe,
// contrast-checked); see the data-viz skill's palette reference. Kept separate from
// the app's ad-hoc UI badge colors, which were never validated for chart use.
const DASH_UPI_COLOR = '#2a78d6';
const DASH_CASH_COLOR = '#eb6834';
const DASH_SEQUENTIAL_COLOR = '#2a78d6';

function roundedTopBarPath(x: number, topY: number, width: number, height: number, radius: number) {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  const bottomY = topY + height;
  return `
    M ${x} ${bottomY}
    L ${x} ${topY + r}
    Q ${x} ${topY} ${x + r} ${topY}
    L ${x + width - r} ${topY}
    Q ${x + width} ${topY} ${x + width} ${topY + r}
    L ${x + width} ${bottomY}
    Z
  `;
}

// Straight-line (great-circle) distance between two GPS points, in km. Used as a
// rough distance estimate for trips that only have a location, not odometer readings -
// it undercounts actual road distance (no route curves), but beats showing 0 km.
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Blends real odometer-based distance (trips logged via the full form) with a GPS
// straight-line estimate chained across consecutive quick-logged trips that only have
// a location - so quick Cash/UPI/voice entries contribute to "today's distance" too.
function estimateTotalDistanceKm(driverTrips: { tripTimeMs: number; distanceKm: number; latitude: number | null; longitude: number | null }[]) {
  const odometerDistance = driverTrips.reduce((sum, t) => sum + (t.distanceKm > 0 ? t.distanceKm : 0), 0);
  const gpsPoints = driverTrips
    .filter(t => t.distanceKm <= 0 && t.latitude != null && t.longitude != null)
    .sort((a, b) => a.tripTimeMs - b.tripTimeMs);
  let gpsDistance = 0;
  for (let i = 1; i < gpsPoints.length; i++) {
    gpsDistance += haversineKm(gpsPoints[i - 1].latitude!, gpsPoints[i - 1].longitude!, gpsPoints[i].latitude!, gpsPoints[i].longitude!);
  }
  return Math.round((odometerDistance + gpsDistance) * 10) / 10;
}

// Classifies an Open-Meteo WMO weather code into a driving-risk tier and a short
// human label, for the route-safety advisory. Code table: https://open-meteo.com/en/docs
// Buckets a set of timestamped amounts across a date range into chart bars - daily
// bars for ranges up to 14 days (readable at that density), weekly bars beyond that
// so a month/custom range doesn't cram 30+ skinny bars into one chart.
function buildPeriodBuckets(records: { timeMs: number; amount: number }[], startISO: string, endISO: string) {
  const start = new Date(startISO + 'T00:00:00');
  const end = new Date(endISO + 'T00:00:00');
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const daily = totalDays <= 14;
  const bucketSpanDays = daily ? 1 : 7;
  const buckets: { label: string; amount: number }[] = [];
  const cursor = new Date(start);
  let weekIdx = 1;
  while (cursor.getTime() <= end.getTime()) {
    const bucketStart = cursor.getTime();
    const bucketEndDate = new Date(cursor);
    bucketEndDate.setDate(bucketEndDate.getDate() + bucketSpanDays - 1);
    const bucketEndMs = Math.min(bucketEndDate.getTime(), end.getTime()) + 24 * 60 * 60 * 1000;
    const amount = records
      .filter(r => r.timeMs >= bucketStart && r.timeMs < bucketEndMs)
      .reduce((sum, r) => sum + r.amount, 0);
    const label = daily ? cursor.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : `W${weekIdx}`;
    buckets.push({ label, amount });
    cursor.setDate(cursor.getDate() + bucketSpanDays);
    weekIdx++;
  }
  return buckets;
}

// Jan 1, 2023 was a Sunday - using it as a reference date lets us turn a plain
// Date.getDay() index (0-6) into a locale-aware weekday name without a lookup table.
function weekdayName(dow: number): string {
  return new Date(2023, 0, dow + 1).toLocaleDateString(undefined, { weekday: 'long' });
}

function timeOfDayBucket(hour: number): 'morning' | 'afternoon' | 'evening' | 'night' {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TTS_LOCALE_BY_LANGUAGE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };

function speakConfirmation(text: string, language: Language) {
  try {
    Speech.stop();
    Speech.speak(text, { language: TTS_LOCALE_BY_LANGUAGE[language], pitch: 1.0, rate: 0.95 });
  } catch (e) {
    console.error('Error speaking confirmation:', e);
  }
}

function classifyWeatherRisk(code: number): {
  severity: 'none' | 'mild' | 'severe';
  labelKey: 'drv_weatherThunderstorm' | 'drv_weatherHeavy' | 'drv_weatherMild' | null;
} {
  if (code >= 95) return { severity: 'severe', labelKey: 'drv_weatherThunderstorm' };
  if ([45, 48, 65, 67, 75, 82, 86].includes(code)) return { severity: 'severe', labelKey: 'drv_weatherHeavy' };
  if ([51, 53, 55, 56, 57, 61, 63, 66, 71, 73, 77, 80, 81, 85].includes(code)) return { severity: 'mild', labelKey: 'drv_weatherMild' };
  return { severity: 'none', labelKey: null };
}

// General current-condition description (always shown), distinct from classifyWeatherRisk
// (which only flags whether conditions are risky enough to warn about).
function describeWeatherCondition(code: number, isNight: boolean): {
  icon: string;
  labelKey: 'drv_weatherCondClear' | 'drv_weatherCondCloudy' | 'drv_weatherCondFog' | 'drv_weatherCondRain' | 'drv_weatherCondSnow' | 'drv_weatherCondThunderstorm';
} {
  if (code >= 95) return { icon: '⛈️', labelKey: 'drv_weatherCondThunderstorm' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: '❄️', labelKey: 'drv_weatherCondSnow' };
  if ([45, 48].includes(code)) return { icon: '🌫️', labelKey: 'drv_weatherCondFog' };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { icon: isNight ? '🌧️' : '🌦️', labelKey: 'drv_weatherCondRain' };
  if ([1, 2, 3].includes(code)) return { icon: isNight ? '☁️' : '⛅', labelKey: 'drv_weatherCondCloudy' };
  return { icon: isNight ? '🌙' : '☀️', labelKey: 'drv_weatherCondClear' };
}

type UserType = 'admin' | 'customer';

type CustomerUser = {
  id: number;
  fullName: string;
  email: string;
  userType: UserType;
  status: string;
  businessType: string;
  activePlan: string;
  dob: string;
  planAmount: number;
  billingCycle: string;
  subscriptionStatus: string;
  startDate: string;
  endDate: string;
  enabledFeatures?: string[];
};

type SubscriptionPlan = {
  id: number;
  name: string;
  monthlyAmount: number;
  annualAmount: number;
  description: string;
  features: string[];
  popular: boolean;
};

type LedgerTransaction = {
  id: string;
  type: 'in' | 'out'; // 'in' = Received (Credit), 'out' = Spent (Debit)
  amount: number;
  party: string;
  category: string;
  paymentMode: 'Cash' | 'UPI' | 'Card' | 'Credit';
  date: string;
  time: string;
};

type CustomerDue = {
  id: string;
  name: string;
  phone: string;
  amount: number;
  type: 'to_collect' | 'to_pay';
  lastUpdated: string;
};

// Phase 2: Business-Specific Types
type DriverTrip = {
  id: string;
  tripDate: string;
  time: string;
  tripTimeMs: number;
  startKm: number;
  endKm: number;
  distanceKm: number;
  fare: number;
  paymentMode: 'Cash' | 'UPI';
  route: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
};

type FuelLog = {
  id: string;
  date: string;
  fuelTimeMs: number;
  fuelType: 'CNG' | 'Petrol' | 'Diesel';
  quantity: number;
  rate: number;
  totalCost: number;
  odometer: number;
  station: string;
};

type VehicleDetails = {
  regNumber: string;
  model: string;
  fuelType: string;
  insuranceExpiry: string;
  fitnessExpiry: string;
  pucExpiry: string;
  totalKm: number;
  regDate?: string;
};

type InventoryItem = {
  id: string;
  name: string;
  category: string;
  stockQty: number;
  unit: string;
  sellingPrice: number;
  costPrice: number;
  lowStockThreshold: number;
};

type ServiceJob = {
  id: string;
  jobNumber: string;
  vehicleNumber: string;
  vehicleModel?: string;
  customerName: string;
  phone: string;
  complaint: string;
  estimatedAmount: number;
  status: 'Pending' | 'In Progress' | 'Ready' | 'Delivered';
  deliveryDate: string;
};

type CollectionRecord = {
  id: string;
  customerName: string;
  accountNumber: string;
  amountCollected: number;
  paymentMode: 'Cash' | 'UPI';
  timestamp: string;
  receiptNumber: string;
  area?: string;
  status?: string;
};

const CANDIDATE_API_URLS: string[] = (() => {
  const configured = (process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/$/, '');
  const urls: string[] = [];

  if (Platform.OS === 'android') {
    // 10.0.2.2 is standard Android emulator loopback to host PC
    urls.push('http://10.0.2.2:5000');
    // Local LAN IP for real devices connected to the same Wi-Fi
    urls.push('http://192.168.31.29:5000');
  }

  if (configured) {
    urls.push(configured);
    if (configured.includes('localhost')) {
      urls.push(configured.replace('localhost', '10.0.2.2'));
      urls.push(configured.replace('localhost', '192.168.31.29'));
    }
  }

  urls.push('http://localhost:5000');
  urls.push('http://127.0.0.1:5000');

  return Array.from(new Set(urls));
})();

let activeApiBase = CANDIDATE_API_URLS[0];

async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const tryUrl = (base: string) => {
    const fullUrl = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    return fetch(fullUrl, options);
  };

  try {
    const res = await tryUrl(activeApiBase);
    return res;
  } catch (initialErr) {
    for (const candidate of CANDIDATE_API_URLS) {
      if (candidate === activeApiBase) continue;
      try {
        const res = await tryUrl(candidate);
        activeApiBase = candidate;
        return res;
      } catch {
        // try next candidate
      }
    }
    throw initialErr;
  }
}

// Initial default transactions for a realistic customer ledger
const INITIAL_TRANSACTIONS: LedgerTransaction[] = [
  {
    id: 'tx-1',
    type: 'in',
    amount: 350,
    party: 'Rajesh Kumar (Trip Fare)',
    category: 'Daily Ride',
    paymentMode: 'UPI',
    date: 'Today',
    time: '02:45 PM',
  },
  {
    id: 'tx-2',
    type: 'out',
    amount: 120,
    party: 'HP Fuel Station',
    category: 'Fuel / Gas',
    paymentMode: 'Cash',
    date: 'Today',
    time: '01:15 PM',
  },
  {
    id: 'tx-3',
    type: 'in',
    amount: 480,
    party: 'Anil Store (Market Delivery)',
    category: 'Commercial Delivery',
    paymentMode: 'Cash',
    date: 'Today',
    time: '11:20 AM',
  },
  {
    id: 'tx-4',
    type: 'out',
    amount: 60,
    party: 'Chai & Snacks',
    category: 'Daily Expenses',
    paymentMode: 'UPI',
    date: 'Today',
    time: '09:30 AM',
  },
  {
    id: 'tx-5',
    type: 'in',
    amount: 600,
    party: 'Suresh Verma (Pending Bill)',
    category: 'Khata Settlement',
    paymentMode: 'UPI',
    date: 'Yesterday',
    time: '06:10 PM',
  },
];

const INITIAL_DUES: CustomerDue[] = [
  {
    id: 'due-1',
    name: 'Vikram Singh',
    phone: '+91 98765 43210',
    amount: 450,
    type: 'to_collect',
    lastUpdated: 'Yesterday',
  },
  {
    id: 'due-2',
    name: 'Sharma Sweets',
    phone: '+91 98111 22334',
    amount: 820,
    type: 'to_collect',
    lastUpdated: '2 days ago',
  },
  {
    id: 'due-3',
    name: 'Auto Garage (Repairs)',
    phone: '+91 97234 56789',
    amount: 350,
    type: 'to_pay',
    lastUpdated: '3 days ago',
  },
];

const INITIAL_VEHICLE: VehicleDetails = {
  regNumber: 'KA 05 MN 4821',
  model: 'Bajaj Compact RE 4S',
  fuelType: 'CNG',
  insuranceExpiry: '2026-11-15',
  fitnessExpiry: '2027-02-22',
  pucExpiry: '2026-10-10',
  totalKm: 48250,
  regDate: '2023-04-10',
};

const INITIAL_INVENTORY: InventoryItem[] = [
  { id: 'inv-1', name: 'Fresh Tomatoes', category: 'Vegetable', stockQty: 45, unit: 'kg', sellingPrice: 35, costPrice: 22, lowStockThreshold: 10 },
  { id: 'inv-2', name: 'Alphonso Mangoes', category: 'Fruit', stockQty: 18, unit: 'kg', sellingPrice: 140, costPrice: 95, lowStockThreshold: 8 },
  { id: 'inv-3', name: 'Potatoes (Grade A)', category: 'Vegetable', stockQty: 80, unit: 'kg', sellingPrice: 28, costPrice: 18, lowStockThreshold: 20 },
];

const INITIAL_SERVICE_JOBS: ServiceJob[] = [
  { id: 'job-1', jobNumber: 'JC-1082', vehicleNumber: 'KA 03 HB 2910', vehicleModel: 'Bajaj Pulsar 150', customerName: 'Ramesh Kumar', phone: '+91 98450 11223', complaint: 'Brake pad replacement & oil change', estimatedAmount: 1450, status: 'In Progress', deliveryDate: 'Today, 05:00 PM' },
  { id: 'job-2', jobNumber: 'JC-1083', vehicleNumber: 'KA 01 EK 7744', vehicleModel: 'Hero Splendor Plus', customerName: 'Sunil Rao', phone: '+91 99120 44556', complaint: 'Clutch plate slipping & tuning', estimatedAmount: 2200, status: 'Ready', deliveryDate: 'Today, 03:30 PM' },
];

const INITIAL_COLLECTIONS: CollectionRecord[] = [
  { id: 'col-1', customerName: 'Anil Kirana Store', accountNumber: 'ACC-4491', amountCollected: 1200, paymentMode: 'UPI', timestamp: 'Today, 11:20 AM', receiptNumber: 'REC-901', area: 'Gandhi Bazaar', status: 'Verified' },
  { id: 'col-2', customerName: 'City Bakery', accountNumber: 'ACC-3820', amountCollected: 850, paymentMode: 'Cash', timestamp: 'Today, 09:45 AM', receiptNumber: 'REC-902', area: 'Commercial Street', status: 'Verified' },
];

const SEED_CUSTOMERS = [
  { name: 'Vikram Singh', phone: '+91 98765 43210', area: 'Market Yard', expected: 1000, due: 12000, status: 'COLLECTED', receipt: 'REC-20260907-0001', mode: 'CASH', updated: 'Today' },
  { name: 'Sharma Sweets', phone: '+91 98111 22334', area: 'Station Road', expected: 1200, due: 15000, status: 'NOT_AVAILABLE', updated: 'Not Available' },
  { name: 'Auto Garage (Repairs)', phone: '+91 97234 56789', area: 'Industrial Area', expected: 850, due: 8500, status: 'RESCHEDULED', updated: 'Rescheduled' },
  { name: 'Patel Provision Store', phone: '+91 98220 11223', area: 'Commercial St', expected: 1500, due: 18000, status: 'PENDING', updated: 'Yesterday' },
  { name: 'Rajesh Electronics', phone: '+91 98330 22334', area: 'Cross Rd', expected: 2000, due: 24000, status: 'PENDING', updated: '2 days ago' },
  { name: 'Sri Sai Medicals', phone: '+91 98440 33445', area: 'Gandhi Bazaar', expected: 1100, due: 13000, status: 'PENDING', updated: '3 days ago' },
  { name: 'Gupta General Store', phone: '+91 98550 44556', area: 'Ring Road', expected: 950, due: 9500, status: 'PENDING', updated: 'Yesterday' },
  { name: 'Anand Hardware', phone: '+91 98660 55667', area: 'City Center', expected: 1300, due: 14000, status: 'PENDING', updated: '2 days ago' },
  { name: 'Verma Dairy Farm', phone: '+91 98770 66778', area: 'Subhash Nagar', expected: 750, due: 7500, status: 'PENDING', updated: 'Yesterday' },
  { name: 'Modern Cloth Emporium', phone: '+91 98880 77889', area: 'MG Road', expected: 2200, due: 26000, status: 'PENDING', updated: '3 days ago' },
];

const INITIAL_COLLECTION_SCHEDULE: any[] = [];

function formatDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayDateString(): string {
  return formatDateString(new Date());
}

function getYesterdayDateString(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return formatDateString(yesterday);
}

// Builds an SVG path for one pie-chart wedge, from startAngle to endAngle (degrees, 0 = top,
// clockwise), centered at (cx, cy) with radius r.
function describePieSlice(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const start = { x: cx + r * Math.cos(toRad(endAngle)), y: cy + r * Math.sin(toRad(endAngle)) };
  const end = { x: cx + r * Math.cos(toRad(startAngle)), y: cy + r * Math.sin(toRad(startAngle)) };
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

const PIE_CHART_PALETTE = ['#EF4444', '#F97316', '#EAB308', '#8B5CF6', '#3B82F6', '#10B981', '#EC4899', '#6366F1'];

// Auto-logout after this long with no interaction (foreground idle) or this long
// backgrounded (app switched away / screen locked), whichever happens first.
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

// PIN login: a device-local quick-unlock shortcut, not a separate server-side auth
// method - the PIN just gates re-using the same email+DOB the device already proved
// once, stored encrypted via the OS keystore (expo-secure-store), never in plain
// AsyncStorage. Logging out of the app does NOT clear this - only "Disable PIN
// Login" in Profile does - so quick re-entry survives normal logout/app restarts.
const PIN_STORE_KEYS = {
  pin: 'bizpilot_pin_code',
  email: 'bizpilot_pin_email',
  dob: 'bizpilot_pin_dob',
  name: 'bizpilot_pin_name',
};
const PIN_SETUP_DECLINED_KEY = 'bizpilot_pin_setup_declined';


function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <CustomerAppContent />
    </SafeAreaProvider>
  );
}

function CustomerAppContent() {
  const insets = useSafeAreaInsets();
  const isDarkMode = useColorScheme() === 'dark';
  const [user, setUser] = useState<CustomerUser | null>(null);

  // Welcome header entrance animation
  const headerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (user) {
      headerAnim.setValue(0);
      Animated.timing(headerAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [!!user]);

  // Language / Localization (English / Hindi / Marathi)
  const [language, setLanguage] = useState<Language>('en');
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const t = (key: TranslationKey, vars?: Record<string, string | number>) => translate(language, key, vars);

  useEffect(() => {
    AsyncStorage.getItem('appLanguage').then(saved => {
      if (saved === 'en' || saved === 'hi' || saved === 'mr') {
        setLanguage(saved);
      }
    }).catch(() => {});
  }, []);

  function handleSelectLanguage(lang: Language) {
    setLanguage(lang);
    setShowLanguageModal(false);
    AsyncStorage.setItem('appLanguage', lang).catch(() => {});
  }

  function handleLogout() {
    setUser(null);
    setEmail('');
    setDob('');
    setErrorMessage('');
    setAdminNotice(null);
  }

  // ---- Session timeout: auto-logout after SESSION_TIMEOUT_MS of either foreground
  // idle (no touch anywhere in the app) or being backgrounded (app switched away /
  // screen locked). Background duration is checked against a timestamp on resume
  // rather than relying on a JS timer, since timers are paused/throttled while the
  // app isn't in the foreground and can't be trusted to fire on schedule. ----
  const lastActivityRef = useRef(Date.now());
  const backgroundedAtRef = useRef<number | null>(null);

  function registerActivity() {
    lastActivityRef.current = Date.now();
  }

  function performSessionTimeout() {
    handleLogout();
    Alert.alert(t('session_timeoutTitle'), t('session_timeoutMessage'));
  }

  useEffect(() => {
    if (!user) return;
    registerActivity();
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > SESSION_TIMEOUT_MS) {
        performSessionTimeout();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [user?.id]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundedAtRef.current = Date.now();
      } else if (nextState === 'active') {
        if (user && backgroundedAtRef.current && Date.now() - backgroundedAtRef.current > SESSION_TIMEOUT_MS) {
          performSessionTimeout();
        } else {
          registerActivity();
        }
        backgroundedAtRef.current = null;
      }
    });
    return () => subscription.remove();
  }, [user?.id]);

  // Login form state
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [adminNotice, setAdminNotice] = useState<string | null>(null);
  const lastLoginCredentialsRef = useRef<{ email: string; dob: string; fullName: string } | null>(null);

  // PIN login (device-local quick-unlock) state
  const [pinLoginAvailable, setPinLoginAvailable] = useState(false);
  const [showPinScreen, setShowPinScreen] = useState(false);
  const [pinLoginName, setPinLoginName] = useState('');
  const [pinLoginEmail, setPinLoginEmail] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinUnlocking, setPinUnlocking] = useState(false);
  const [showSetupPinModal, setShowSetupPinModal] = useState(false);
  const [setupPinStep, setSetupPinStep] = useState<'enter' | 'confirm'>('enter');
  const [setupPinValue, setSetupPinValue] = useState('');
  const [setupPinConfirmValue, setSetupPinConfirmValue] = useState('');
  const [setupPinError, setSetupPinError] = useState('');
  const [setupPinSaving, setSetupPinSaving] = useState(false);

  useEffect(() => {
    // Shown on the login screen before anyone is signed in, so this is intentionally
    // device-wide: any stored PIN is worth offering, regardless of which account it
    // belongs to - the PIN itself determines who gets logged in once entered.
    SecureStore.getItemAsync(PIN_STORE_KEYS.pin).then(storedPin => {
      if (storedPin) {
        setPinLoginAvailable(true);
        setShowPinScreen(true);
        SecureStore.getItemAsync(PIN_STORE_KEYS.name).then(name => setPinLoginName(name || '')).catch(() => {});
        SecureStore.getItemAsync(PIN_STORE_KEYS.email).then(email => setPinLoginEmail(email || '')).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // Re-check ownership after every login: the device's stored PIN (if any) might
  // belong to a different account that previously used this same device/emulator,
  // so "PIN login enabled" for Profile/setup-prompt purposes must be scoped to the
  // email that's actually logged in right now, not just "a PIN exists somewhere".
  useEffect(() => {
    if (!user) return;
    SecureStore.getItemAsync(PIN_STORE_KEYS.email).then(storedEmail => {
      const ownedByThisUser = !!storedEmail && storedEmail.toLowerCase() === user.email.toLowerCase();
      setPinLoginAvailable(ownedByThisUser);
      if (!ownedByThisUser) setPinLoginName('');
    }).catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!user || pinLoginAvailable || !lastLoginCredentialsRef.current) return;
    AsyncStorage.getItem(PIN_SETUP_DECLINED_KEY).then(declined => {
      if (declined !== '1') {
        setSetupPinStep('enter');
        setSetupPinValue('');
        setSetupPinConfirmValue('');
        setSetupPinError('');
        setShowSetupPinModal(true);
      }
    }).catch(() => {});
  }, [user?.id, pinLoginAvailable]);

  async function handlePinSubmit() {
    if (pinInput.length < 4 || pinUnlocking) return;
    setPinUnlocking(true);
    setPinError('');
    try {
      const storedPin = await SecureStore.getItemAsync(PIN_STORE_KEYS.pin);
      if (storedPin !== pinInput) {
        setPinError(t('pin_incorrect'));
        setPinInput('');
        return;
      }
      const storedEmail = await SecureStore.getItemAsync(PIN_STORE_KEYS.email);
      const storedDob = await SecureStore.getItemAsync(PIN_STORE_KEYS.dob);
      if (!storedEmail || !storedDob) {
        setPinError(t('pin_setupExpired'));
        setShowPinScreen(false);
        setPinLoginAvailable(false);
        setPinLoginEmail('');
        return;
      }
      const ok = await handleLogin(storedEmail, storedDob);
      if (ok) {
        setShowPinScreen(false);
        setPinInput('');
      } else {
        setPinError(t('pin_loginFailed'));
        setPinInput('');
      }
    } finally {
      setPinUnlocking(false);
    }
  }

  function handleUseFullLoginInstead() {
    setShowPinScreen(false);
    setPinInput('');
    setPinError('');
  }

  async function handleSaveSetupPin() {
    if (setupPinStep === 'enter') {
      if (setupPinValue.length < 4) {
        setSetupPinError(t('pin_tooShort'));
        return;
      }
      setSetupPinError('');
      setSetupPinStep('confirm');
      return;
    }
    if (setupPinConfirmValue !== setupPinValue) {
      setSetupPinError(t('pin_mismatch'));
      setSetupPinConfirmValue('');
      return;
    }
    const creds = lastLoginCredentialsRef.current;
    if (!creds) {
      setShowSetupPinModal(false);
      return;
    }
    setSetupPinSaving(true);
    try {
      await SecureStore.setItemAsync(PIN_STORE_KEYS.pin, setupPinValue);
      await SecureStore.setItemAsync(PIN_STORE_KEYS.email, creds.email);
      await SecureStore.setItemAsync(PIN_STORE_KEYS.dob, creds.dob);
      await SecureStore.setItemAsync(PIN_STORE_KEYS.name, creds.fullName);
      setPinLoginAvailable(true);
      setPinLoginName(creds.fullName);
      setPinLoginEmail(creds.email);
      setShowSetupPinModal(false);
    } catch (e) {
      console.error('Error saving PIN:', e);
      setSetupPinError(t('pin_saveFailed'));
    } finally {
      setSetupPinSaving(false);
    }
  }

  function handleSkipSetupPin() {
    setShowSetupPinModal(false);
    AsyncStorage.setItem(PIN_SETUP_DECLINED_KEY, '1').catch(() => {});
  }

  async function handleDisablePinLogin() {
    await Promise.all([
      SecureStore.deleteItemAsync(PIN_STORE_KEYS.pin),
      SecureStore.deleteItemAsync(PIN_STORE_KEYS.email),
      SecureStore.deleteItemAsync(PIN_STORE_KEYS.dob),
      SecureStore.deleteItemAsync(PIN_STORE_KEYS.name),
    ]).catch(() => {});
    await AsyncStorage.removeItem(PIN_SETUP_DECLINED_KEY).catch(() => {});
    setPinLoginAvailable(false);
    setPinLoginName('');
    setPinLoginEmail('');
  }

  // Registration form state (mobile self-registration, writes to the same userdetails table
  // used by the admin dashboard's "Create customer" flow)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regDob, setRegDob] = useState('');
  const [regBusinessType, setRegBusinessType] = useState('');
  const [regPlan, setRegPlan] = useState('');
  const [regError, setRegError] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [businessTypes, setBusinessTypes] = useState<{ id: number; name: string; description: string }[]>([]);
  const [businessTypesLoading, setBusinessTypesLoading] = useState(false);
  const [showBusinessTypeDropdown, setShowBusinessTypeDropdown] = useState(false);
  const [showPlanDropdown, setShowPlanDropdown] = useState(false);

  // Customer Dashboard State
  const [activeTab, setActiveTab] = useState<string>('home');
  const [transactions, setTransactions] = useState<LedgerTransaction[]>(INITIAL_TRANSACTIONS);
  const [dues, setDues] = useState<CustomerDue[]>(INITIAL_DUES);
  const [availablePlans, setAvailablePlans] = useState<SubscriptionPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  // Business Specific State
  const [vehicle, setVehicle] = useState<VehicleDetails>(INITIAL_VEHICLE);
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [driverTripsHistory, setDriverTripsHistory] = useState<{ fare: number; paymentMode: 'Cash' | 'UPI'; tripTimeMs: number; route: string; locationName: string }[]>([]);
  const [selectedEarningsDay, setSelectedEarningsDay] = useState<number | null>(null);
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
  const [driverFuelHistory, setDriverFuelHistory] = useState<{ totalCost: number; fuelTimeMs: number }[]>([]);
  const [selectedFuelDay, setSelectedFuelDay] = useState<number | null>(null);
  const [routeSafetyAdvisory, setRouteSafetyAdvisory] = useState<{ severity: 'moderate' | 'high'; message: string } | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<{ icon: string; label: string; tempC: number } | null>(null);
  const [weatherUnavailableReason, setWeatherUnavailableReason] = useState<'permission' | 'error' | null>(null);
  const [navigateDestination, setNavigateDestination] = useState('');

  // Driver Reports tab (week / month / custom date-range history + charts)
  const [reportPeriod, setReportPeriod] = useState<'week' | 'month' | 'custom'>('week');
  const [reportCustomStart, setReportCustomStart] = useState(formatDateISO(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)));
  const [reportCustomEnd, setReportCustomEnd] = useState(formatDateISO(new Date()));
  const [reportStartCalendarMonth, setReportStartCalendarMonth] = useState(new Date());
  const [reportEndCalendarMonth, setReportEndCalendarMonth] = useState(new Date());
  const [showReportStartPicker, setShowReportStartPicker] = useState(false);
  const [showReportEndPicker, setShowReportEndPicker] = useState(false);
  const [reportTrips, setReportTrips] = useState<{ fare: number; paymentMode: 'Cash' | 'UPI'; tripTimeMs: number; route: string; locationName: string }[]>([]);
  const [reportFuelLogs, setReportFuelLogs] = useState<{ totalCost: number; fuelTimeMs: number; fuelType: string; station: string }[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [selectedReportEarningsDay, setSelectedReportEarningsDay] = useState<number | null>(null);
  const [selectedReportFuelDay, setSelectedReportFuelDay] = useState<number | null>(null);
  const [selectedReportPeakBucket, setSelectedReportPeakBucket] = useState<number | null>(null);
  const [reportExporting, setReportExporting] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryTransactions, setInventoryTransactions] = useState<any[]>([]);
  const [inventorySummary, setInventorySummary] = useState<any>(null);
  const [dcSelectedDate, setDcSelectedDate] = useState(formatDateISO(new Date()));
  const [showDcCalendarPicker, setShowDcCalendarPicker] = useState(false);
  const [dcCalendarMonth, setDcCalendarMonth] = useState(new Date());
  const [showPurchaseDetailModal, setShowPurchaseDetailModal] = useState(false);
  const [vendors, setVendors] = useState<any[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);
  const [showVendorPicker, setShowVendorPicker] = useState(false);
  const [showAddVendorModal, setShowAddVendorModal] = useState(false);
  const [newVendorName, setNewVendorName] = useState('');
  const [newVendorMobile, setNewVendorMobile] = useState('');
  const [newVendorEmail, setNewVendorEmail] = useState('');
  const [newVendorAddress, setNewVendorAddress] = useState('');
  const [addVendorLoading, setAddVendorLoading] = useState(false);
  const [showVendorLedgerModal, setShowVendorLedgerModal] = useState(false);
  const [vendorLedgerName, setVendorLedgerName] = useState('');
  const [vendorLedger, setVendorLedger] = useState<any>(null);
  const [vendorLedgerLoading, setVendorLedgerLoading] = useState(false);
  const [showPayVendorModal, setShowPayVendorModal] = useState(false);
  const [payVendorAmount, setPayVendorAmount] = useState('');
  const [payVendorMethod, setPayVendorMethod] = useState<'CASH' | 'UPI' | 'CREDIT'>('CASH');
  const [payVendorNote, setPayVendorNote] = useState('');
  const [payVendorLoading, setPayVendorLoading] = useState(false);

  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductCategory, setNewProductCategory] = useState('');
  const [newProductUnit, setNewProductUnit] = useState('kg');
  const [newProductStockQty, setNewProductStockQty] = useState('');
  const [newProductSellingPrice, setNewProductSellingPrice] = useState('');
  const [newProductCostPrice, setNewProductCostPrice] = useState('');
  const [newProductLowStock, setNewProductLowStock] = useState('');
  const [addProductLoading, setAddProductLoading] = useState(false);

  const [showRecordSaleModal, setShowRecordSaleModal] = useState(false);
  const [saleProductId, setSaleProductId] = useState('');
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [saleQuantity, setSaleQuantity] = useState('');
  const [saleAmount, setSaleAmount] = useState('');
  const [saleNote, setSaleNote] = useState('');
  const [saleType, setSaleType] = useState<'SALE' | 'PURCHASE' | 'WASTAGE'>('SALE');
  const [salePaymentMethod, setSalePaymentMethod] = useState<'CASH' | 'UPI' | 'CREDIT'>('CASH');
  const [recordSaleLoading, setRecordSaleLoading] = useState(false);
  const [salePaidNow, setSalePaidNow] = useState('');
  const [inventoryVoiceProcessing, setInventoryVoiceProcessing] = useState(false);
  const [inventoryVoiceTranscript, setInventoryVoiceTranscript] = useState('');
  const [inventoryVoiceConfirmed, setInventoryVoiceConfirmed] = useState(false);

  const [showEditStockModal, setShowEditStockModal] = useState(false);
  const [editStockProduct, setEditStockProduct] = useState<InventoryItem | null>(null);
  const [editStockAddQty, setEditStockAddQty] = useState('');
  const [editStockLoading, setEditStockLoading] = useState(false);
  const [inventoryInsights, setInventoryInsights] = useState<any>(null);
  const [restockSuggestions, setRestockSuggestions] = useState<any[]>([]);

  // Building Maintenance (Phase 1: Building / Floors / Flats / Members)
  const [myBuilding, setMyBuilding] = useState<any>(null);
  const [buildingLoading, setBuildingLoading] = useState(false);
  const [buildingFloors, setBuildingFloors] = useState<any[]>([]);
  const [buildingFlats, setBuildingFlats] = useState<any[]>([]);
  const [buildingMembers, setBuildingMembers] = useState<any[]>([]);
  const [flatFloorFilter, setFlatFloorFilter] = useState<string>('');
  const [flatStatusFilter, setFlatStatusFilter] = useState<string>('');
  const [memberSearchQuery, setMemberSearchQuery] = useState('');
  const [memberFlatFilter, setMemberFlatFilter] = useState<string>('');
  const [memberTypeFilter, setMemberTypeFilter] = useState<string>('');

  const [showBuildingFormModal, setShowBuildingFormModal] = useState(false);
  const [bldName, setBldName] = useState('');
  const [bldCode, setBldCode] = useState('');
  const [bldAddress, setBldAddress] = useState('');
  const [bldArea, setBldArea] = useState('');
  const [bldCity, setBldCity] = useState('');
  const [bldState, setBldState] = useState('');
  const [bldPincode, setBldPincode] = useState('');
  const [bldNumFloors, setBldNumFloors] = useState('');
  const [bldNumFlats, setBldNumFlats] = useState('');
  const [bldBuildingType, setBldBuildingType] = useState('Residential');
  const [bldConstructionYear, setBldConstructionYear] = useState('');
  const [bldContactNumber, setBldContactNumber] = useState('');
  const [bldEmergencyContact, setBldEmergencyContact] = useState('');
  const [bldDescription, setBldDescription] = useState('');
  const [bldNotes, setBldNotes] = useState('');
  const [bldSaving, setBldSaving] = useState(false);

  const [showFloorModal, setShowFloorModal] = useState(false);
  const [floorNumber, setFloorNumber] = useState('');
  const [floorName, setFloorName] = useState('');
  const [floorNumFlats, setFloorNumFlats] = useState('');
  const [floorSaving, setFloorSaving] = useState(false);

  const [showFlatModal, setShowFlatModal] = useState(false);
  const [editingFlat, setEditingFlat] = useState<any>(null);
  const [flatFloorId, setFlatFloorId] = useState('');
  const [flatNumber, setFlatNumber] = useState('');
  const [flatType, setFlatType] = useState('');
  const [flatArea, setFlatArea] = useState('');
  const [flatOccupancyStatus, setFlatOccupancyStatus] = useState('Vacant');
  const [flatOwnerName, setFlatOwnerName] = useState('');
  const [flatTenantName, setFlatTenantName] = useState('');
  const [flatPrimaryMobile, setFlatPrimaryMobile] = useState('');
  const [flatParkingSlot, setFlatParkingSlot] = useState('');
  const [flatMaintenanceAmount, setFlatMaintenanceAmount] = useState('');
  const [flatSaving, setFlatSaving] = useState(false);
  const [showFlatFloorPicker, setShowFlatFloorPicker] = useState(false);

  const [showMemberModal, setShowMemberModal] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [memberFlatId, setMemberFlatId] = useState('');
  const [memberFullName, setMemberFullName] = useState('');
  const [memberMobileNumber, setMemberMobileNumber] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberType, setMemberType] = useState('Owner');
  const [memberEmergencyContact, setMemberEmergencyContact] = useState('');
  const [memberVehicleNumber, setMemberVehicleNumber] = useState('');
  const [memberSaving, setMemberSaving] = useState(false);
  const [showMemberPassbookModal, setShowMemberPassbookModal] = useState(false);
  const [passbookMember, setPassbookMember] = useState<any>(null);
  const [memberPassbookBills, setMemberPassbookBills] = useState<any[]>([]);
  const [memberPassbookLoading, setMemberPassbookLoading] = useState(false);
  const [showMemberFlatPicker, setShowMemberFlatPicker] = useState(false);

  // Building Maintenance Phase 2: Maintenance Config / Bills / Payments / Receipts
  const [maintenanceView, setMaintenanceView] = useState<'bills' | 'payments'>('bills');
  const [maintenanceConfig, setMaintenanceConfig] = useState<any>(null);
  const [buildingBills, setBuildingBills] = useState<any[]>([]);
  const [billsSummary, setBillsSummary] = useState<any>(null);
  const [buildingPayments, setBuildingPayments] = useState<any[]>([]);
  const [billMonthFilter, setBillMonthFilter] = useState('');
  const [showBillMonthPicker, setShowBillMonthPicker] = useState(false);
  const [billMonthPickerYear, setBillMonthPickerYear] = useState(new Date().getFullYear());
  const [billStatusFilter, setBillStatusFilter] = useState('');
  const [paymentFlatFilter, setPaymentFlatFilter] = useState('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('');
  const [showPaymentFlatDropdown, setShowPaymentFlatDropdown] = useState(false);
  const [showPaymentMethodDropdown, setShowPaymentMethodDropdown] = useState(false);

  const [showConfigModal, setShowConfigModal] = useState(false);
  const [cfgWater, setCfgWater] = useState('');
  const [cfgParking, setCfgParking] = useState('');
  const [cfgElectricity, setCfgElectricity] = useState('');
  const [cfgSecurity, setCfgSecurity] = useState('');
  const [cfgCleaning, setCfgCleaning] = useState('');
  const [cfgLift, setCfgLift] = useState('');
  const [cfgOther, setCfgOther] = useState('');
  const [cfgLateFee, setCfgLateFee] = useState('');
  const [cfgDiscount, setCfgDiscount] = useState('');
  const [cfgDueDay, setCfgDueDay] = useState('10');
  const [cfgSaving, setCfgSaving] = useState(false);

  const [showGenerateBillsModal, setShowGenerateBillsModal] = useState(false);
  const [genBillingMonth, setGenBillingMonth] = useState('');
  const [genTargetMode, setGenTargetMode] = useState<'entire' | 'specific'>('entire');
  const [genSelectedFlatIds, setGenSelectedFlatIds] = useState<string[]>([]);
  const [genSaving, setGenSaving] = useState(false);

  const [showRecordPaymentModal, setShowRecordPaymentModal] = useState(false);
  const [payingBill, setPayingBill] = useState<any>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState('');
  const [payMethod, setPayMethod] = useState('Cash');
  const [payTransactionRef, setPayTransactionRef] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [activeReceipt, setActiveReceipt] = useState<any>(null);

  // Building Maintenance Phase 3: Staff / Vendors / Complaints
  const [buildingStaffList, setBuildingStaffList] = useState<any[]>([]);
  const [buildingVendorsList, setBuildingVendorsList] = useState<any[]>([]);
  const [buildingComplaints, setBuildingComplaints] = useState<any[]>([]);
  const [complaintsOpenCount, setComplaintsOpenCount] = useState(0);
  const [staffJobTypeFilter, setStaffJobTypeFilter] = useState('');
  const [vendorServiceTypeFilter, setVendorServiceTypeFilter] = useState('');
  const [complaintStatusFilter, setComplaintStatusFilter] = useState('');
  const [complaintCategoryFilter, setComplaintCategoryFilter] = useState('');
  const [showComplaintStatusDropdown, setShowComplaintStatusDropdown] = useState(false);
  const [showComplaintCategoryDropdown, setShowComplaintCategoryDropdown] = useState(false);

  const [showStaffModal, setShowStaffModal] = useState(false);
  const [editingStaff, setEditingStaff] = useState<any>(null);
  const [staffFullName, setStaffFullName] = useState('');
  const [staffMobile, setStaffMobile] = useState('');
  const [staffJobType, setStaffJobType] = useState('Security Guard');
  const [showStaffJobTypeDropdown, setShowStaffJobTypeDropdown] = useState(false);
  const [staffJoiningDate, setStaffJoiningDate] = useState('');
  const [staffSalary, setStaffSalary] = useState('');
  const [staffAddress, setStaffAddress] = useState('');
  const [staffEmergencyContact, setStaffEmergencyContact] = useState('');
  const [staffNotes, setStaffNotes] = useState('');
  const [staffSaving, setStaffSaving] = useState(false);

  const [showVendorModal, setShowVendorModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<any>(null);
  const [vendorName, setVendorName] = useState('');
  const [vendorServiceType, setVendorServiceType] = useState('Electrician');
  const [showVendorServiceTypeDropdown, setShowVendorServiceTypeDropdown] = useState(false);
  const [vendorContactPerson, setVendorContactPerson] = useState('');
  const [vendorMobile, setVendorMobile] = useState('');
  const [vendorEmail, setVendorEmail] = useState('');
  const [vendorAddress, setVendorAddress] = useState('');
  const [vendorContractStart, setVendorContractStart] = useState('');
  const [vendorContractEnd, setVendorContractEnd] = useState('');
  const [vendorNotes, setVendorNotes] = useState('');
  const [vendorSaving, setVendorSaving] = useState(false);

  const [showComplaintModal, setShowComplaintModal] = useState(false);
  const [editingComplaint, setEditingComplaint] = useState<any>(null);
  const [complaintCategory, setComplaintCategory] = useState('Plumbing');
  const [complaintTitle, setComplaintTitle] = useState('');
  const [complaintDescription, setComplaintDescription] = useState('');
  const [complaintPriority, setComplaintPriority] = useState('Medium');
  const [complaintAssignedStaffId, setComplaintAssignedStaffId] = useState('');
  const [complaintAssignedVendorId, setComplaintAssignedVendorId] = useState('');
  const [complaintStatus, setComplaintStatus] = useState('New');
  const [complaintResolutionNotes, setComplaintResolutionNotes] = useState('');
  const [complaintSaving, setComplaintSaving] = useState(false);
  const [showComplaintStaffPicker, setShowComplaintStaffPicker] = useState(false);
  const [showComplaintVendorPicker, setShowComplaintVendorPicker] = useState(false);

  // Auto Driver: own UPI QR code
  const [driverQr, setDriverQr] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrSaving, setQrSaving] = useState(false);
  const [showQuickPaymentModal, setShowQuickPaymentModal] = useState(false);
  const [quickPaymentMode, setQuickPaymentMode] = useState<'Cash' | 'UPI'>('Cash');
  const [quickPaymentAmount, setQuickPaymentAmount] = useState('');
  const [quickPaymentSaving, setQuickPaymentSaving] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceConfirmed, setVoiceConfirmed] = useState(false);
  const voiceRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const voiceRecorderState = useAudioRecorderState(voiceRecorder, 200);
  const [smsAutoRecord, setSmsAutoRecord] = useState(false);
  const [smsStatus, setSmsStatus] = useState('');
  const smsScanning = React.useRef(false);

  // Proactive AI Daily Summary (shown as a dismissible banner)
  const [dailySummaryText, setDailySummaryText] = useState<string | null>(null);
  const [dailySummaryDate, setDailySummaryDate] = useState<string | null>(null);
  const [showDailySummary, setShowDailySummary] = useState(false);

  // AI Assistant (Chatbot) State
  const [showChatModal, setShowChatModal] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'bot'; text: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatVoiceProcessing, setChatVoiceProcessing] = useState(false);
  const [serviceJobs] = useState<ServiceJob[]>(INITIAL_SERVICE_JOBS);
  const [collections] = useState<CollectionRecord[]>(INITIAL_COLLECTIONS);

  // Business Specific State: Field Collections (Real-time Backend Integration)
  const [collectionSchedule, setCollectionSchedule] = useState<any[]>(INITIAL_COLLECTION_SCHEDULE);
  const [collectionSummary, setCollectionSummary] = useState<any>(null);
  const [collectionFilter, setCollectionFilter] = useState<'all' | 'pending' | 'collected' | 'missed'>('all');
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [isDayClosed, setIsDayClosed] = useState(false);

  // Search results across ALL of this collector's customers (not just today's scheduled beat),
  // so searching finds previously-collected/older customers too, not only today's records.
  const [allCustomerSearchResults, setAllCustomerSearchResults] = useState<any[]>([]);
  const [searchingAllCustomers, setSearchingAllCustomers] = useState(false);

  // Collection Modals
  const [showCollectModal, setShowCollectModal] = useState(false);
  const [selectedCollectItem, setSelectedCollectItem] = useState<any>(null);
  const [collectAmount, setCollectAmount] = useState('');
  const [collectMethod, setCollectMethod] = useState<'Cash' | 'UPI' | 'Bank Transfer'>('Cash');
  const [collectRef, setCollectRef] = useState('');
  const [collectNotes, setCollectNotes] = useState('');
  const [collectLoading, setCollectLoading] = useState(false);

  const [showStatusModal, setShowStatusModal] = useState(false);
  const [selectedStatusItem, setSelectedStatusItem] = useState<any>(null);
  const [statusChoice, setStatusChoice] = useState<'NOT_AVAILABLE' | 'RESCHEDULED' | 'REFUSED' | 'MISSED'>('NOT_AVAILABLE');
  const [statusReason, setStatusReason] = useState('');
  const [followupDate, setFollowupDate] = useState('2026-09-08');
  const [statusLoading, setStatusLoading] = useState(false);

  const [receiptData, setReceiptData] = useState<any>(null);
  const [showClosingModal, setShowClosingModal] = useState(false);
  const [physicalCashCount, setPhysicalCashCount] = useState('');
  const [closingNotes, setClosingNotes] = useState('');
  const [closingLoading, setClosingLoading] = useState(false);
  const [showAgentReportsModal, setShowAgentReportsModal] = useState(false);

  function handleShareReport() {
    const target = collectionSummary?.totalExpectedAmount ?? collectionSummary?.totalExpected ?? 56950;
    const collected = collectionSummary?.totalCollectedAmount ?? 3000;
    const remaining = collectionSummary?.totalRemainingAmount ?? collectionSummary?.totalPendingAmount ?? 53950;
    const rate = collectionSummary?.collectionRate ?? 5.3;
    const cash = collectionSummary?.cashAmount ?? 3000;
    const upi = collectionSummary?.upiAmount ?? 0;
    const bank = collectionSummary?.bankAmount ?? 0;

    const message = `📊 *BizPilot Field Collection Report*\n` +
      `👤 *Agent:* ${user?.fullName || 'Riya N'}\n` +
      `📅 *Date:* 07-09-2026\n` +
      `---------------------------\n` +
      `🎯 *Target Expected:* ₹${Number(target).toLocaleString()}\n` +
      `✅ *Actually Collected:* ₹${Number(collected).toLocaleString()}\n` +
      `⏳ *Pending Balance:* ₹${Number(remaining).toLocaleString()}\n` +
      `📈 *Recovery Rate:* ${rate}%\n` +
      `---------------------------\n` +
      `💵 *Cash to Handover:* ₹${Number(cash).toLocaleString()}\n` +
      `📱 *UPI / QR:* ₹${Number(upi).toLocaleString()}\n` +
      `🏦 *Bank Transfer:* ₹${Number(bank).toLocaleString()}\n` +
      `👥 *Customers Visited:* ${collectionSchedule.length}\n` +
      `🔒 *Status:* ${isDayClosed ? 'CLOSED & RECONCILED' : 'COLLECTION IN PROGRESS'}\n` +
      `---------------------------\n` +
      `BizPilot Financial Systems`;

    Share.share({ message });
  }

  async function loadCollectionData() {
    if (!user) return;
    try {
      const collectorId = user.id || 36;
      const [sumRes, schedRes] = await Promise.all([
        apiFetch(`/api/collection/daily-summary?date=${getTodayDateString()}&collector_id=${collectorId}`),
        apiFetch(`/api/collection/today?date=${getTodayDateString()}&collector_id=${collectorId}`),
      ]);
      if (sumRes.ok) {
        const sumData = await sumRes.json();
        const s = sumData.summary || sumData;
        if (s) {
          setCollectionSummary(s);
          setIsDayClosed(s.closingStatus === 'CLOSED' || s.isClosed === true);
        }
      }
      if (schedRes.ok) {
        const schedData = await schedRes.json();
        const list = schedData.customers || schedData.schedule || [];
        setCollectionSchedule(list);
        const s = schedData.summary;
        if (s) {
          setCollectionSummary(s);
          setIsDayClosed(s.closingStatus === 'CLOSED' || s.isClosed === true);
        }
      }
    } catch (e) {
      console.error('Error loading collection schedule:', e);
    }
  }

  useEffect(() => {
    if (user) {
      loadCollectionData();
    }
  }, [user?.id, activeTab]);

  async function loadInventoryProducts() {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/inventory/products?owner_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setInventory(data.products || []);
      }
    } catch (e) {
      console.error('Error loading inventory products:', e);
    }
  }

  async function loadInventoryTransactions(dateISO = dcSelectedDate) {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/inventory/transactions?owner_id=${user.id}&period=daily&date=${dateISO}`);
      if (res.ok) {
        const data = await res.json();
        setInventoryTransactions(data.transactions || []);
        setInventorySummary(data.summary || null);
      }
    } catch (e) {
      console.error('Error loading inventory transactions:', e);
    }
  }

  async function loadInventoryData() {
    if (!user) return;
    setInventoryLoading(true);
    await Promise.all([loadInventoryProducts(), loadInventoryTransactions()]);
    setInventoryLoading(false);
  }

  async function loadInventoryInsights() {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/inventory/insights?owner_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setInventoryInsights(data);
      }
    } catch (e) {
      console.error('Error loading inventory insights:', e);
    }
  }

  async function loadRestockSuggestions() {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/inventory/restock-suggestions?owner_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setRestockSuggestions(data.suggestions || []);
      }
    } catch (e) {
      console.error('Error loading restock suggestions:', e);
    }
  }

  // --- Building Maintenance (Phase 1) ---

  async function loadMyBuilding() {
    if (!user?.id) return null;
    setBuildingLoading(true);
    try {
      const res = await apiFetch(`/api/building/buildings?owner_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        const building = (data.buildings || [])[0] || null;
        setMyBuilding(building);
        return building;
      }
    } catch (e) {
      console.error('Error loading building:', e);
    } finally {
      setBuildingLoading(false);
    }
    return null;
  }

  async function loadBuildingFloors(buildingId: string) {
    if (!user?.id || !buildingId) return;
    try {
      const res = await apiFetch(`/api/building/buildings/${buildingId}/floors?owner_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setBuildingFloors(data.floors || []);
      }
    } catch (e) {
      console.error('Error loading floors:', e);
    }
  }

  async function loadBuildingFlats(buildingId: string) {
    if (!user?.id || !buildingId) return;
    try {
      const params = new URLSearchParams({ owner_id: String(user.id) });
      if (flatFloorFilter) params.set('floor_id', flatFloorFilter);
      if (flatStatusFilter) params.set('occupancy_status', flatStatusFilter);
      const res = await apiFetch(`/api/building/buildings/${buildingId}/flats?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBuildingFlats(data.flats || []);
      }
    } catch (e) {
      console.error('Error loading flats:', e);
    }
  }

  async function loadBuildingMembers(buildingId: string) {
    if (!user?.id || !buildingId) return;
    try {
      const params = new URLSearchParams({ owner_id: String(user.id) });
      if (memberSearchQuery.trim()) params.set('search', memberSearchQuery.trim());
      if (memberFlatFilter) params.set('flat_id', memberFlatFilter);
      if (memberTypeFilter) params.set('member_type', memberTypeFilter);
      const res = await apiFetch(`/api/building/buildings/${buildingId}/members?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBuildingMembers(data.members || []);
      }
    } catch (e) {
      console.error('Error loading members:', e);
    }
  }

  useEffect(() => {
    if (user && isBuildingBusiness &&
      ['home', 'building_setup', 'building_floors', 'building_flats', 'building_members', 'building_maintenance',
        'building_complaints', 'building_staff', 'building_vendors'].includes(activeTab)) {
      (async () => {
        const building = myBuilding || (await loadMyBuilding());
        if (building) {
          if (activeTab === 'building_floors') loadBuildingFloors(building.id);
          if (activeTab === 'building_flats') { loadBuildingFloors(building.id); loadBuildingFlats(building.id); }
          if (activeTab === 'building_members') { loadBuildingFlats(building.id); loadBuildingMembers(building.id); }
          if (activeTab === 'building_maintenance') {
            loadBuildingFlats(building.id);
            loadMaintenanceConfig(building.id);
            loadBuildingBills(building.id);
            loadBuildingPayments(building.id);
          }
          if (activeTab === 'building_staff') loadBuildingStaff(building.id);
          if (activeTab === 'building_vendors') loadBuildingVendors(building.id);
          if (activeTab === 'building_complaints') {
            loadBuildingComplaints(building.id);
            loadBuildingStaff(building.id);
            loadBuildingVendors(building.id);
            loadBuildingFlats(building.id);
          }
          if (activeTab === 'home') {
            loadBuildingMembers(building.id);
            loadBuildingBills(building.id);
            loadBuildingPayments(building.id);
            loadBuildingComplaints(building.id);
          }
        }
      })();
    }
  }, [user?.id, activeTab]);

  useEffect(() => {
    if (myBuilding && activeTab === 'building_flats') loadBuildingFlats(myBuilding.id);
  }, [flatFloorFilter, flatStatusFilter]);

  useEffect(() => {
    if (myBuilding && activeTab === 'building_members') {
      const timer = setTimeout(() => loadBuildingMembers(myBuilding.id), 350);
      return () => clearTimeout(timer);
    }
  }, [memberSearchQuery, memberFlatFilter, memberTypeFilter]);

  useEffect(() => {
    if (myBuilding && activeTab === 'building_maintenance') loadBuildingBills(myBuilding.id);
  }, [billMonthFilter, billStatusFilter]);

  useEffect(() => {
    if (myBuilding && activeTab === 'building_maintenance') loadBuildingPayments(myBuilding.id);
  }, [paymentFlatFilter, paymentMethodFilter]);

  useEffect(() => {
    if (myBuilding && activeTab === 'building_staff') loadBuildingStaff(myBuilding.id);
  }, [staffJobTypeFilter]);

  useEffect(() => {
    if (myBuilding && activeTab === 'building_vendors') loadBuildingVendors(myBuilding.id);
  }, [vendorServiceTypeFilter]);

  useEffect(() => {
    if (myBuilding && activeTab === 'building_complaints') loadBuildingComplaints(myBuilding.id);
  }, [complaintStatusFilter, complaintCategoryFilter]);

  async function loadMaintenanceConfig(buildingId: string) {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/building/buildings/${buildingId}/maintenance-config?owner_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setMaintenanceConfig(data.config);
      }
    } catch (e) {
      console.error('Error loading maintenance config:', e);
    }
  }

  async function loadBuildingBills(buildingId: string) {
    if (!user?.id) return;
    try {
      const params = new URLSearchParams({ owner_id: String(user.id) });
      if (billMonthFilter) params.set('month', billMonthFilter);
      if (billStatusFilter) params.set('status', billStatusFilter);
      const res = await apiFetch(`/api/building/buildings/${buildingId}/bills?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBuildingBills(data.bills || []);
        setBillsSummary(data.summary || null);
      }
    } catch (e) {
      console.error('Error loading bills:', e);
    }
  }

  async function loadBuildingPayments(buildingId: string) {
    if (!user?.id) return;
    try {
      const params = new URLSearchParams({ owner_id: String(user.id) });
      if (paymentFlatFilter) params.set('flat_id', paymentFlatFilter);
      if (paymentMethodFilter) params.set('payment_method', paymentMethodFilter);
      const res = await apiFetch(`/api/building/buildings/${buildingId}/payments?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBuildingPayments(data.payments || []);
      }
    } catch (e) {
      console.error('Error loading payments:', e);
    }
  }

  function handleOpenConfigModal() {
    if (maintenanceConfig) {
      setCfgWater(String(maintenanceConfig.waterCharges || ''));
      setCfgParking(String(maintenanceConfig.parkingCharges || ''));
      setCfgElectricity(String(maintenanceConfig.commonElectricity || ''));
      setCfgSecurity(String(maintenanceConfig.securityCharges || ''));
      setCfgCleaning(String(maintenanceConfig.cleaningCharges || ''));
      setCfgLift(String(maintenanceConfig.liftCharges || ''));
      setCfgOther(String(maintenanceConfig.otherCharges || ''));
      setCfgLateFee(String(maintenanceConfig.latePaymentCharges || ''));
      setCfgDiscount(String(maintenanceConfig.discount || ''));
      setCfgDueDay(String(maintenanceConfig.dueDayOfMonth || 10));
    } else {
      setCfgWater(''); setCfgParking(''); setCfgElectricity(''); setCfgSecurity('');
      setCfgCleaning(''); setCfgLift(''); setCfgOther(''); setCfgLateFee('');
      setCfgDiscount(''); setCfgDueDay('10');
    }
    setShowConfigModal(true);
  }

  async function handleSaveConfig() {
    if (!myBuilding || !user?.id) return;
    setCfgSaving(true);
    try {
      const res = await apiFetch(`/api/building/buildings/${myBuilding.id}/maintenance-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          waterCharges: parseFloat(cfgWater) || 0,
          parkingCharges: parseFloat(cfgParking) || 0,
          commonElectricity: parseFloat(cfgElectricity) || 0,
          securityCharges: parseFloat(cfgSecurity) || 0,
          cleaningCharges: parseFloat(cfgCleaning) || 0,
          liftCharges: parseFloat(cfgLift) || 0,
          otherCharges: parseFloat(cfgOther) || 0,
          latePaymentCharges: parseFloat(cfgLateFee) || 0,
          discount: parseFloat(cfgDiscount) || 0,
          dueDayOfMonth: parseInt(cfgDueDay, 10) || 10,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMaintenanceConfig(data.config);
        setShowConfigModal(false);
        Alert.alert(t('common_success'), t('bld_configSaved'));
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setCfgSaving(false);
    }
  }

  function handleOpenGenerateBills() {
    const now = new Date();
    setGenBillingMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    setGenTargetMode('entire');
    setGenSelectedFlatIds([]);
    setShowGenerateBillsModal(true);
  }

  async function handleGenerateBills() {
    if (!myBuilding || !user?.id) return;
    if (!genBillingMonth.trim()) {
      Alert.alert(t('common_missingField'), t('bld_billingMonth'));
      return;
    }
    if (genTargetMode === 'specific' && genSelectedFlatIds.length === 0) {
      Alert.alert(t('common_missingField'), t('bld_specificFlats'));
      return;
    }
    setGenSaving(true);
    try {
      const res = await apiFetch(`/api/building/buildings/${myBuilding.id}/bills/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          billingMonth: genBillingMonth.trim(),
          entireBuilding: genTargetMode === 'entire',
          flatIds: genTargetMode === 'specific' ? genSelectedFlatIds : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowGenerateBillsModal(false);
        loadBuildingBills(myBuilding.id);
        Alert.alert(t('common_success'), t('bld_billsGeneratedMsg', { created: data.created, skipped: data.skipped }));
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setGenSaving(false);
    }
  }

  function handleOpenRecordPayment(bill: any) {
    setPayingBill(bill);
    setPayAmount(bill.balanceAmount > 0 ? String(bill.balanceAmount) : '');
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMethod('Cash');
    setPayTransactionRef('');
    setPayNotes('');
    setShowRecordPaymentModal(true);
  }

  async function handleSavePayment() {
    if (!payingBill || !user?.id || !myBuilding) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) {
      Alert.alert(t('common_missingField'), t('bld_missingBillAmount'));
      return;
    }
    setPaySaving(true);
    try {
      const res = await apiFetch(`/api/building/bills/${payingBill.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          amount,
          paymentDate: payDate.trim() || undefined,
          paymentMethod: payMethod,
          transactionReference: payTransactionRef.trim(),
          notes: payNotes.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowRecordPaymentModal(false);
        loadBuildingBills(myBuilding.id);
        loadBuildingPayments(myBuilding.id);
        Alert.alert(t('bld_paymentRecorded'), `₹${amount} — ${payingBill.flatNumber}`);

        const member = data.payment?.memberId
          ? buildingMembers.find((m: any) => String(m.id) === String(data.payment.memberId))
          : null;
        const mobile = member?.mobileNumber;
        const ownerName = data.payment?.memberName || member?.fullName;
        if (mobile && ownerName && data.bill?.billingMonth) {
          const monthLabel = new Date(`${data.bill.billingMonth}T00:00:00`).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
          });
          const message = buildMaintenancePaymentWhatsAppMessage({
            ownerName,
            flatNumber: data.bill.flatNumber,
            monthLabel,
            amount,
            buildingName: myBuilding.name,
          });
          sendBookingWhatsApp(mobile, message);
        }
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setPaySaving(false);
    }
  }

  async function handleViewMaintenanceReceipt(paymentId: string) {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/building/payments/${paymentId}/receipt?owner_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setActiveReceipt(data.receipt);
        setShowReceiptModal(true);
      }
    } catch (e) {
      console.error('Error loading receipt:', e);
    }
  }

  // --- Building Maintenance Phase 3: Staff / Vendors / Complaints ---

  async function loadBuildingStaff(buildingId: string) {
    if (!user?.id) return;
    try {
      const params = new URLSearchParams({ owner_id: String(user.id) });
      if (staffJobTypeFilter) params.set('job_type', staffJobTypeFilter);
      const res = await apiFetch(`/api/building/buildings/${buildingId}/staff?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBuildingStaffList(data.staff || []);
      }
    } catch (e) {
      console.error('Error loading staff:', e);
    }
  }

  async function loadBuildingVendors(buildingId: string) {
    if (!user?.id) return;
    try {
      const params = new URLSearchParams({ owner_id: String(user.id) });
      if (vendorServiceTypeFilter) params.set('service_type', vendorServiceTypeFilter);
      const res = await apiFetch(`/api/building/buildings/${buildingId}/vendors?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBuildingVendorsList(data.vendors || []);
      }
    } catch (e) {
      console.error('Error loading vendors:', e);
    }
  }

  async function loadBuildingComplaints(buildingId: string) {
    if (!user?.id) return;
    try {
      const params = new URLSearchParams({ owner_id: String(user.id) });
      if (complaintStatusFilter) params.set('status', complaintStatusFilter);
      if (complaintCategoryFilter) params.set('category', complaintCategoryFilter);
      const res = await apiFetch(`/api/building/buildings/${buildingId}/complaints?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBuildingComplaints(data.complaints || []);
        setComplaintsOpenCount(data.openCount || 0);
      }
    } catch (e) {
      console.error('Error loading complaints:', e);
    }
  }

  function handleOpenAddStaff() {
    setEditingStaff(null);
    setStaffFullName(''); setStaffMobile(''); setStaffJobType('Security Guard');
    setStaffJoiningDate(''); setStaffSalary(''); setStaffAddress('');
    setStaffEmergencyContact(''); setStaffNotes('');
    setShowStaffModal(true);
  }

  function handleOpenEditStaff(staff: any) {
    setEditingStaff(staff);
    setStaffFullName(staff.fullName || ''); setStaffMobile(staff.mobileNumber || '');
    setStaffJobType(staff.jobType || 'Security Guard'); setStaffJoiningDate(staff.joiningDate || '');
    setStaffSalary(staff.salary ? String(staff.salary) : ''); setStaffAddress(staff.address || '');
    setStaffEmergencyContact(staff.emergencyContact || ''); setStaffNotes(staff.notes || '');
    setShowStaffModal(true);
  }

  async function handleSaveStaff() {
    if (!myBuilding || !user?.id) return;
    if (!staffFullName.trim()) {
      Alert.alert(t('common_missingField'), t('bld_missingStaffName'));
      return;
    }
    setStaffSaving(true);
    try {
      const body = {
        ownerId: user.id, fullName: staffFullName.trim(), mobileNumber: staffMobile.trim(),
        jobType: staffJobType, joiningDate: staffJoiningDate.trim() || null,
        salary: parseFloat(staffSalary) || 0, address: staffAddress.trim(),
        emergencyContact: staffEmergencyContact.trim(), notes: staffNotes.trim(),
      };
      const res = editingStaff
        ? await apiFetch(`/api/building/staff/${editingStaff.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await apiFetch(`/api/building/buildings/${myBuilding.id}/staff`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) {
        setShowStaffModal(false);
        loadBuildingStaff(myBuilding.id);
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setStaffSaving(false);
    }
  }

  function handleDeleteStaff(staff: any) {
    if (!user?.id || !myBuilding) return;
    Alert.alert(
      t('bld_deleteStaffTitle'),
      t('bld_deleteStaffConfirm', { name: staff.fullName }),
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: t('common_delete'), style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/building/staff/${staff.id}?owner_id=${user.id}`, { method: 'DELETE' });
              if (res.ok) loadBuildingStaff(myBuilding.id);
            } catch {
              Alert.alert(t('common_error'), t('common_networkError'));
            }
          },
        },
      ]
    );
  }

  function handleOpenAddVendor() {
    setEditingVendor(null);
    setVendorName(''); setVendorServiceType('Electrician'); setVendorContactPerson('');
    setVendorMobile(''); setVendorEmail(''); setVendorAddress('');
    setVendorContractStart(''); setVendorContractEnd(''); setVendorNotes('');
    setShowVendorModal(true);
  }

  function handleOpenEditVendor(vendor: any) {
    setEditingVendor(vendor);
    setVendorName(vendor.vendorName || ''); setVendorServiceType(vendor.serviceType || 'Electrician');
    setVendorContactPerson(vendor.contactPerson || ''); setVendorMobile(vendor.mobile || '');
    setVendorEmail(vendor.email || ''); setVendorAddress(vendor.address || '');
    setVendorContractStart(vendor.contractStartDate || ''); setVendorContractEnd(vendor.contractEndDate || '');
    setVendorNotes(vendor.notes || '');
    setShowVendorModal(true);
  }

  async function handleSaveVendor() {
    if (!myBuilding || !user?.id) return;
    if (!vendorName.trim()) {
      Alert.alert(t('common_missingField'), t('bld_missingVendorName'));
      return;
    }
    setVendorSaving(true);
    try {
      const body = {
        ownerId: user.id, vendorName: vendorName.trim(), serviceType: vendorServiceType,
        contactPerson: vendorContactPerson.trim(), mobile: vendorMobile.trim(), email: vendorEmail.trim(),
        address: vendorAddress.trim(), contractStartDate: vendorContractStart.trim() || null,
        contractEndDate: vendorContractEnd.trim() || null, notes: vendorNotes.trim(),
      };
      const res = editingVendor
        ? await apiFetch(`/api/building/vendors/${editingVendor.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await apiFetch(`/api/building/buildings/${myBuilding.id}/vendors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) {
        setShowVendorModal(false);
        loadBuildingVendors(myBuilding.id);
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setVendorSaving(false);
    }
  }

  function handleDeleteVendor(vendor: any) {
    if (!user?.id || !myBuilding) return;
    Alert.alert(
      t('bld_deleteVendorTitle'),
      t('bld_deleteVendorConfirm', { name: vendor.vendorName }),
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: t('common_delete'), style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/building/vendors/${vendor.id}?owner_id=${user.id}`, { method: 'DELETE' });
              if (res.ok) loadBuildingVendors(myBuilding.id);
            } catch {
              Alert.alert(t('common_error'), t('common_networkError'));
            }
          },
        },
      ]
    );
  }

  function handleOpenAddComplaint() {
    setEditingComplaint(null);
    setComplaintCategory('Plumbing'); setComplaintTitle(''); setComplaintDescription('');
    setComplaintPriority('Medium'); setComplaintAssignedStaffId(''); setComplaintAssignedVendorId('');
    setComplaintStatus('New'); setComplaintResolutionNotes('');
    setShowComplaintStaffPicker(false); setShowComplaintVendorPicker(false);
    setShowComplaintModal(true);
  }

  function handleOpenEditComplaint(complaint: any) {
    setEditingComplaint(complaint);
    setComplaintCategory(complaint.category || 'Plumbing');
    setComplaintTitle(complaint.title || '');
    setComplaintDescription(complaint.description || '');
    setComplaintPriority(complaint.priority || 'Medium');
    setComplaintAssignedStaffId(complaint.assignedStaffId || '');
    setComplaintAssignedVendorId(complaint.assignedVendorId || '');
    setComplaintStatus(complaint.status || 'New');
    setComplaintResolutionNotes(complaint.resolutionNotes || '');
    setShowComplaintStaffPicker(false); setShowComplaintVendorPicker(false);
    setShowComplaintModal(true);
  }

  async function handleSaveComplaint() {
    if (!myBuilding || !user?.id) return;
    if (!complaintTitle.trim()) {
      Alert.alert(t('common_missingField'), t('bld_missingComplaintTitle'));
      return;
    }
    setComplaintSaving(true);
    try {
      let res;
      if (editingComplaint) {
        res = await apiFetch(`/api/building/complaints/${editingComplaint.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerId: user.id, category: complaintCategory, title: complaintTitle.trim(),
            description: complaintDescription.trim(), priority: complaintPriority,
            assignedStaffId: complaintAssignedStaffId || null, assignedVendorId: complaintAssignedVendorId || null,
            status: complaintStatus, resolutionNotes: complaintResolutionNotes.trim(),
          }),
        });
      } else {
        res = await apiFetch(`/api/building/buildings/${myBuilding.id}/complaints`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerId: user.id, category: complaintCategory, title: complaintTitle.trim(),
            description: complaintDescription.trim(), priority: complaintPriority,
            assignedStaffId: complaintAssignedStaffId || null, assignedVendorId: complaintAssignedVendorId || null,
          }),
        });
      }
      const data = await res.json();
      if (res.ok) {
        setShowComplaintModal(false);
        loadBuildingComplaints(myBuilding.id);
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setComplaintSaving(false);
    }
  }

  function handleDeleteComplaint(complaint: any) {
    if (!user?.id || !myBuilding) return;
    Alert.alert(
      t('common_delete'),
      complaint.title,
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: t('common_delete'), style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/building/complaints/${complaint.id}?owner_id=${user.id}`, { method: 'DELETE' });
              if (res.ok) loadBuildingComplaints(myBuilding.id);
            } catch {
              Alert.alert(t('common_error'), t('common_networkError'));
            }
          },
        },
      ]
    );
  }

  function handleOpenBuildingForm() {
    if (myBuilding) {
      setBldName(myBuilding.name || '');
      setBldCode(myBuilding.code || '');
      setBldAddress(myBuilding.address || '');
      setBldArea(myBuilding.area || '');
      setBldCity(myBuilding.city || '');
      setBldState(myBuilding.state || '');
      setBldPincode(myBuilding.pincode || '');
      setBldNumFloors(String(myBuilding.numFloors || ''));
      setBldNumFlats(String(myBuilding.numFlats || ''));
      setBldBuildingType(myBuilding.buildingType || 'Residential');
      setBldConstructionYear(myBuilding.constructionYear ? String(myBuilding.constructionYear) : '');
      setBldContactNumber(myBuilding.contactNumber || '');
      setBldEmergencyContact(myBuilding.emergencyContact || '');
      setBldDescription(myBuilding.description || '');
      setBldNotes(myBuilding.notes || '');
    } else {
      setBldName(''); setBldCode(''); setBldAddress(''); setBldArea(''); setBldCity('');
      setBldState(''); setBldPincode(''); setBldNumFloors(''); setBldNumFlats('');
      setBldBuildingType('Residential'); setBldConstructionYear(''); setBldContactNumber('');
      setBldEmergencyContact(''); setBldDescription(''); setBldNotes('');
    }
    setShowBuildingFormModal(true);
  }

  async function handleSaveBuilding() {
    if (!bldName.trim()) {
      Alert.alert(t('common_missingField'), t('bld_missingName'));
      return;
    }
    if (!user?.id) return;
    setBldSaving(true);
    try {
      const body = {
        ownerId: user.id, name: bldName.trim(), code: bldCode.trim(), address: bldAddress.trim(),
        area: bldArea.trim(), city: bldCity.trim(), state: bldState.trim(), pincode: bldPincode.trim(),
        numFloors: parseInt(bldNumFloors, 10) || 0, numFlats: parseInt(bldNumFlats, 10) || 0,
        buildingType: bldBuildingType, constructionYear: parseInt(bldConstructionYear, 10) || null,
        contactNumber: bldContactNumber.trim(), emergencyContact: bldEmergencyContact.trim(),
        description: bldDescription.trim(), notes: bldNotes.trim(),
      };
      const res = myBuilding
        ? await apiFetch(`/api/building/buildings/${myBuilding.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await apiFetch('/api/building/buildings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
      const data = await res.json();
      if (res.ok) {
        setMyBuilding(data.building);
        setShowBuildingFormModal(false);
        Alert.alert(t('common_success'), data.building.name);
      } else if (res.status === 403) {
        Alert.alert(t('bld_planLimitTitle'), data.error);
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setBldSaving(false);
    }
  }

  function handleOpenAddFloor() {
    setFloorNumber(String(buildingFloors.length));
    setFloorName('');
    setFloorNumFlats('');
    setShowFloorModal(true);
  }

  async function handleSaveFloor() {
    if (!myBuilding || !user?.id) return;
    if (floorNumber.trim() === '') {
      Alert.alert(t('common_missingField'), t('bld_missingFloorNumber'));
      return;
    }
    setFloorSaving(true);
    try {
      const res = await apiFetch(`/api/building/buildings/${myBuilding.id}/floors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          floorNumber: parseInt(floorNumber, 10),
          floorName: floorName.trim(),
          numFlats: parseInt(floorNumFlats, 10) || 0,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowFloorModal(false);
        loadBuildingFloors(myBuilding.id);
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setFloorSaving(false);
    }
  }

  function handleDeleteFloor(floor: any) {
    if (!user?.id || !myBuilding) return;
    Alert.alert(
      t('bld_deleteFloorTitle'),
      t('bld_deleteFloorConfirm', { name: floor.floorName || `#${floor.floorNumber}` }),
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: t('common_delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/building/floors/${floor.id}?owner_id=${user.id}`, { method: 'DELETE' });
              if (res.ok) loadBuildingFloors(myBuilding.id);
            } catch {
              Alert.alert(t('common_error'), t('common_networkError'));
            }
          },
        },
      ]
    );
  }

  function handleOpenAddFlat() {
    setEditingFlat(null);
    setFlatFloorId('');
    setFlatNumber('');
    setFlatType('');
    setFlatArea('');
    setFlatOccupancyStatus('Vacant');
    setFlatOwnerName('');
    setFlatTenantName('');
    setFlatPrimaryMobile('');
    setFlatParkingSlot('');
    setFlatMaintenanceAmount('');
    setShowFlatFloorPicker(false);
    setShowFlatModal(true);
  }

  function handleOpenEditFlat(flat: any) {
    setEditingFlat(flat);
    setFlatFloorId(flat.floorId || '');
    setFlatNumber(flat.flatNumber || '');
    setFlatType(flat.flatType || '');
    setFlatArea(flat.area != null ? String(flat.area) : '');
    setFlatOccupancyStatus(flat.occupancyStatus || 'Vacant');
    setFlatOwnerName(flat.ownerName || '');
    setFlatTenantName(flat.tenantName || '');
    setFlatPrimaryMobile(flat.primaryMobile || '');
    setFlatParkingSlot(flat.parkingSlot || '');
    setFlatMaintenanceAmount(flat.maintenanceAmount ? String(flat.maintenanceAmount) : '');
    setShowFlatFloorPicker(false);
    setShowFlatModal(true);
  }

  async function handleSaveFlat() {
    if (!myBuilding || !user?.id) return;
    if (!flatNumber.trim()) {
      Alert.alert(t('common_missingField'), t('bld_missingFlatNumber'));
      return;
    }
    setFlatSaving(true);
    try {
      const body = {
        ownerId: user.id,
        floorId: flatFloorId || null,
        flatNumber: flatNumber.trim(),
        flatType: flatType.trim(),
        area: flatArea ? parseFloat(flatArea) : null,
        occupancyStatus: flatOccupancyStatus,
        ownerName: flatOwnerName.trim(),
        tenantName: flatTenantName.trim(),
        primaryMobile: flatPrimaryMobile.trim(),
        parkingSlot: flatParkingSlot.trim(),
        maintenanceAmount: parseFloat(flatMaintenanceAmount) || 0,
      };
      const res = editingFlat
        ? await apiFetch(`/api/building/flats/${editingFlat.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await apiFetch(`/api/building/buildings/${myBuilding.id}/flats`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
      const data = await res.json();
      if (res.ok) {
        setShowFlatModal(false);
        loadBuildingFlats(myBuilding.id);
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setFlatSaving(false);
    }
  }

  function handleDeleteFlat(flat: any) {
    if (!user?.id || !myBuilding) return;
    Alert.alert(
      t('bld_deleteFlatTitle'),
      t('bld_deleteFlatConfirm', { number: flat.flatNumber }),
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: t('common_delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/building/flats/${flat.id}?owner_id=${user.id}`, { method: 'DELETE' });
              if (res.ok) loadBuildingFlats(myBuilding.id);
            } catch {
              Alert.alert(t('common_error'), t('common_networkError'));
            }
          },
        },
      ]
    );
  }

  function handleOpenAddMember() {
    setEditingMember(null);
    setMemberFlatId('');
    setMemberFullName('');
    setMemberMobileNumber('');
    setMemberEmail('');
    setMemberType('Owner');
    setMemberEmergencyContact('');
    setMemberVehicleNumber('');
    setShowMemberFlatPicker(false);
    setShowMemberModal(true);
  }

  function handleOpenEditMember(member: any) {
    setEditingMember(member);
    setMemberFlatId(member.flatId || '');
    setMemberFullName(member.fullName || '');
    setMemberMobileNumber(member.mobileNumber || '');
    setMemberEmail(member.email || '');
    setMemberType(member.memberType || 'Owner');
    setMemberEmergencyContact(member.emergencyContact || '');
    setMemberVehicleNumber(member.vehicleNumber || '');
    setShowMemberFlatPicker(false);
    setShowMemberModal(true);
  }

  async function handleSaveMember() {
    if (!myBuilding || !user?.id) return;
    if (!memberFullName.trim()) {
      Alert.alert(t('common_missingField'), t('bld_missingMemberName'));
      return;
    }
    setMemberSaving(true);
    try {
      const body = {
        ownerId: user.id,
        flatId: memberFlatId || null,
        fullName: memberFullName.trim(),
        mobileNumber: memberMobileNumber.trim(),
        email: memberEmail.trim(),
        memberType,
        emergencyContact: memberEmergencyContact.trim(),
        vehicleNumber: memberVehicleNumber.trim(),
      };
      const res = editingMember
        ? await apiFetch(`/api/building/members/${editingMember.id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          })
        : await apiFetch(`/api/building/buildings/${myBuilding.id}/members`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          });
      const data = await res.json();
      if (res.ok) {
        setShowMemberModal(false);
        loadBuildingMembers(myBuilding.id);
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setMemberSaving(false);
    }
  }

  function handleDeleteMember(member: any) {
    if (!user?.id || !myBuilding) return;
    Alert.alert(
      t('bld_deleteMemberTitle'),
      t('bld_deleteMemberConfirm', { name: member.fullName }),
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: t('common_delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/building/members/${member.id}?owner_id=${user.id}`, { method: 'DELETE' });
              if (res.ok) loadBuildingMembers(myBuilding.id);
            } catch {
              Alert.alert(t('common_error'), t('common_networkError'));
            }
          },
        },
      ]
    );
  }

  async function handleOpenMemberPassbook(member: any) {
    setPassbookMember(member);
    setShowMemberPassbookModal(true);
    setMemberPassbookBills([]);
    if (!member.flatId || !myBuilding || !user?.id) return;
    setMemberPassbookLoading(true);
    try {
      const params = new URLSearchParams({ owner_id: String(user.id), flat_id: String(member.flatId) });
      const billsRes = await apiFetch(`/api/building/buildings/${myBuilding.id}/bills?${params.toString()}`);
      const billsData = billsRes.ok ? await billsRes.json() : { bills: [] };
      setMemberPassbookBills(billsData.bills || []);
    } catch (e) {
      console.error('Error loading member passbook:', e);
    } finally {
      setMemberPassbookLoading(false);
    }
  }

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const res = await apiFetch(`/api/assistant/daily-summary?owner_id=${user.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.summary) return;
        const dismissKey = `dailySummaryDismissed_${user.id}_${data.date}`;
        const dismissed = await AsyncStorage.getItem(dismissKey).catch(() => null);
        setDailySummaryText(data.summary);
        setDailySummaryDate(data.date);
        if (!dismissed) {
          setShowDailySummary(true);
        }
      } catch (e) {
        console.error('Error loading daily summary:', e);
      }
    })();
  }, [user?.id]);

  function handleDismissDailySummary() {
    setShowDailySummary(false);
    if (user?.id && dailySummaryDate) {
      AsyncStorage.setItem(`dailySummaryDismissed_${user.id}_${dailySummaryDate}`, '1').catch(() => {});
    }
  }

  function handleOpenChat() {
    if (chatMessages.length === 0) {
      const firstName = user?.fullName ? user.fullName.split(' ')[0] : '';
      setChatMessages([{ role: 'bot', text: `Hi ${firstName}! Ask me things like "How much did I collect today?" or "What's my pending amount?" and I'll answer using your own data.` }]);
    }
    setShowChatModal(true);
  }

  async function handleSendChatMessage() {
    const text = chatInput.trim();
    if (!text || !user?.id) return;
    setChatMessages(prev => [...prev, { role: 'user', text }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await apiFetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, message: text }),
      });
      const data = await res.json();
      setChatMessages(prev => [...prev, { role: 'bot', text: data.reply || data.error || "Sorry, I couldn't process that." }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'bot', text: 'Network error — please check your connection and try again.' }]);
    } finally {
      setChatLoading(false);
    }
  }

  // ---- Voice Q&A: speak a question instead of typing it. One Gemini call both
  // transcribes the question and answers it using the same grounded data as the
  // text chat, so the driver can ask "how much fuel this month" out loud. ----
  async function handleStartChatVoiceRecording() {
    if (!user?.id) return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('common_error'), t('drv_micPermissionDenied'));
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await voiceRecorder.prepareToRecordAsync();
      voiceRecorder.record();
      setTimeout(() => {
        if (voiceRecorder.isRecording) handleStopChatVoiceRecording();
      }, 8000);
    } catch (e) {
      console.error('Error starting chat voice recording:', e);
      Alert.alert(t('common_error'), t('drv_voiceUnavailable'));
    }
  }

  async function handleStopChatVoiceRecording() {
    if (!user?.id || !voiceRecorder.isRecording) return;
    try {
      await voiceRecorder.stop();
      const uri = voiceRecorder.uri;
      if (!uri) {
        Alert.alert(t('common_error'), t('drv_voiceUnavailable'));
        return;
      }
      setChatVoiceProcessing(true);
      const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const res = await apiFetch('/api/assistant/voice-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, audioBase64, mimeType: 'audio/mp4' }),
      });
      const data = await res.json();
      if (data.transcript) {
        setChatMessages(prev => [...prev, { role: 'user', text: data.transcript }]);
      }
      setChatMessages(prev => [...prev, { role: 'bot', text: data.reply || data.error || "Sorry, I couldn't process that." }]);
    } catch (e) {
      console.error('Error processing chat voice recording:', e);
      setChatMessages(prev => [...prev, { role: 'bot', text: 'Network error — please check your connection and try again.' }]);
    } finally {
      setChatVoiceProcessing(false);
    }
  }

  useEffect(() => {
    if (user && (activeTab === 'inventory' || activeTab === 'daily_collection' || activeTab === 'sales' || activeTab === 'home')) {
      loadInventoryData();
    }
    if (user && activeTab === 'inventory_insights') {
      loadInventoryInsights();
    }
    if (user && activeTab === 'inventory') {
      loadRestockSuggestions();
    }
    if (user && (activeTab === 'vendors' || activeTab === 'daily_collection')) {
      loadVendors();
    }
  }, [user?.id, activeTab]);

  useEffect(() => {
    if (user && (activeTab === 'inventory' || activeTab === 'daily_collection' || activeTab === 'sales')) {
      loadInventoryTransactions(dcSelectedDate);
    }
  }, [dcSelectedDate]);

  function shiftDcCalendarMonth(delta: number) {
    setDcCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  function handleOpenAddInventoryVendor() {
    setNewVendorName('');
    setNewVendorMobile('');
    setNewVendorEmail('');
    setNewVendorAddress('');
    setShowAddVendorModal(true);
  }

  async function handleAddVendor() {
    if (!newVendorName.trim()) {
      Alert.alert(t('common_missingField'), t('dc_missingVendorName'));
      return;
    }
    if (!user?.id) {
      Alert.alert(t('common_error'), t('inv_accountError'));
      return;
    }
    setAddVendorLoading(true);
    try {
      const res = await apiFetch('/api/inventory/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          name: newVendorName.trim(),
          mobileNumber: newVendorMobile.trim(),
          email: newVendorEmail.trim(),
          address: newVendorAddress.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddVendorModal(false);
        await loadVendors();
      } else {
        Alert.alert(t('common_error'), data.error || t('dc_recordFailed'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setAddVendorLoading(false);
    }
  }

  async function loadVendors() {
    if (!user?.id) return;
    setVendorsLoading(true);
    try {
      const res = await apiFetch(`/api/inventory/vendors?owner_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setVendors(data.vendors || []);
      }
    } catch (e) {
      console.error('Error loading vendors:', e);
    } finally {
      setVendorsLoading(false);
    }
  }

  async function loadVendorLedger(vendorName: string) {
    if (!user?.id || !vendorName) return;
    setVendorLedgerLoading(true);
    try {
      const res = await apiFetch(`/api/inventory/vendor-ledger?owner_id=${user.id}&vendor=${encodeURIComponent(vendorName)}`);
      if (res.ok) {
        const data = await res.json();
        setVendorLedger(data);
      }
    } catch (e) {
      console.error('Error loading vendor ledger:', e);
    } finally {
      setVendorLedgerLoading(false);
    }
  }

  function handleOpenVendorLedger(vendorName: string) {
    if (!vendorName) return;
    setVendorLedgerName(vendorName);
    setVendorLedger(null);
    setShowVendorLedgerModal(true);
    loadVendorLedger(vendorName);
  }

  function handleOpenPayVendor() {
    const due = vendorLedger?.totals?.totalDue || 0;
    setPayVendorAmount(due > 0 ? String(due) : '');
    setPayVendorMethod('CASH');
    setPayVendorNote('');
    setShowPayVendorModal(true);
  }

  async function handleRecordVendorPayment() {
    const amount = parseFloat(payVendorAmount) || 0;
    if (amount <= 0) {
      Alert.alert(t('common_missingField'), t('dc_missingPayAmount'));
      return;
    }
    if (!user?.id || !vendorLedgerName) return;
    setPayVendorLoading(true);
    try {
      const res = await apiFetch('/api/inventory/vendor-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          vendorName: vendorLedgerName,
          amount,
          paymentMethod: payVendorMethod,
          note: payVendorNote.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowPayVendorModal(false);
        await loadVendorLedger(vendorLedgerName);
        if (activeTab === 'vendors') loadVendors();
        Alert.alert(t('dc_paymentRecorded'), t('dc_paymentRecordedMsg', { amount, vendor: vendorLedgerName }));
      } else {
        Alert.alert(t('common_error'), data.error || t('dc_recordFailed'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setPayVendorLoading(false);
    }
  }

  function handleOpenRecordSale(item?: InventoryItem, type: 'SALE' | 'PURCHASE' | 'WASTAGE' = 'SALE', presetQty?: string) {
    setSaleProductId(item ? item.id : (inventory[0]?.id || ''));
    setSaleQuantity(presetQty || '');
    setSaleAmount('');
    setSalePaidNow('');
    setSaleNote('');
    setSaleType(type);
    setSalePaymentMethod('CASH');
    setShowProductPicker(false);
    setShowVendorPicker(false);
    setInventoryVoiceTranscript('');
    setInventoryVoiceConfirmed(false);
    setShowRecordSaleModal(true);
  }

  // ---- Fruit Seller "AI Agent": one voice note, classified as either adding a new
  // product or recording a sale/purchase/wastage. Never saves anything itself - it
  // only prefills the existing Add Product / Record Sale forms for the owner to
  // review and confirm, same safeguard used for every other voice feature. ----
  async function handleStartInventoryVoiceRecording() {
    if (!user?.id) return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('common_error'), t('drv_micPermissionDenied'));
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await voiceRecorder.prepareToRecordAsync();
      voiceRecorder.record();
      setTimeout(() => {
        if (voiceRecorder.isRecording) handleStopInventoryVoiceRecording();
      }, 8000);
    } catch (e) {
      console.error('Error starting inventory voice recording:', e);
      Alert.alert(t('common_error'), t('drv_voiceUnavailable'));
    }
  }

  async function handleStopInventoryVoiceRecording() {
    if (!user?.id || !voiceRecorder.isRecording) return;
    try {
      await voiceRecorder.stop();
      const uri = voiceRecorder.uri;
      if (!uri) {
        Alert.alert(t('common_error'), t('drv_voiceUnavailable'));
        return;
      }
      setInventoryVoiceProcessing(true);
      const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const res = await apiFetch('/api/inventory/voice-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, audioBase64, mimeType: 'audio/mp4' }),
      });
      const data = await res.json();
      if (data.error) {
        Alert.alert(t('common_error'), data.error);
        return;
      }
      if (data.intent === 'add_product' && data.product?.name) {
        setNewProductName(data.product.name);
        setNewProductCategory('');
        setNewProductUnit(data.product.unit || 'kg');
        setNewProductStockQty('');
        setNewProductSellingPrice(data.product.sellingPrice != null ? String(data.product.sellingPrice) : '');
        setNewProductCostPrice(data.product.costPrice != null ? String(data.product.costPrice) : '');
        setNewProductLowStock('');
        setInventoryVoiceTranscript(data.transcript || '');
        setInventoryVoiceConfirmed(false);
        setShowAddProductModal(true);
      } else if (data.intent === 'record_transaction' && data.transaction?.productName) {
        const matched = inventory.find(p => p.name.toLowerCase() === String(data.transaction.productName).toLowerCase());
        setSaleProductId(matched ? matched.id : (inventory[0]?.id || ''));
        setSaleQuantity(data.transaction.quantity != null ? String(data.transaction.quantity) : '');
        setSaleAmount(data.transaction.amount != null ? String(data.transaction.amount) : '');
        setSaleNote('');
        setSaleType(data.transaction.type || 'SALE');
        setSalePaymentMethod(data.transaction.paymentMethod || 'CASH');
        setShowProductPicker(false);
        setInventoryVoiceTranscript(data.transcript || '');
        setInventoryVoiceConfirmed(false);
        setShowRecordSaleModal(true);
      } else {
        Alert.alert(t('inv_voiceUnclearTitle'), t('inv_voiceUnclearMsg', { transcript: data.transcript || '' }));
      }
    } catch (e) {
      console.error('Error processing inventory voice recording:', e);
      Alert.alert(t('common_error'), t('drv_voiceUnavailable'));
    } finally {
      setInventoryVoiceProcessing(false);
    }
  }

  async function handleAddProduct() {
    if (!newProductName.trim()) {
      Alert.alert(t('common_missingField'), t('inv_missingName'));
      return;
    }
    if (!user?.id) {
      Alert.alert(t('common_error'), t('inv_accountError'));
      return;
    }
    setAddProductLoading(true);
    try {
      const res = await apiFetch('/api/inventory/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          name: newProductName.trim(),
          category: newProductCategory.trim() || 'General',
          unit: newProductUnit.trim() || 'kg',
          stockQty: parseFloat(newProductStockQty) || 0,
          sellingPrice: parseFloat(newProductSellingPrice) || 0,
          costPrice: parseFloat(newProductCostPrice) || 0,
          lowStockThreshold: parseFloat(newProductLowStock) || 0,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddProductModal(false);
        setNewProductName('');
        setNewProductCategory('');
        setNewProductUnit('kg');
        setNewProductStockQty('');
        setNewProductSellingPrice('');
        setNewProductCostPrice('');
        setNewProductLowStock('');
        await loadInventoryProducts();
        Alert.alert(t('inv_productAdded'), t('inv_productAddedMsg', { name: data.product.name }));
      } else {
        Alert.alert(t('common_error'), data.error || t('inv_addFailed'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setAddProductLoading(false);
    }
  }

  async function handleRecordSale() {
    if (!saleProductId) {
      Alert.alert(t('common_missingField'), t('dc_missingProduct'));
      return;
    }
    const amount = parseFloat(saleAmount) || 0;
    const quantity = parseFloat(saleQuantity) || 0;
    if (saleType === 'WASTAGE') {
      if (quantity <= 0) {
        Alert.alert(t('common_missingField'), t('dc_missingWastageQty'));
        return;
      }
    } else if (saleType === 'PURCHASE') {
      if (quantity <= 0) {
        Alert.alert(t('common_missingField'), t('dc_missingPurchaseQty'));
        return;
      }
      if (amount <= 0) {
        Alert.alert(t('common_missingField'), t('dc_missingPurchaseAmount'));
        return;
      }
    } else if (amount <= 0) {
      Alert.alert(t('common_missingField'), t('dc_missingAmount'));
      return;
    }
    if (!user?.id) {
      Alert.alert(t('common_error'), t('inv_accountError'));
      return;
    }
    const paidNow = saleType === 'PURCHASE' && salePaidNow.trim() !== '' ? parseFloat(salePaidNow) || 0 : undefined;
    setRecordSaleLoading(true);
    try {
      const res = await apiFetch('/api/inventory/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          productId: saleProductId,
          quantity,
          amount,
          type: saleType,
          paymentMethod: salePaymentMethod,
          note: saleNote.trim(),
          ...(paidNow !== undefined ? { amountPaid: paidNow } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowRecordSaleModal(false);
        await Promise.all([loadInventoryProducts(), loadInventoryTransactions()]);
        loadRestockSuggestions();
        if (saleType === 'PURCHASE') loadVendors();
        if (saleType === 'WASTAGE') {
          Alert.alert(t('dc_wastageRecorded'), `${quantity} ${data.transaction.unit} ${t('inv_product').toLowerCase()} "${data.transaction.productName}" ₹${data.transaction.amount}`);
        } else if (saleType === 'PURCHASE') {
          const due = data.transaction.amountDue || 0;
          Alert.alert(
            t('dc_purchaseRecorded'),
            `${quantity} ${data.transaction.unit} — "${data.transaction.productName}" ₹${data.transaction.amount}` +
              (due > 0 ? `\n${t('dc_dueToVendor', { amount: due })}` : '')
          );
        } else {
          Alert.alert(t('dc_saleRecorded'), `₹${data.transaction.amount} — "${data.transaction.productName}"`);
        }
      } else {
        Alert.alert(t('common_error'), data.error || t('dc_recordFailed'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setRecordSaleLoading(false);
    }
  }

  function handleOpenEditStock(item: InventoryItem) {
    setEditStockProduct(item);
    setEditStockAddQty('');
    setShowEditStockModal(true);
  }

  async function handleSaveEditStock() {
    if (!editStockProduct || !user?.id) return;
    const addQty = parseFloat(editStockAddQty);
    if (!addQty || addQty <= 0) {
      Alert.alert(t('common_missingField'), t('inv_missingQty'));
      return;
    }
    setEditStockLoading(true);
    try {
      const newStockQty = editStockProduct.stockQty + addQty;
      const res = await apiFetch(`/api/inventory/products/${editStockProduct.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, stockQty: newStockQty }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowEditStockModal(false);
        await loadInventoryProducts();
        loadRestockSuggestions();
        Alert.alert(t('inv_stockUpdated'), t('inv_stockUpdatedMsg', { name: editStockProduct.name, qty: newStockQty, unit: editStockProduct.unit }));
      } else {
        Alert.alert(t('common_error'), data.error || t('inv_stockUpdateFailed'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setEditStockLoading(false);
    }
  }

  function handleDeleteProduct(item: InventoryItem) {
    if (!user?.id) return;
    Alert.alert(
      t('inv_deleteTitle'),
      t('inv_deleteConfirm', { name: item.name }),
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: t('common_delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/inventory/products/${item.id}?owner_id=${user.id}`, { method: 'DELETE' });
              if (res.ok) {
                await loadInventoryProducts();
              } else {
                const data = await res.json();
                Alert.alert(t('common_error'), data.error || t('inv_deleteFailed'));
              }
            } catch {
              Alert.alert(t('common_error'), t('common_networkError'));
            }
          },
        },
      ]
    );
  }

  function handleDeleteTransaction(tx: any) {
    if (!user?.id) return;
    Alert.alert(
      t('dc_deleteTxTitle'),
      t('dc_deleteTxConfirm', { amount: tx.amount, product: tx.productName }),
      [
        { text: t('common_cancel'), style: 'cancel' },
        {
          text: t('common_delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/inventory/transactions/${tx.id}?owner_id=${user.id}`, { method: 'DELETE' });
              if (res.ok) {
                await Promise.all([loadInventoryProducts(), loadInventoryTransactions()]);
              } else {
                const data = await res.json();
                Alert.alert(t('common_error'), data.error || t('dc_deleteTxFailed'));
              }
            } catch {
              Alert.alert(t('common_error'), t('common_networkError'));
            }
          },
        },
      ]
    );
  }

  function handleOpenCollectModal(item: any) {
    if (isDayClosed) {
      Alert.alert('Day Closed', 'Today\'s collection beat is closed and locked.');
      return;
    }
    setSelectedCollectItem(item);
    setCollectAmount(String(item.pendingAmount || item.pending_amount || item.expectedAmount || item.expected_amount || item.amount || 1000));
    setCollectMethod('Cash');
    setCollectRef('');
    setCollectNotes('');
    setShowCollectModal(true);
  }

  async function submitCollectionPayment() {
    if (!selectedCollectItem) return;
    const amt = parseFloat(collectAmount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    if ((collectMethod === 'UPI' || collectMethod === 'Bank Transfer') && !collectRef.trim()) {
      Alert.alert('Reference Required', 'Transaction Reference / UTR is mandatory for UPI and Bank Transfer.');
      return;
    }

    setCollectLoading(true);
    const schedId = selectedCollectItem.scheduleId || selectedCollectItem.id;
    try {
      const res = await apiFetch('/api/collection/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedule_id: schedId,
          scheduleId: schedId,
          amount: amt,
          payment_method: collectMethod === 'Bank Transfer' ? 'BANK_TRANSFER' : collectMethod.toUpperCase(),
          transaction_ref: collectRef.trim() || undefined,
          notes: collectNotes.trim() || undefined,
          collector_id: user?.id || 36,
        }),
      });
      const data = await res.json();
      if (res.ok && data.receipt) {
        setShowCollectModal(false);
        const newTx: LedgerTransaction = {
          id: `tx-${Date.now()}`,
          type: 'in',
          amount: amt,
          party: `${selectedCollectItem.customerName || selectedCollectItem.customer_name || selectedCollectItem.name} (Collection)`,
          category: 'Customer Collection',
          paymentMode: (collectMethod === 'Bank Transfer' ? 'Card' : collectMethod) as any,
          date: 'Today',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setTransactions(prev => [newTx, ...prev]);
        await loadCollectionData();
        setReceiptData(data.receipt);
      } else {
        setShowCollectModal(false);
        setCollectionSchedule(prev => prev.map(it => {
          if ((it.scheduleId || it.id) === schedId) {
            return { ...it, status: 'COLLECTED', collectedAmount: amt, paymentMethod: collectMethod, receiptNumber: `REC-${Date.now()}`, lastUpdated: 'Just now', last_updated: 'Just now', updatedAt: new Date().toISOString(), updated_at: new Date().toISOString() };
          }
          return it;
        }));
        Alert.alert('Payment Recorded', `Collected ₹${amt} via ${collectMethod}.`);
      }
    } catch {
      setShowCollectModal(false);
      setCollectionSchedule(prev => prev.map(it => {
        if ((it.scheduleId || it.id) === schedId) {
          return { ...it, status: 'COLLECTED', collectedAmount: amt, paymentMethod: collectMethod, receiptNumber: `REC-${Date.now()}`, lastUpdated: 'Just now', last_updated: 'Just now', updatedAt: new Date().toISOString(), updated_at: new Date().toISOString() };
        }
        return it;
      }));
      Alert.alert('Recorded Locally', `Collected ₹${amt} via ${collectMethod}.`);
    } finally {
      setCollectLoading(false);
    }
  }

  function handleOpenStatusModal(item: any) {
    if (isDayClosed) {
      Alert.alert('Day Closed', 'Today\'s collection beat is closed.');
      return;
    }
    setSelectedStatusItem(item);
    setStatusChoice('NOT_AVAILABLE');
    setStatusReason('');
    setFollowupDate('2026-09-08');
    setShowStatusModal(true);
  }

  async function submitStatusUpdate() {
    if (!selectedStatusItem) return;
    if (!statusReason.trim()) {
      Alert.alert('Reason Required', 'Please provide a reason or customer remarks.');
      return;
    }

    setStatusLoading(true);
    const schedId = selectedStatusItem.scheduleId || selectedStatusItem.id;
    try {
      let res: Response;
      if (statusChoice === 'RESCHEDULED') {
        res = await apiFetch('/api/collection/reschedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schedule_id: schedId,
            scheduleId: schedId,
            reschedule_date: followupDate,
            nextFollowupDate: followupDate,
            reason: statusReason.trim(),
          }),
        });
      } else {
        res = await apiFetch('/api/collection/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schedule_id: schedId,
            scheduleId: schedId,
            status: statusChoice,
            reason: statusReason.trim(),
            next_followup_date: followupDate || undefined,
          }),
        });
      }
      setShowStatusModal(false);
      setCollectionSchedule(prev => prev.map(it => {
        if ((it.scheduleId || it.id) === schedId) {
          return { ...it, status: statusChoice, notes: statusReason.trim(), nextFollowupDate: followupDate, lastUpdated: 'Just now', last_updated: 'Just now', updatedAt: new Date().toISOString(), updated_at: new Date().toISOString() };
        }
        return it;
      }));
      await loadCollectionData();
      Alert.alert('Status Updated', `Customer #${selectedStatusItem.customerName || selectedStatusItem.customer_name || 'Record'} marked as ${statusChoice.replace('_', ' ')}.`);
    } catch {
      setShowStatusModal(false);
      setCollectionSchedule(prev => prev.map(it => {
        if ((it.scheduleId || it.id) === schedId) {
          return { ...it, status: statusChoice, notes: statusReason.trim(), nextFollowupDate: followupDate, lastUpdated: 'Just now', last_updated: 'Just now', updatedAt: new Date().toISOString(), updated_at: new Date().toISOString() };
        }
        return it;
      }));
      Alert.alert('Saved Offline', `Marked as ${statusChoice.replace('_', ' ')}.`);
    } finally {
      setStatusLoading(false);
    }
  }

  async function handleViewReceipt(receiptNumber?: string) {
    if (!receiptNumber) return;
    try {
      const res = await apiFetch(`/api/collection/receipts/${receiptNumber}`);
      const data = await res.json();
      if (res.ok && data.receipt) {
        setReceiptData(data.receipt);
      } else {
        Alert.alert('Receipt', data.error || 'Receipt details not found.');
      }
    } catch {
      Alert.alert('Error', 'Could not load receipt.');
    }
  }

  async function handleShareReceipt(receipt: any) {
    try {
      const msg = `*BizPilot Collection Receipt*\nReceipt: ${receipt.receipt_number}\nCustomer: ${receipt.customer_name} (${receipt.customer_account})\nAmount Paid: ₹${Number(receipt.amount_paid).toLocaleString()}\nMode: ${receipt.payment_method}\nRemaining Due: ₹${Number(receipt.updated_balance).toLocaleString()}\nThank you!`;
      await Share.share({ message: msg });
    } catch (e) {
      console.error(e);
    }
  }

  async function submitDayClosing() {
    const cashVal = parseFloat(physicalCashCount);
    if (isNaN(cashVal) || cashVal < 0) {
      Alert.alert('Cash Count', 'Please enter physical cash counted in your bag.');
      return;
    }

    setClosingLoading(true);
    try {
      const res = await apiFetch('/api/collection/daily-closing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: getTodayDateString(),
          collector_id: user?.id || 36,
          notes: closingNotes.trim() || 'Day reconciled and closed',
          physical_cash_count: cashVal,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowClosingModal(false);
        await loadCollectionData();
        Alert.alert('Day Closed', 'Today\'s collection beat is successfully reconciled and locked.');
      } else {
        Alert.alert('Closing Failed', data.error || 'Could not close day.');
      }
    } catch {
      Alert.alert('Error', 'Network connection failed.');
    } finally {
      setClosingLoading(false);
    }
  }

  // Modal: Add Fuel Fill-up
  const [showAddFuelModal, setShowAddFuelModal] = useState(false);
  const [fuelTypeChoice, setFuelTypeChoice] = useState<'CNG' | 'Petrol' | 'Diesel'>('CNG');
  const [fuelQty, setFuelQty] = useState('');
  const [fuelRate, setFuelRate] = useState('85');
  const [fuelOdometer, setFuelOdometer] = useState('');
  const [fuelStationName, setFuelStationName] = useState('');
  const [fuelTotalOverride, setFuelTotalOverride] = useState('');
  const [fuelVoiceProcessing, setFuelVoiceProcessing] = useState(false);
  const [fuelVoiceTranscript, setFuelVoiceTranscript] = useState('');
  const [fuelVoiceConfirmed, setFuelVoiceConfirmed] = useState(false);

  // Modal: Edit Vehicle
  const [showEditVehicleModal, setShowEditVehicleModal] = useState(false);
  const [editVehReg, setEditVehReg] = useState(INITIAL_VEHICLE.regNumber);
  const [editVehModel, setEditVehModel] = useState(INITIAL_VEHICLE.model);
  const [editVehInsurance, setEditVehInsurance] = useState(INITIAL_VEHICLE.insuranceExpiry);
  const [editVehFitness, setEditVehFitness] = useState(INITIAL_VEHICLE.fitnessExpiry);
  const [editVehPuc, setEditVehPuc] = useState(INITIAL_VEHICLE.pucExpiry);

  // New Transaction Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [txType, setTxType] = useState<'in' | 'out'>('in');
  const [txAmount, setTxAmount] = useState('');
  const [txParty, setTxParty] = useState('');
  const [txCategory, setTxCategory] = useState('Ride Fare');
  const [txMode, setTxMode] = useState<'Cash' | 'UPI' | 'Card' | 'Credit'>('Cash');

  // New Due Modal State
  const [showAddDueModal, setShowAddDueModal] = useState(false);
  const [dueName, setDueName] = useState('');
  const [dueAmount, setDueAmount] = useState('');
  const [dueType, setDueType] = useState<'to_collect' | 'to_pay'>('to_collect');

  // Filter state for transactions
  const [txFilter, setTxFilter] = useState<'all' | 'in' | 'out'>('all');

  // Feature Resolution Helper
  const hasFeature = (key: string) => {
    if (!user) return false;
    const feats = user.enabledFeatures;
    if (Array.isArray(feats) && feats.length > 0) {
      return feats.includes(key);
    }
    const bt = (user.businessType || '').toLowerCase();
    if (bt.includes('auto')) return ['vehicle', 'trips', 'fuel'].includes(key);
    if (bt.includes('fruit') || bt.includes('vegetable') || bt.includes('retail')) {
      return ['products', 'inventory', 'sales', 'purchases'].includes(key);
    }
    if (bt.includes('mechanic')) return ['service_jobs', 'vehicle_customer', 'spare_parts', 'job_status'].includes(key);
    if (bt.includes('collection')) return ['collection_records', 'due_amount', 'payment_collection'].includes(key);
    return false;
  };

  // Indian Standard Time (IST - Asia/Kolkata) Date & Time Formatter
  function formatIndianDateTime(dateVal: any): { date: string; time: string } {
    if (!dateVal) return { date: 'Today', time: '' };
    try {
      let d: Date;
      if (typeof dateVal === 'string') {
        const s = dateVal.trim();
        // If string lacks timezone indicator (e.g. "YYYY-MM-DD HH:mm"), treat as IST (+05:30)
        if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
          const iso = s.replace(' ', 'T');
          d = new Date(iso.length === 16 ? `${iso}:00+05:30` : `${iso}+05:30`);
        } else {
          d = new Date(s);
        }
      } else {
        d = new Date(dateVal);
      }
      if (isNaN(d.getTime())) return { date: String(dateVal), time: '' };
      const dateStr = d.toLocaleDateString('en-US', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
      const timeStr = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      });
      return { date: dateStr, time: timeStr };
    } catch {
      return { date: String(dateVal), time: '' };
    }
  }

  function getCurrentIndianTime(): string {
    return new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });
  }

  // Collection Customer Management States
  const [newCustName, setNewCustName] = useState('');
  const [newCustMobile, setNewCustMobile] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustArea, setNewCustArea] = useState('');
  const [newCustExpected, setNewCustExpected] = useState('1000');
  const [newCustTotalDue, setNewCustTotalDue] = useState('4000');
  const [newCustInterestRate, setNewCustInterestRate] = useState('0');
  const [addCustLoading, setAddCustLoading] = useState(false);

  const [showEditCustModal, setShowEditCustModal] = useState(false);
  const [editingCustItem, setEditingCustItem] = useState<any>(null);
  const [editCustName, setEditCustName] = useState('');
  const [editCustMobile, setEditCustMobile] = useState('');
  const [editCustAddress, setEditCustAddress] = useState('');
  const [editCustArea, setEditCustArea] = useState('');
  const [editCustExpected, setEditCustExpected] = useState('');
  const [editCustTotalDue, setEditCustTotalDue] = useState('');
  const [editCustInterestRate, setEditCustInterestRate] = useState('0');
  const [editCustLoading, setEditCustLoading] = useState(false);

  // Customer Passbook & In/Out Entry States
  const [showCustomerPassbookModal, setShowCustomerPassbookModal] = useState(false);
  const [selectedPassbookCustomer, setSelectedPassbookCustomer] = useState<any>(null);
  const [passbookData, setPassbookData] = useState<any>(null);
  const [calendarMonthOffset, setCalendarMonthOffset] = useState<number>(0);
  const [showCalendarModal, setShowCalendarModal] = useState<boolean>(false);
  const [calendarCustomer, setCalendarCustomer] = useState<any>(null);
  const [calendarScheduleDays, setCalendarScheduleDays] = useState<any[]>([]);
  const [calendarLoading, setCalendarLoading] = useState<boolean>(false);

  const [showCloseAccountModal, setShowCloseAccountModal] = useState<boolean>(false);
  const [closingSummary, setClosingSummary] = useState<any>(null);
  const [closingSummaryLoading, setClosingSummaryLoading] = useState<boolean>(false);
  const [closeAccountSubmitting, setCloseAccountSubmitting] = useState<boolean>(false);
  const [closeAccountNotes, setCloseAccountNotes] = useState<string>('');
  const [passbookLoading, setPassbookLoading] = useState(false);

  const [showEntryModal, setShowEntryModal] = useState(false);
  const [entryType, setEntryType] = useState<'IN' | 'OUT'>('IN');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryPaymentMode, setEntryPaymentMode] = useState<'Cash' | 'UPI' | 'Bank Transfer'>('Cash');
  const [entryRef, setEntryRef] = useState('');
  const [entryNotes, setEntryNotes] = useState('');
  const [entrySubmitting, setEntrySubmitting] = useState(false);

  // Collection Dashboard States
  const [dashFilterType, setDashFilterType] = useState<'all' | 'date' | 'monthly' | 'quarterly' | 'yearly'>('all');
  const [dashSelectedDate, setDashSelectedDate] = useState<string>(getTodayDateString());
  const [dashSelectedMonth, setDashSelectedMonth] = useState<string>('2026-09');
  const [dashSelectedQuarter, setDashSelectedQuarter] = useState<string>('Q3-2026');
  const [dashSelectedYear, setDashSelectedYear] = useState<string>('2026');
  const [dashSubFilter, setDashSubFilter] = useState<'ALL' | 'COLLECTED' | 'MISSED' | 'PENDING' | 'HISTORY' | 'DAILY_REPORT'>('ALL');
  const [dashCustomerSearch, setDashCustomerSearch] = useState<string>('');
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [dashLoading, setDashLoading] = useState<boolean>(false);
  const [showChartsModal, setShowChartsModal] = useState<boolean>(false);

  // Filter collection customers by search query (name, phone, area, account). Pending/not-yet-collected
  // customers are shown first (so an agent sees who still needs a visit), then within each group,
  // the latest updated entries are on top.
  const filteredCollectionSchedule = collectionSchedule
    .slice()
    .sort((a, b) => {
      const priorityA = a.status === 'COLLECTED' ? 1 : 0;
      const priorityB = b.status === 'COLLECTED' ? 1 : 0;
      if (priorityA !== priorityB) {
        return priorityA - priorityB; // Pending (0) before Collected (1)
      }
      const timeA = a.updatedAt || a.updated_at ? new Date(a.updatedAt || a.updated_at).getTime() : 0;
      const timeB = b.updatedAt || b.updated_at ? new Date(b.updatedAt || b.updated_at).getTime() : 0;
      if (timeA && timeB && Math.abs(timeA - timeB) > 1000) {
        return timeB - timeA;
      }
      const idA = Number(a.scheduleId || a.schedule_id || a.customerId || a.customer_id || a.id || 0);
      const idB = Number(b.scheduleId || b.schedule_id || b.customerId || b.customer_id || b.id || 0);
      return idB - idA; // Latest customer entries on top
    })
    .filter((item) => {
      if (!customerSearchQuery.trim()) return true;
      const q = customerSearchQuery.trim().toLowerCase();
      const name = (item.customerName || item.customer_name || item.name || '').toLowerCase();
      const phone = (item.mobile || item.phone || '').toLowerCase();
      const area = (item.area || item.address || '').toLowerCase();
      const acc = (item.accountNumber || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || area.includes(q) || acc.includes(q);
    });

  // Customers found via the all-time search (allCustomerSearchResults) that aren't already
  // showing up in today's beat above - i.e. genuinely "previous record" matches.
  const todayScheduleCustomerIds = new Set(
    filteredCollectionSchedule.map((item) => Number(item.customerId || item.customer_id || item.id))
  );
  const extraCustomerResults = customerSearchQuery.trim().length >= 2
    ? allCustomerSearchResults.filter((c) => !todayScheduleCustomerIds.has(Number(c.id)))
    : [];

  // Dynamic Navigation Tabs - Daily Ledger and Khata Dues hidden on mobile app per user request
  const isCollection = (user?.businessType || '').toLowerCase().includes('collection');
  const isBuildingBusiness = (() => {
    const bt = (user?.businessType || '').toLowerCase();
    return bt.includes('building') || bt.includes('society');
  })();
  const isTravelBusiness = (user?.businessType || '').toLowerCase().includes('travel');
  const visibleTabs = [
    { key: 'home', label: t('nav_home'), icon: '🏠', show: true },
    { key: 'ledger', label: t('nav_dailyLedger'), icon: '📒', show: false },
    { key: 'collection_records', label: t('nav_collections'), icon: '💵', show: isCollection || hasFeature('collection_records') || hasFeature('payment_collection') },
    { key: 'collection_dashboard', label: t('nav_dashboard'), icon: '📊', show: isCollection },
    { key: 'add_customer', label: t('nav_addCustomer'), icon: '👤➕', show: isCollection },
    { key: 'dues', label: t('nav_khataDues'), icon: '👥', show: false },
    { key: 'vehicle', label: t('nav_vehicle'), icon: isTravelBusiness ? '🚌' : '🛺', show: hasFeature('vehicle') },
    { key: 'online_booking', label: t('trv_navBooking'), icon: '🎫', show: isTravelBusiness },
    { key: 'trips', label: t('nav_trips'), icon: '🗺️', show: hasFeature('trips') && !isTravelBusiness },
    { key: 'fuel', label: t('nav_fuelLog'), icon: '⛽', show: hasFeature('fuel') || isTravelBusiness },
    { key: 'driver_reports', label: t('nav_driverReports'), icon: '📊', show: hasFeature('trips') || isTravelBusiness },
    { key: 'inventory', label: t('nav_inventory'), icon: '📦', show: hasFeature('inventory') || hasFeature('products') },
    { key: 'daily_collection', label: t('nav_dailyCollection'), icon: '💰', show: hasFeature('inventory') || hasFeature('products') },
    { key: 'inventory_insights', label: t('nav_insights'), icon: '📊', show: hasFeature('inventory') || hasFeature('products') },
    { key: 'vendors', label: t('nav_vendors'), icon: '🏪', show: hasFeature('inventory') || hasFeature('products') },
    { key: 'sales', label: t('nav_salesPos'), icon: '🛒', show: hasFeature('sales') },
    { key: 'service_jobs', label: t('nav_jobCards'), icon: '🔧', show: hasFeature('service_jobs') },
    { key: 'building_setup', label: t('bld_navBuilding'), icon: '🏢', show: isBuildingBusiness },
    { key: 'building_floors', label: t('bld_navFloors'), icon: '🏗️', show: isBuildingBusiness },
    { key: 'building_flats', label: t('bld_navFlats'), icon: '🚪', show: isBuildingBusiness },
    { key: 'building_members', label: t('bld_navMembers'), icon: '👥', show: isBuildingBusiness },
    { key: 'building_maintenance', label: t('bld_navMaintenance'), icon: '🧾', show: isBuildingBusiness },
    { key: 'building_complaints', label: t('bld_navComplaints'), icon: '📢', show: isBuildingBusiness },
    { key: 'building_staff', label: t('bld_navStaff'), icon: '🧑‍🔧', show: isBuildingBusiness },
    { key: 'building_vendors', label: t('bld_navVendors'), icon: '🧰', show: isBuildingBusiness },
    { key: 'plan', label: t('nav_myPlan'), icon: '💳', show: true },
    { key: 'profile', label: t('nav_profile'), icon: '👤', show: true },
  ].filter((tab) => tab.show);

  // Sync active tab if currently selected tab gets disabled or is ledger/dues
  useEffect(() => {
    if (activeTab === 'ledger' || activeTab === 'dues') {
      setActiveTab(isCollection ? 'collection_records' : (visibleTabs[0]?.key || 'profile'));
    } else if (user && visibleTabs.length > 0 && !visibleTabs.some((t) => t.key === activeTab)) {
      setActiveTab(visibleTabs[0].key);
    }
  }, [user?.enabledFeatures, user?.businessType, isCollection, activeTab]);

  // Search across ALL of this collector's customers (not just today's scheduled beat) whenever the
  // customer search box has a real query, so typed searches also find older/previous records.
  useEffect(() => {
    const query = customerSearchQuery.trim();
    if (!isCollection || !user || query.length < 2) {
      setAllCustomerSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingAllCustomers(true);
      try {
        const res = await apiFetch(`/api/collection/customers?search=${encodeURIComponent(query)}&collector_id=${user.id}`);
        if (res.ok) {
          const data = await res.json();
          setAllCustomerSearchResults(data.customers || []);
        }
      } catch {
        // Supplementary search - fail quietly, today's beat search still works
      } finally {
        setSearchingAllCustomers(false);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [customerSearchQuery, isCollection, user]);

  // Fetch available plans on mount or login
  useEffect(() => {
    async function loadPlans() {
      setPlansLoading(true);
      try {
        const res = await apiFetch('/api/customer/plans');
        if (res.ok) {
          const data = await res.json();
          setAvailablePlans(data.plans || []);
        }
      } catch {
        // Fallback gracefully
      } finally {
        setPlansLoading(false);
      }
    }
    loadPlans();
  }, []);

  // Fetch available business types on mount, for the registration screen's picker
  useEffect(() => {
    async function loadBusinessTypes() {
      setBusinessTypesLoading(true);
      try {
        const res = await apiFetch('/api/business-types');
        if (res.ok) {
          const data = await res.json();
          setBusinessTypes(data.businessTypes || []);
        }
      } catch {
        // Fallback gracefully
      } finally {
        setBusinessTypesLoading(false);
      }
    }
    loadBusinessTypes();
  }, []);

  async function handleRegister() {
    setRegError('');

    if (!regFullName.trim() || !regEmail.trim() || !regDob.trim() || !regBusinessType || !regPlan) {
      setRegError('Please fill in all fields to create your account.');
      return;
    }

    setRegLoading(true);
    try {
      const response = await apiFetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: regFullName.trim(),
          email: regEmail.trim().toLowerCase(),
          dob: regDob.trim(),
          businessType: regBusinessType,
          subscriptionPlan: regPlan,
        }),
      });

      const contentType = response.headers.get('content-type') || '';
      const result = contentType.includes('application/json') ? await response.json() : await response.text();

      if (!response.ok) {
        const msg = typeof result === 'string' ? result : result?.message || 'Unable to create your account.';
        setRegError(msg);
        return;
      }

      const registeredEmail = regEmail.trim().toLowerCase();
      const registeredDob = regDob.trim();

      // Registration succeeded - switch to the login screen, pre-filled, and sign in immediately.
      setEmail(registeredEmail);
      setDob(registeredDob);
      setAuthMode('login');
      setRegFullName('');
      setRegEmail('');
      setRegDob('');
      setRegBusinessType('');
      setRegPlan('');
      await handleLogin(registeredEmail, registeredDob);
    } catch (error) {
      console.error('Registration error:', error);
      setRegError('Cannot connect to BizPilot backend. Please ensure the server is active on port 5000.');
    } finally {
      setRegLoading(false);
    }
  }

  async function handleLogin(overrideEmail?: string, overrideDob?: string): Promise<boolean> {
    setErrorMessage('');
    setAdminNotice(null);

    const loginEmail = (overrideEmail ?? email).trim();
    const loginDob = (overrideDob ?? dob).trim();

    if (!loginEmail || !loginDob) {
      setErrorMessage('Please enter both registered email and date of birth.');
      return false;
    }

    setLoading(true);
    try {
      const response = await apiFetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail.toLowerCase(),
          dob: loginDob,
        }),
      });

      const contentType = response.headers.get('content-type') || '';
      const result = contentType.includes('application/json') ? await response.json() : await response.text();

      if (!response.ok) {
        const msg = typeof result === 'string' ? result : result?.message || 'Invalid email or date of birth.';
        setErrorMessage(msg);
        return false;
      }

      const userData = result.user;

      // GUARD: If an administrator account attempts to sign in
      if (userData.userType === 'admin') {
        setAdminNotice(
          `Hello ${userData.fullName}. This mobile app is exclusively for BizPilot Customers. As an administrator, please manage operations via the BizPilot Admin Portal on the web.`
        );
        return false;
      }

      setUser({
        id: userData.id,
        fullName: userData.fullName,
        email: userData.email,
        userType: userData.userType,
        status: userData.status || 'active',
        businessType: userData.businessType || 'Local Business',
        activePlan: userData.activePlan || 'Monthly',
        dob: userData.dob || '',
        planAmount: userData.planAmount || 0,
        billingCycle: userData.billingCycle || 'monthly',
        subscriptionStatus: userData.subscriptionStatus || 'active',
        startDate: userData.startDate || '',
        endDate: userData.endDate || '',
        enabledFeatures: userData.enabledFeatures || [],
      });

      if ((userData.businessType || '').toLowerCase().includes('collection')) {
        setActiveTab('collection_records');
      }

      lastLoginCredentialsRef.current = { email: loginEmail, dob: loginDob, fullName: userData.fullName };
      return true;
    } catch (error) {
      console.error('Customer login error:', error);
      setErrorMessage('Cannot connect to BizPilot backend. Please ensure the server is active on port 5000.');
      return false;
    } finally {
      setLoading(false);
    }
  }

  function handleAddTransaction() {
    const parsedAmount = parseFloat(txAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than 0.');
      return;
    }
    if (!txParty.trim()) {
      Alert.alert('Missing Details', 'Please enter party name or purpose.');
      return;
    }

    const newTx: LedgerTransaction = {
      id: `tx-${Date.now()}`,
      type: txType,
      amount: parsedAmount,
      party: txParty.trim(),
      category: txCategory,
      paymentMode: txMode,
      date: 'Today',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setTransactions([newTx, ...transactions]);
    setShowAddModal(false);
    setTxAmount('');
    setTxParty('');
  }

  function handleAddDue() {
    const parsedAmount = parseFloat(dueAmount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount.');
      return;
    }
    if (!dueName.trim()) {
      Alert.alert('Missing Name', 'Please enter customer or vendor name.');
      return;
    }

    const newDue: CustomerDue = {
      id: `due-${Date.now()}`,
      name: dueName.trim(),
      phone: '+91 98765 43210',
      amount: parsedAmount,
      type: dueType,
      lastUpdated: 'Just now',
    };

    setDues([newDue, ...dues]);

    // Also add to collection beat schedule
    const newScheduleItem = {
      scheduleId: Date.now(),
      customerId: Date.now(),
      customerName: dueName.trim(),
      mobile: '+91 98765 43210',
      address: 'Shop 1, Market Yard',
      area: 'Market Yard',
      accountNumber: `ACC-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      routeOrder: collectionSchedule.length + 1,
      expectedAmount: parsedAmount,
      collectedAmount: 0,
      status: 'PENDING',
      totalDue: parsedAmount,
      emiAmount: parsedAmount,
      lastUpdated: 'Just now',
    };
    setCollectionSchedule(prev => [newScheduleItem, ...prev]);

    setShowAddDueModal(false);
    setDueName('');
    setDueAmount('');
    Alert.alert('Due Added', `Added ${dueName.trim()} for ₹${parsedAmount} to your records.`);
  }

  async function handleCreateCollectionCustomer() {
    if (!newCustName.trim()) {
      Alert.alert('Missing Field', 'Please enter customer name.');
      return;
    }
    if (!newCustMobile.trim()) {
      Alert.alert('Missing Field', 'Please enter customer mobile number.');
      return;
    }
    const expected = parseFloat(newCustExpected) || 1000;
    const totalDue = parseFloat(newCustTotalDue) || (expected * 4);
    const interestRate = parseFloat(newCustInterestRate) || 0;

    setAddCustLoading(true);
    try {
      const res = await apiFetch('/api/collection/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCustName.trim(),
          mobile: newCustMobile.trim(),
          address: newCustAddress.trim() || 'Local Area',
          area: newCustArea.trim() || 'Central Beat',
          expectedAmount: expected,
          totalDue: totalDue,
          interestRate: interestRate,
          collectorId: user?.id,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('Success', `Customer "${newCustName.trim()}" registered and added to today's collection beat.`);
        setNewCustName('');
        setNewCustMobile('');
        setNewCustAddress('');
        setNewCustArea('');
        setNewCustExpected('1000');
        setNewCustTotalDue('4000');
        setNewCustInterestRate('0');
        await loadCollectionData();
        setActiveTab('collection_records');
      } else {
        Alert.alert('Error', data.message || 'Failed to add customer.');
      }
    } catch {
      Alert.alert('Network Error', 'Cannot connect to backend server.');
    } finally {
      setAddCustLoading(false);
    }
  }

  function handleOpenEditCustomer(item: any) {
    setEditingCustItem(item);
    setEditCustName(item.customerName || item.customer_name || item.name || '');
    setEditCustMobile(item.mobile || item.phone || '');
    setEditCustAddress(item.address || '');
    setEditCustArea(item.area || item.area_name || '');
    setEditCustExpected(String(item.expectedAmount || item.expected_amount || 1000));
    setEditCustTotalDue(String(item.totalDue || item.total_due || 4000));
    setEditCustInterestRate(String(item.interestRate ?? item.interest_rate ?? 0));
    setShowEditCustModal(true);
  }

  async function handleSaveEditCustomer() {
    if (!editingCustItem) return;
    const custId = editingCustItem.customerId || editingCustItem.customer_id || editingCustItem.id;
    if (!editCustName.trim()) {
      Alert.alert('Missing Field', 'Please enter customer name.');
      return;
    }
    const expected = parseFloat(editCustExpected) || 1000;
    const totalDue = parseFloat(editCustTotalDue) || 4000;
    const interestRate = parseFloat(editCustInterestRate) || 0;

    setEditCustLoading(true);
    try {
      const res = await apiFetch(`/api/collection/customers/${custId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editCustName.trim(),
          mobile: editCustMobile.trim(),
          address: editCustAddress.trim(),
          area: editCustArea.trim(),
          expectedAmount: expected,
          totalDue: totalDue,
          interestRate: interestRate,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCollectionSchedule(prev => prev.map(item => {
          const id = item.customerId || item.customer_id || item.id;
          if (id === custId) {
            return {
              ...item,
              customerName: editCustName.trim(),
              customer_name: editCustName.trim(),
              name: editCustName.trim(),
              mobile: editCustMobile.trim(),
              phone: editCustMobile.trim(),
              address: editCustAddress.trim(),
              area: editCustArea.trim(),
              expectedAmount: expected,
              expected_amount: expected,
              totalDue: totalDue,
              total_due: totalDue,
              interestRate: interestRate,
              interest_rate: interestRate,
              lastUpdated: 'Just now',
              last_updated: 'Just now',
              updatedAt: new Date().toISOString(),
            };
          }
          return item;
        }));
        Alert.alert('Success', `Customer "${editCustName.trim()}" updated successfully.`);
        setShowEditCustModal(false);
        setEditingCustItem(null);
        await loadCollectionData();
      } else {
        Alert.alert('Error', data.message || 'Failed to update customer.');
      }
    } catch {
      Alert.alert('Network Error', 'Cannot connect to backend server.');
    } finally {
      setEditCustLoading(false);
    }
  }

  function handleDeleteCustomer(item: any) {
    const custId = item.customerId || item.customer_id || item.id;
    const custName = item.customerName || item.customer_name || item.name || 'Customer';

    Alert.alert(
      'Delete Customer',
      `Are you sure you want to delete ${custName}? This will remove them from today's collection beat and erase their pending schedule.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setCollectionSchedule(prev => prev.filter(c => (c.customerId || c.customer_id || c.id) !== custId));
              const res = await apiFetch(`/api/collection/customers/${custId}`, {
                method: 'DELETE',
              });
              if (res.ok) {
                Alert.alert('Deleted', `${custName} has been deleted.`);
                await loadCollectionData();
              } else {
                const data = await res.json();
                Alert.alert('Error', data.message || 'Could not delete customer.');
                await loadCollectionData();
              }
            } catch {
              Alert.alert('Network Error', 'Cannot connect to backend server.');
            }
          },
        },
      ]
    );
  }

  async function handleOpenCustomerPassbook(item: any) {
    setSelectedPassbookCustomer(item);
    setShowCustomerPassbookModal(true);
    setCalendarMonthOffset(0);
    setPassbookLoading(true);
    const custId = item.customerId || item.customer_id || item.id;
    try {
      const res = await apiFetch(`/api/collection/customer/${custId}/history`);
      if (res.ok) {
        const data = await res.json();
        setPassbookData(data);
      } else {
        // Fallback passbook structure
        setPassbookData({
          customerId: custId,
          customerName: item.customerName || item.customer_name || item.name,
          accountNumber: item.accountNumber || `ACC-${custId}`,
          mobile: item.mobile || item.phone,
          address: item.address,
          area: item.area,
          summary: {
            totalPaidTillNow: item.collectedAmount || (item.status === 'COLLECTED' ? (item.expectedAmount || 1000) : 0),
            totalGivenTillNow: 0,
            currentBalance: item.totalDue || 4000,
          },
          transactions: item.status === 'COLLECTED' ? [{
            id: 1,
            entryType: 'IN',
            amount: item.collectedAmount || item.expectedAmount || 1000,
            paymentMethod: item.paymentMethod || 'Cash',
            reference: '',
            notes: 'Beat collection payment',
            paymentDate: new Date().toISOString(),
            receiptNumber: item.receiptNumber || 'REC-TODAY',
            verified: true,
          }] : [],
        });
      }
    } catch {
      setPassbookData({
        customerId: custId,
        customerName: item.customerName || item.customer_name || item.name,
        accountNumber: item.accountNumber || `ACC-${custId}`,
        mobile: item.mobile || item.phone,
        summary: {
          totalPaidTillNow: item.collectedAmount || 0,
          totalGivenTillNow: 0,
          currentBalance: item.totalDue || 4000,
        },
        transactions: [],
      });
    } finally {
      setPassbookLoading(false);
    }
  }

  async function handleOpenCustomerCalendar(item: any) {
    setCalendarCustomer(item);
    setCalendarMonthOffset(0);
    setShowCalendarModal(true);
    setCalendarLoading(true);
    const custId = item.customerId || item.customer_id || item.id;
    try {
      const res = await apiFetch(`/api/collection/customer/${custId}/history`);
      if (res.ok) {
        const data = await res.json();
        setCalendarScheduleDays(data.scheduleDays || []);
      } else {
        setCalendarScheduleDays([]);
      }
    } catch {
      setCalendarScheduleDays([]);
    } finally {
      setCalendarLoading(false);
    }
  }

  async function handleOpenCloseAccount(item: any) {
    const custId = item.customerId || item.customer_id || item.id;
    setCloseAccountNotes('');
    setClosingSummary(null);
    setShowCloseAccountModal(true);
    setClosingSummaryLoading(true);
    try {
      const res = await apiFetch(`/api/collection/customer/${custId}/closing-summary`);
      const data = await res.json();
      if (res.ok) {
        setClosingSummary(data);
      } else {
        Alert.alert('Error', data.message || 'Unable to load closing summary.');
        setShowCloseAccountModal(false);
      }
    } catch {
      Alert.alert('Network Error', 'Cannot connect to the backend to load the closing summary.');
      setShowCloseAccountModal(false);
    } finally {
      setClosingSummaryLoading(false);
    }
  }

  function handleConfirmCloseAccount() {
    if (!closingSummary) return;
    const custId = closingSummary.customer.id;
    const outstandingNote = closingSummary.finalSettlementAmount > 0
      ? ` This will write off ₹${Number(closingSummary.finalSettlementAmount).toLocaleString()} still outstanding (₹${Number(closingSummary.outstandingPrincipal).toLocaleString()} principal + ₹${Number(closingSummary.interestAmount).toLocaleString()} interest) as uncollected.`
      : ' The account is fully settled with nothing outstanding.';
    Alert.alert(
      'Close This Account?',
      `Total collected over this account's lifetime: ₹${Number(closingSummary.netPaid).toLocaleString()}.${outstandingNote} This marks ${closingSummary.customer.name} as inactive. This cannot be undone from here.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Account',
          style: 'destructive',
          onPress: async () => {
            setCloseAccountSubmitting(true);
            try {
              const res = await apiFetch(`/api/collection/customer/${custId}/close`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: closeAccountNotes.trim() }),
              });
              const data = await res.json();
              if (res.ok) {
                setShowCloseAccountModal(false);
                setShowCustomerPassbookModal(false);
                Alert.alert('Account Closed', `${closingSummary.customer.name}'s account has been closed and settled.`);
                await loadCollectionData();
              } else {
                Alert.alert('Error', data.message || 'Unable to close this account.');
              }
            } catch {
              Alert.alert('Network Error', 'Cannot connect to the backend to close this account.');
            } finally {
              setCloseAccountSubmitting(false);
            }
          },
        },
      ]
    );
  }

  function renderMonthCalendar(scheduleDaysArr: any[]) {
    const scheduleByDate: Record<string, any> = {};
    (scheduleDaysArr || []).forEach((d: any) => {
      scheduleByDate[d.date] = d;
    });

    const now = new Date();
    const viewDate = new Date(now.getFullYear(), now.getMonth() + calendarMonthOffset, 1);
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const monthLabel = viewDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = getTodayDateString();

    const cells: (number | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    return (
      <View style={{ backgroundColor: colors.page, borderRadius: 12, padding: 12 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Pressable
            onPress={() => setCalendarMonthOffset((v) => v - 1)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ padding: 4 }}>
            <Text style={{ fontSize: 16, color: colors.brand, fontWeight: '800' }}>‹</Text>
          </Pressable>
          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>📅 {monthLabel}</Text>
          <Pressable
            onPress={() => setCalendarMonthOffset((v) => v + 1)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={{ padding: 4 }}>
            <Text style={{ fontSize: 16, color: colors.brand, fontWeight: '800' }}>›</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', marginBottom: 4 }}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((wd) => (
            <Text key={wd} style={{ flex: 1, textAlign: 'center', fontSize: 9, fontWeight: '700', color: colors.muted }}>
              {wd}
            </Text>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cells.map((day, idx) => {
            if (day === null) {
              return <View key={`blank-${idx}`} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
            }
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const sched = scheduleByDate[dateStr];
            const isToday = dateStr === todayStr;
            let bgColor = 'transparent';
            let textColor = colors.muted;
            if (sched) {
              if (sched.status === 'COLLECTED') {
                bgColor = colors.greenBg;
                textColor = colors.greenDark;
              } else {
                bgColor = colors.redBg;
                textColor = colors.red;
              }
            }
            return (
              <View key={dateStr} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
                <View
                  style={{
                    flex: 1,
                    borderRadius: 6,
                    backgroundColor: bgColor,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: isToday ? 1.5 : 0,
                    borderColor: colors.brand,
                  }}>
                  <Text style={{ fontSize: 11, fontWeight: sched ? '800' : '500', color: textColor }}>{day}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: 14, marginTop: 10, justifyContent: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.greenDark }} />
            <Text style={{ fontSize: 10, color: colors.slate }}>Paid</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red }} />
            <Text style={{ fontSize: 10, color: colors.slate }}>Pending / Missed</Text>
          </View>
        </View>
      </View>
    );
  }

  function handleDeleteEntry(tx: any) {
    const isTxIn = (tx.entryType || tx.entry_type || 'IN').toUpperCase() === 'IN';
    Alert.alert(
      'Delete This Entry?',
      `This will delete only this ${isTxIn ? 'Cash In' : 'Cash Out'} entry of ₹${Number(tx.amount).toLocaleString()} and reverse its effect on the customer's balance. Other entries are not affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiFetch(`/api/collection/entries/${tx.id}`, { method: 'DELETE' });
              const data = await res.json();
              if (!res.ok) {
                Alert.alert('Error', data.message || 'Unable to delete this entry.');
                return;
              }
              if (selectedPassbookCustomer) {
                await handleOpenCustomerPassbook(selectedPassbookCustomer);
              }
              await loadCollectionData();
              Alert.alert('Deleted', 'The entry was removed and the balance updated.');
            } catch {
              Alert.alert('Network Error', 'Cannot connect to the backend to delete this entry.');
            }
          },
        },
      ]
    );
  }

  function handleOpenAddEntry(type: 'IN' | 'OUT') {
    setEntryType(type);
    setEntryAmount('');
    setEntryPaymentMode('Cash');
    setEntryRef('');
    setEntryNotes('');
    setShowEntryModal(true);
  }

  async function handleSaveCustomerEntry() {
    if (!selectedPassbookCustomer) return;
    const custId = selectedPassbookCustomer.customerId || selectedPassbookCustomer.customer_id || selectedPassbookCustomer.id;
    const amt = parseFloat(entryAmount);
    if (isNaN(amt) || amt <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than ₹0.');
      return;
    }
    if ((entryPaymentMode === 'UPI' || entryPaymentMode === 'Bank Transfer') && !entryRef.trim()) {
      Alert.alert('Reference Required', 'Transaction Reference / UTR is mandatory for UPI and Bank Transfer.');
      return;
    }

    setEntrySubmitting(true);
    try {
      const res = await apiFetch(`/api/collection/customer/${custId}/entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_type: entryType,
          amount: amt,
          payment_method: entryPaymentMode === 'Bank Transfer' ? 'BANK_TRANSFER' : entryPaymentMode.toUpperCase(),
          transaction_ref: entryRef.trim(),
          notes: entryNotes.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.success !== false) {
        Alert.alert(
          'Recorded!',
          `${entryType === 'IN' ? 'Cash In (Payment)' : 'Cash Out (Given)'} of ₹${amt.toLocaleString()} recorded successfully.`
        );
        setShowEntryModal(false);
        // Refresh customer passbook
        await handleOpenCustomerPassbook(selectedPassbookCustomer);
        // Refresh today's beat & dashboard
        await loadCollectionData();
      } else {
        Alert.alert('Error', data.message || 'Failed to save transaction entry.');
      }
    } catch {
      Alert.alert('Network Error', 'Cannot connect to backend server.');
    } finally {
      setEntrySubmitting(false);
    }
  }

  async function loadDashboardData() {
    if (!user) return;
    setDashLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('filter_type', dashFilterType);
      const collectorId = user.id || 36;
      params.append('collector_id', String(collectorId));

      if (dashFilterType === 'date') {
        params.append('date', dashSelectedDate);
      } else if (dashFilterType === 'monthly') {
        params.append('month', dashSelectedMonth);
      } else if (dashFilterType === 'quarterly') {
        params.append('quarter', dashSelectedQuarter);
      } else if (dashFilterType === 'yearly') {
        params.append('year', dashSelectedYear);
      }
      if (dashSubFilter && dashSubFilter !== 'ALL') {
        params.append('sub_filter', dashSubFilter);
      }
      if (dashCustomerSearch.trim()) {
        params.append('search', dashCustomerSearch.trim());
      }
      const res = await apiFetch(`/api/collection/dashboard-analytics?${params.toString()}`, {
        headers: {
          'X-User-Id': String(collectorId),
          'X-User-Email': user.email || 'riya@gmail.com',
          'X-User-Type': user.userType || 'customer',
        },
      });
      if (res.ok) {
        const data = await res.json();
        // Normalize metrics for resilient display
        if (data.metrics) {
          data.targetAmount = data.metrics.targetAmount;
          data.collectedAmount = data.metrics.collectedAmount;
          data.remainingAmount = data.metrics.remainingAmount;
          data.collectionRate = data.metrics.collectionPercentage;
          data.people = data.metrics.people;
          data.paymentMethods = data.metrics.paymentMethods;
        }
        if (!data.period && data.periodLabel) {
          data.period = { label: data.periodLabel, sublabel: data.periodSublabel };
        }
        setDashboardData(data);
      }
    } catch (err) {
      console.error('Failed to load dashboard analytics:', err);
    } finally {
      setDashLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'collection_dashboard' && user) {
      loadDashboardData();
    }
  }, [
    activeTab,
    dashFilterType,
    dashSelectedDate,
    dashSelectedMonth,
    dashSelectedQuarter,
    dashSelectedYear,
    dashSubFilter,
    dashCustomerSearch,
  ]);

  function handleSettleDue(id: string) {
    const dueItem = dues.find(d => d.id === id);
    if (!dueItem) return;

    // Automatically record settled transaction in ledger
    const newTx: LedgerTransaction = {
      id: `tx-${Date.now()}`,
      type: dueItem.type === 'to_collect' ? 'in' : 'out',
      amount: dueItem.amount,
      party: `${dueItem.name} (Settled Khata)`,
      category: 'Khata Settlement',
      paymentMode: 'Cash',
      date: 'Today',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setTransactions([newTx, ...transactions]);
    setDues(dues.filter(d => d.id !== id));
    Alert.alert('Settled!', `Recorded ₹${dueItem.amount} in your daily ledger.`);
  }

  useEffect(() => {
    if (!user?.id || !hasFeature('trips')) return;
    (async () => {
      try {
        const res = await apiFetch(`/api/driver/upi-qr?owner_id=${user.id}`);
        if (res.ok) {
          const data = await res.json();
          setDriverQr(data.qrImage || null);
        }
      } catch (e) {
        console.error('Error loading UPI QR:', e);
      }
    })();
  }, [user?.id]);

  async function handlePickQr() {
    if (!user?.id) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('common_error'), t('drv_permissionDenied'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.6,
      allowsEditing: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset = result.assets[0];
    const dataUri = `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
    setQrSaving(true);
    try {
      const res = await apiFetch('/api/driver/upi-qr', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, qrImage: dataUri }),
      });
      const data = await res.json();
      if (res.ok) {
        setDriverQr(dataUri);
        Alert.alert(t('common_success'), t('drv_qrSaved'));
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setQrSaving(false);
    }
  }

  function handleRemoveQr() {
    if (!user?.id) return;
    Alert.alert(t('drv_removeQr'), t('drv_removeQrConfirm'), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('common_delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await apiFetch(`/api/driver/upi-qr?owner_id=${user.id}`, { method: 'DELETE' });
            if (res.ok) {
              setDriverQr(null);
              setShowQrModal(false);
            }
          } catch {
            Alert.alert(t('common_error'), t('common_networkError'));
          }
        },
      },
    ]);
  }

  async function loadDriverTrips() {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/driver/trips?owner_id=${user.id}`);
      if (!res.ok) return;
      const data = await res.json();
      setTrips((data.trips || []).map((tr: any): DriverTrip => ({
        id: tr.id,
        tripDate: 'Today',
        time: new Date(tr.tripTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        tripTimeMs: new Date(tr.tripTime).getTime(),
        startKm: tr.startKm ?? 0,
        endKm: tr.endKm ?? 0,
        distanceKm: tr.distanceKm || 0,
        fare: tr.fare,
        paymentMode: tr.paymentMode,
        route: tr.route || (tr.source === 'QR' ? 'QR payment' : ''),
        locationName: tr.locationName || '',
        latitude: tr.latitude ?? null,
        longitude: tr.longitude ?? null,
      })));
    } catch (e) {
      console.error('Error loading trips:', e);
    }
  }

  async function loadDriverTripsHistory() {
    if (!user?.id) return;
    try {
      // Fetches 8 weeks so the earnings-vs-usual comparison has enough same-weekday
      // history; the last-7-days chart simply filters this down to its own window.
      const res = await apiFetch(`/api/driver/trips?owner_id=${user.id}&days=56`);
      if (!res.ok) return;
      const data = await res.json();
      setDriverTripsHistory((data.trips || []).map((tr: any) => ({
        fare: tr.fare,
        paymentMode: tr.paymentMode,
        tripTimeMs: new Date(tr.tripTime).getTime(),
        route: tr.route || '',
        locationName: tr.locationName || '',
      })));
    } catch (e) {
      console.error('Error loading trip history:', e);
    }
  }

  useEffect(() => {
    if (user?.id && hasFeature('trips') && (activeTab === 'trips' || activeTab === 'home')) loadDriverTrips();
    if (user?.id && hasFeature('trips') && activeTab === 'home') loadDriverTripsHistory();
  }, [user?.id, activeTab]);

  async function loadDriverFuelLogs() {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/driver/fuel-logs?owner_id=${user.id}`);
      if (!res.ok) return;
      const data = await res.json();
      setFuelLogs((data.fuelLogs || []).map((f: any): FuelLog => ({
        id: f.id,
        date: new Date(f.fuelTime).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }),
        fuelTimeMs: new Date(f.fuelTime).getTime(),
        fuelType: f.fuelType,
        quantity: f.quantity || 0,
        rate: f.rate || 0,
        totalCost: f.totalCost || 0,
        odometer: f.odometer ?? 0,
        station: f.station || '',
      })));
    } catch (e) {
      console.error('Error loading fuel logs:', e);
    }
  }

  async function loadDriverFuelLogsHistory() {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/driver/fuel-logs?owner_id=${user.id}&days=7`);
      if (!res.ok) return;
      const data = await res.json();
      setDriverFuelHistory((data.fuelLogs || []).map((f: any) => ({
        totalCost: f.totalCost || 0,
        fuelTimeMs: new Date(f.fuelTime).getTime(),
      })));
    } catch (e) {
      console.error('Error loading fuel log history:', e);
    }
  }

  useEffect(() => {
    if (user?.id && !isTravelBusiness && hasFeature('fuel') && (activeTab === 'fuel' || activeTab === 'home')) loadDriverFuelLogs();
    if (user?.id && !isTravelBusiness && hasFeature('fuel') && activeTab === 'fuel') loadDriverFuelLogsHistory();
  }, [user?.id, activeTab]);

  async function loadDriverReportData() {
    if (!user?.id) return;
    setReportLoading(true);
    try {
      const rangeQuery =
        reportPeriod === 'week'
          ? 'days=7'
          : reportPeriod === 'month'
          ? 'days=30'
          : `start_date=${reportCustomStart}&end_date=${reportCustomEnd}`;

      if (isTravelBusiness) {
        const [bookingsRes, fuelRes] = await Promise.all([
          apiFetch(`/api/travel/bookings?owner_id=${user.id}&${rangeQuery}`),
          apiFetch(`/api/travel/fuel-logs?owner_id=${user.id}&${rangeQuery}`),
        ]);
        const bookingsData = bookingsRes.ok ? await bookingsRes.json() : { bookings: [] };
        const fuelData = fuelRes.ok ? await fuelRes.json() : { fuelLogs: [] };

        setReportTrips((bookingsData.bookings || []).map((b: any) => ({
          fare: b.fare,
          // "Online" is still a digital payment, same as UPI, for the purposes of
          // this cash-vs-digital mix chart (which only knows two categories).
          paymentMode: b.paymentMode === 'Cash' ? 'Cash' : 'UPI',
          tripTimeMs: new Date(b.bookedAt).getTime(),
          route: b.route || '',
          locationName: '',
        })));
        setReportFuelLogs((fuelData.fuelLogs || []).map((f: any) => ({
          totalCost: f.totalCost || 0,
          fuelTimeMs: new Date(`${f.fuelDate}T00:00:00`).getTime(),
          fuelType: f.fuelType,
          station: f.station || '',
        })));
      } else {
        const [tripsRes, fuelRes] = await Promise.all([
          apiFetch(`/api/driver/trips?owner_id=${user.id}&${rangeQuery}`),
          apiFetch(`/api/driver/fuel-logs?owner_id=${user.id}&${rangeQuery}`),
        ]);
        const tripsData = tripsRes.ok ? await tripsRes.json() : { trips: [] };
        const fuelData = fuelRes.ok ? await fuelRes.json() : { fuelLogs: [] };

        setReportTrips((tripsData.trips || []).map((tr: any) => ({
          fare: tr.fare,
          paymentMode: tr.paymentMode,
          tripTimeMs: new Date(tr.tripTime).getTime(),
          route: tr.route || '',
          locationName: tr.locationName || '',
        })));
        setReportFuelLogs((fuelData.fuelLogs || []).map((f: any) => ({
          totalCost: f.totalCost || 0,
          fuelTimeMs: new Date(f.fuelTime).getTime(),
          fuelType: f.fuelType,
          station: f.station || '',
        })));
      }
    } catch (e) {
      console.error('Error loading report data:', e);
    } finally {
      setReportLoading(false);
    }
  }

  useEffect(() => {
    if (user?.id && (hasFeature('trips') || isTravelBusiness) && activeTab === 'driver_reports') {
      if (reportPeriod !== 'custom' || (reportCustomStart && reportCustomEnd && reportCustomStart <= reportCustomEnd)) {
        loadDriverReportData();
      }
    }
  }, [user?.id, activeTab, reportPeriod, reportCustomStart, reportCustomEnd]);

  function openReportStartPicker() {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(reportCustomStart) ? new Date(reportCustomStart + 'T00:00:00') : new Date();
    setReportStartCalendarMonth(isNaN(parsed.getTime()) ? new Date() : parsed);
    setShowReportStartPicker(true);
  }

  function openReportEndPicker() {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(reportCustomEnd) ? new Date(reportCustomEnd + 'T00:00:00') : new Date();
    setReportEndCalendarMonth(isNaN(parsed.getTime()) ? new Date() : parsed);
    setShowReportEndPicker(true);
  }

  function shiftReportStartCalendarMonth(delta: number) {
    setReportStartCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  function shiftReportEndCalendarMonth(delta: number) {
    setReportEndCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  // ---- Driver dashboard charts (Payment Mix + Last 7 Days Earnings) ----
  function renderPaymentMixChart(cashTotal: number, upiTotal: number) {
    const total = cashTotal + upiTotal;
    if (total <= 0) {
      return <Text style={styles.emptyStateText}>{t('drv_noPaymentsYet')}</Text>;
    }
    const upiPct = Math.round((upiTotal / total) * 100);
    const cashPct = 100 - upiPct;
    return (
      <View>
        <View style={{ flexDirection: 'row', height: 20, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.border }}>
          <View style={{ flex: upiTotal, backgroundColor: DASH_UPI_COLOR }} />
          {cashTotal > 0 && upiTotal > 0 && <View style={{ width: 2, backgroundColor: colors.panel }} />}
          <View style={{ flex: cashTotal, backgroundColor: DASH_CASH_COLOR }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: DASH_UPI_COLOR }} />
            <Text style={{ fontSize: 12, color: colors.slate, fontWeight: '600' }}>
              {t('drv_recordUpi')} · ₹{upiTotal.toLocaleString()} ({upiPct}%)
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: DASH_CASH_COLOR }} />
            <Text style={{ fontSize: 12, color: colors.slate, fontWeight: '600' }}>
              {t('drv_recordCash')} · ₹{cashTotal.toLocaleString()} ({cashPct}%)
            </Text>
          </View>
        </View>
      </View>
    );
  }

  function renderEarningsTrendChart(
    days: { label: string; amount: number }[],
    selectedDay: number | null = selectedEarningsDay,
    onSelectDay: (updater: (prev: number | null) => number | null) => void = setSelectedEarningsDay
  ) {
    const total = days.reduce((sum, d) => sum + d.amount, 0);
    if (total <= 0) {
      return <Text style={styles.emptyStateText}>{t('drv_noPaymentsYet')}</Text>;
    }
    const W = 300;
    const H = 130;
    const topPad = 22;
    const bottomPad = 20;
    const chartTop = topPad;
    const baselineY = H - bottomPad;
    const maxAmount = Math.max(...days.map(d => d.amount), 1);
    const slotWidth = W / days.length;
    const barWidth = Math.min(24, slotWidth - 10);
    const maxIndex = days.reduce((best, d, i) => (d.amount > days[best].amount ? i : best), 0);

    return (
      <View>
        {selectedDay !== null && days[selectedDay] && (
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.navy, marginBottom: 6 }}>
            {days[selectedDay].label}: ₹{days[selectedDay].amount.toLocaleString()}
          </Text>
        )}
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
          <SvgLine x1={0} y1={baselineY} x2={W} y2={baselineY} stroke={colors.border} strokeWidth={1} />
          {days.map((d, i) => {
            const barHeight = (d.amount / maxAmount) * (baselineY - chartTop);
            const x = i * slotWidth + (slotWidth - barWidth) / 2;
            const topY = baselineY - barHeight;
            const isSelected = selectedDay === i;
            return (
              <React.Fragment key={i}>
                {d.amount > 0 && (
                  <Path
                    d={roundedTopBarPath(x, topY, barWidth, barHeight, 4)}
                    fill={isSelected ? colors.brandDark : DASH_SEQUENTIAL_COLOR}
                    onPress={() => onSelectDay(prev => (prev === i ? null : i))}
                  />
                )}
                {i === maxIndex && d.amount > 0 && (
                  <SvgText x={x + barWidth / 2} y={topY - 6} fontSize={10} fontWeight="700" fill={colors.slate} textAnchor="middle">
                    {`₹${d.amount.toLocaleString()}`}
                  </SvgText>
                )}
                <SvgText x={x + barWidth / 2} y={baselineY + 14} fontSize={10} fill={colors.muted} textAnchor="middle">
                  {d.label}
                </SvgText>
              </React.Fragment>
            );
          })}
        </Svg>
      </View>
    );
  }

  // ---- Auto-record UPI credits from bank SMS (Android only, needs the installed app build) ----
  const smsKey = (suffix: string) => `smsAuto_${user?.id}_${suffix}`;

  useEffect(() => {
    if (!user?.id || !hasFeature('trips') || Platform.OS !== 'android') return;
    AsyncStorage.getItem(smsKey('enabled')).then(v => setSmsAutoRecord(v === '1')).catch(() => {});
  }, [user?.id]);

  async function handleToggleSmsAutoRecord(value: boolean) {
    if (!user?.id) return;
    if (!value) {
      setSmsAutoRecord(false);
      setSmsStatus('');
      AsyncStorage.setItem(smsKey('enabled'), '0').catch(() => {});
      return;
    }
    if (!isSmsReaderAvailable) {
      Alert.alert(t('common_error'), t('drv_smsNeedsBuild'));
      return;
    }
    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS);
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      Alert.alert(t('common_error'), t('drv_smsPermission'));
      return;
    }
    // Only SMS that arrive from now on are considered - old messages are never imported.
    await AsyncStorage.multiSet([[smsKey('enabled'), '1'], [smsKey('cursor'), String(Date.now())]]);
    setSmsAutoRecord(true);
    scanPaymentSms();
  }

  async function scanPaymentSms() {
    if (!user?.id || smsScanning.current || !isSmsReaderAvailable) return;
    smsScanning.current = true;
    try {
      const since = parseInt((await AsyncStorage.getItem(smsKey('cursor'))) || '0', 10) || Date.now();
      const messages = (await readInbox(since, 40)).sort((a, b) => a.date - b.date);
      let recorded = 0;
      let cursor = since;
      for (const sms of messages) {
        const found = detectUpiCredit(sms.body);
        if (found) {
          const res = await apiFetch('/api/driver/trips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ownerId: user.id,
              route: found.payer ? `UPI from ${found.payer}` : 'UPI payment',
              fare: found.amount,
              paymentMode: 'UPI',
              externalRef: found.ref ? `upi:${found.ref}` : `sms:${sms.id}:${sms.date}`,
              tripTimeMs: sms.date,
            }),
          });
          if (!res.ok) break; // server/network trouble: keep the cursor so we retry this SMS next time
          if (res.status === 201) {
            recorded += 1;
            setSmsStatus(t('drv_smsRecorded', { amount: found.amount.toLocaleString() }));
          }
        }
        cursor = Math.max(cursor, sms.date);
      }
      if (cursor > since) await AsyncStorage.setItem(smsKey('cursor'), String(cursor));
      if (recorded > 0) loadDriverTrips();
    } catch (e) {
      console.error('SMS scan failed:', e);
    } finally {
      smsScanning.current = false;
    }
  }

  useEffect(() => {
    if (!user?.id || !smsAutoRecord) return;
    scanPaymentSms();
    const timer = setInterval(scanPaymentSms, 15000);
    return () => clearInterval(timer);
  }, [user?.id, smsAutoRecord]);

  function handleDeleteTrip(trip: DriverTrip) {
    if (!user?.id) return;
    Alert.alert(t('drv_deleteTripTitle'), t('drv_deleteTripConfirm', { amount: trip.fare }), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('common_delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await apiFetch(`/api/driver/trips/${trip.id}?owner_id=${user.id}`, { method: 'DELETE' });
            if (res.ok) loadDriverTrips();
          } catch {
            Alert.alert(t('common_error'), t('common_networkError'));
          }
        },
      },
    ]);
  }

  // ---- Travels Bus Booking Online: Trips + Seat Map ----
  const [travelTrips, setTravelTrips] = useState<any[]>([]);
  const [fareSuggestions, setFareSuggestions] = useState<{
    tripId: string; route: string; travelDate: string; daysLeft: number;
    currentFillPct: number; historicalFillPct: number; signal: 'high_demand' | 'low_demand'; currentFare: number;
  }[]>([]);
  const [travelSelectedTrip, setTravelSelectedTrip] = useState<any>(null);
  const [travelSeats, setTravelSeats] = useState<any[]>([]);
  const [travelSeatsLoading, setTravelSeatsLoading] = useState(false);
  const [showSeatMap, setShowSeatMap] = useState(false);
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);

  const [showNewTripModal, setShowNewTripModal] = useState(false);
  const [tripRouteInput, setTripRouteInput] = useState('');
  const [tripDateInput, setTripDateInput] = useState('');
  const [tripTimeInput, setTripTimeInput] = useState('');
  const [tripBusNumberInput, setTripBusNumberInput] = useState('');
  const [routeStopSuggestions, setRouteStopSuggestions] = useState<string[]>([]);
  const [newStopInput, setNewStopInput] = useState('');
  const [addingStop, setAddingStop] = useState(false);
  const [tripBusTypeInput, setTripBusTypeInput] = useState<'seater' | 'sleeper' | 'ertiga'>('seater');
  const [showTripBusTypeDropdown, setShowTripBusTypeDropdown] = useState(false);
  const [showTripBusDropdown, setShowTripBusDropdown] = useState(false);
  const [tripSeaterCountInput, setTripSeaterCountInput] = useState('40');
  const [tripSleeperCountInput, setTripSleeperCountInput] = useState('0');
  const [tripFareInput, setTripFareInput] = useState('');
  const [newTripSaving, setNewTripSaving] = useState(false);
  const [showTripDatePicker, setShowTripDatePicker] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [tripListDateFilter, setTripListDateFilter] = useState('');
  const [showTripListDateFilter, setShowTripListDateFilter] = useState(false);
  const [filterCalendarMonth, setFilterCalendarMonth] = useState(new Date());

  const [showBookSeatModal, setShowBookSeatModal] = useState(false);
  const [showSeatDetailModal, setShowSeatDetailModal] = useState(false);
  const [activeSeat, setActiveSeat] = useState<any>(null);
  const [draftingReminder, setDraftingReminder] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderDraftText, setReminderDraftText] = useState('');
  const [reminderMobile, setReminderMobile] = useState('');
  const [selectedSeatNumbers, setSelectedSeatNumbers] = useState<number[]>([]);
  const [bookPassengerName, setBookPassengerName] = useState('');
  const [bookMobile, setBookMobile] = useState('');
  const [bookFare, setBookFare] = useState('');
  const [bookPaymentMode, setBookPaymentMode] = useState<'Cash' | 'UPI' | 'Online'>('Cash');
  const [bookPaymentStatus, setBookPaymentStatus] = useState<'paid' | 'pending'>('paid');
  const [bookPickupLocation, setBookPickupLocation] = useState('');
  const [bookDropLocation, setBookDropLocation] = useState('');
  const [showBookPickupDropdown, setShowBookPickupDropdown] = useState(false);
  const [showBookDropDropdown, setShowBookDropDropdown] = useState(false);
  const [bookSaving, setBookSaving] = useState(false);
  const [paymentUpdateSaving, setPaymentUpdateSaving] = useState(false);

  // Travel Vehicles (multi-bus fleet) state
  const [travelVehicles, setTravelVehicles] = useState<any[]>([]);
  const [travelVehiclesLoading, setTravelVehiclesLoading] = useState(false);
  const [selectedTravelVehicle, setSelectedTravelVehicle] = useState<any>(null);
  const [showAddVehicleModal, setShowAddVehicleModal] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [vehRegInput, setVehRegInput] = useState('');
  const [vehModelInput, setVehModelInput] = useState('');
  const [vehBusTypeInput, setVehBusTypeInput] = useState<'seater' | 'sleeper' | 'ertiga'>('seater');
  const [showVehBusTypeDropdown, setShowVehBusTypeDropdown] = useState(false);

  function vehicleTypeIconLabel(opt: 'seater' | 'sleeper' | 'ertiga') {
    if (opt === 'sleeper') return `🛏️ ${t('trv_sleeper')}`;
    if (opt === 'ertiga') return `🚙 ${t('trv_ertiga')}`;
    return `💺 ${t('trv_seater')}`;
  }
  const [vehFuelTypeInput, setVehFuelTypeInput] = useState<'Diesel' | 'Petrol' | 'CNG' | 'Electric'>('Diesel');
  const [vehRegDateInput, setVehRegDateInput] = useState('');
  const [vehTotalKmInput, setVehTotalKmInput] = useState('');
  const [vehInsuranceExpiryInput, setVehInsuranceExpiryInput] = useState('');
  const [vehFitnessExpiryInput, setVehFitnessExpiryInput] = useState('');
  const [vehPucExpiryInput, setVehPucExpiryInput] = useState('');
  const [vehSaving, setVehSaving] = useState(false);

  async function loadTravelVehicles() {
    if (!user?.id) return;
    setTravelVehiclesLoading(true);
    try {
      const res = await apiFetch(`/api/travel/vehicles?owner_id=${user.id}`);
      if (res.ok) setTravelVehicles((await res.json()).vehicles || []);
    } catch (e) {
      console.error('Error loading vehicles:', e);
    } finally {
      setTravelVehiclesLoading(false);
    }
  }

  useEffect(() => {
    if (user?.id && isTravelBusiness && (activeTab === 'vehicle' || activeTab === 'home')) loadTravelVehicles();
  }, [user?.id, activeTab, isTravelBusiness]);

  function handleOpenAddTravelVehicle() {
    setEditingVehicleId(null);
    setVehRegInput('');
    setVehModelInput('');
    setVehBusTypeInput('seater');
    setVehFuelTypeInput('Diesel');
    setVehRegDateInput('');
    setVehTotalKmInput('');
    setVehInsuranceExpiryInput('');
    setVehFitnessExpiryInput('');
    setVehPucExpiryInput('');
    setShowAddVehicleModal(true);
  }

  function handleOpenEditTravelVehicle(v: any) {
    setEditingVehicleId(v.id);
    setVehRegInput(v.regNumber);
    setVehModelInput(v.model);
    setVehBusTypeInput(v.busType === 'sleeper' ? 'sleeper' : v.busType === 'ertiga' ? 'ertiga' : 'seater');
    setVehFuelTypeInput(v.fuelType);
    setVehRegDateInput(v.regDate);
    setVehTotalKmInput(String(v.totalKm || ''));
    setVehInsuranceExpiryInput(v.insuranceExpiry);
    setVehFitnessExpiryInput(v.fitnessExpiry);
    setVehPucExpiryInput(v.pucExpiry);
    setShowAddVehicleModal(true);
  }

  async function handleSaveTravelVehicle() {
    if (!user?.id) return;
    if (!vehRegInput.trim()) {
      Alert.alert(t('common_missingField'), t('trv_missingRegNumber'));
      return;
    }
    setVehSaving(true);
    try {
      const payload = {
        ownerId: user.id,
        regNumber: vehRegInput.trim(),
        model: vehModelInput.trim(),
        busType: vehBusTypeInput,
        fuelType: vehFuelTypeInput,
        regDate: vehRegDateInput.trim(),
        totalKm: parseFloat(vehTotalKmInput) || 0,
        insuranceExpiry: vehInsuranceExpiryInput.trim(),
        fitnessExpiry: vehFitnessExpiryInput.trim(),
        pucExpiry: vehPucExpiryInput.trim(),
      };
      const res = editingVehicleId
        ? await apiFetch(`/api/travel/vehicles/${editingVehicleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await apiFetch('/api/travel/vehicles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (res.ok) {
        setShowAddVehicleModal(false);
        if (selectedTravelVehicle && editingVehicleId) setSelectedTravelVehicle(data.vehicle);
        loadTravelVehicles();
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setVehSaving(false);
    }
  }

  function handleDeleteTravelVehicle(v: any) {
    Alert.alert(t('trv_deleteVehicle'), t('trv_deleteVehicleConfirm', { reg: v.regNumber }), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('common_delete'),
        style: 'destructive',
        onPress: async () => {
          if (!user?.id) return;
          try {
            const res = await apiFetch(`/api/travel/vehicles/${v.id}?owner_id=${user.id}`, { method: 'DELETE' });
            if (res.ok) {
              setSelectedTravelVehicle(null);
              loadTravelVehicles();
            }
          } catch {
            Alert.alert(t('common_error'), t('common_networkError'));
          }
        },
      },
    ]);
  }

  // Formats an ISO date (2026-11-15) as "15 Nov 2026" to match the rest of the app's date style.
  function formatDisplayDate(iso: string) {
    if (!iso) return '';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  // Available / Expiring Soon (<=30 days) / Expired, based on today's date.
  function getExpiryStatus(iso: string): 'valid' | 'expiring' | 'expired' | 'unknown' {
    if (!iso) return 'unknown';
    const expiry = new Date(iso + 'T00:00:00');
    if (isNaN(expiry.getTime())) return 'unknown';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysLeft = Math.floor((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) return 'expired';
    if (daysLeft <= 30) return 'expiring';
    return 'valid';
  }

  function renderComplianceBadge(iso: string) {
    const status = getExpiryStatus(iso);
    if (status === 'unknown') {
      return (
        <View style={[styles.activeBadge, { backgroundColor: colors.border }]}>
          <Text style={[styles.activeBadgeText, { color: colors.muted }]}>{t('trv_notSet')}</Text>
        </View>
      );
    }
    const cfg =
      status === 'valid'
        ? { bg: colors.greenBg, color: colors.greenDark, label: t('veh_valid') }
        : status === 'expiring'
        ? { bg: colors.amberBg, color: colors.amber, label: t('trv_expiringSoon') }
        : { bg: colors.redBg, color: colors.red, label: t('trv_expired') };
    return (
      <View style={[styles.activeBadge, { backgroundColor: cfg.bg }]}>
        <Text style={[styles.activeBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
    );
  }

  // Travel Fuel Logs state
  const [travelFuelLogs, setTravelFuelLogs] = useState<any[]>([]);
  const [travelFuelLoading, setTravelFuelLoading] = useState(false);
  const [travelFuelSummary, setTravelFuelSummary] = useState<any>(null);
  const [fuelTripFilter, setFuelTripFilter] = useState<string>('ALL'); // 'ALL' or tripId
  const [selectedTripForFuel, setSelectedTripForFuel] = useState<string>(''); // tripId
  const [fuelBillNumber, setFuelBillNumber] = useState('');
  const [fuelNotes, setFuelNotes] = useState('');
  const [fuelDateInput, setFuelDateInput] = useState(formatDateISO(new Date()));

  async function loadTravelFuelLogs(tripId?: string) {
    if (!user?.id) return;
    setTravelFuelLoading(true);
    try {
      const url = tripId && tripId !== 'ALL'
        ? `/api/travel/fuel-logs?owner_id=${user.id}&trip_id=${tripId}`
        : `/api/travel/fuel-logs?owner_id=${user.id}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const data = await res.json();
        setTravelFuelLogs(data.fuelLogs || []);
        setTravelFuelSummary(data.summary || null);
      }
    } catch (e) {
      console.error('Error loading travel fuel logs:', e);
    } finally {
      setTravelFuelLoading(false);
    }
  }

  async function loadTravelTrips() {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/travel/trips?owner_id=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        const trips = data.trips || [];
        setTravelTrips(trips);
        if (travelSelectedTrip) {
          const updated = trips.find((t: any) => String(t.id) === String(travelSelectedTrip.id));
          if (updated) setTravelSelectedTrip(updated);
        }
      }
    } catch (e) {
      console.error('Error loading trips:', e);
    }
  }

  useEffect(() => {
    if (user?.id && isTravelBusiness && (activeTab === 'online_booking' || activeTab === 'fuel' || activeTab === 'home')) {
      loadTravelTrips();
      loadTravelFuelLogs(fuelTripFilter);
    }
    if (user?.id && isTravelBusiness && activeTab === 'online_booking') {
      loadFareSuggestions();
    }
  }, [user?.id, activeTab, fuelTripFilter, isTravelBusiness]);

  async function loadFareSuggestions() {
    if (!user?.id) return;
    try {
      const res = await apiFetch(`/api/travel/fare-suggestions?owner_id=${user.id}`);
      if (!res.ok) return;
      const data = await res.json();
      setFareSuggestions(data.suggestions || []);
    } catch (e) {
      console.error('Error loading fare suggestions:', e);
    }
  }

  function handleDeleteTravelFuel(fuelId: string | number) {
    if (!user?.id) return;
    Alert.alert(t('common_delete'), t('trv_deleteFuelConfirm'), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('common_delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await apiFetch(`/api/travel/fuel-logs/${fuelId}?owner_id=${user.id}`, {
              method: 'DELETE',
            });
            if (res.ok) {
              await Promise.all([loadTravelFuelLogs(fuelTripFilter), loadTravelTrips()]);
            }
          } catch {
            Alert.alert(t('common_error'), t('common_networkError'));
          }
        },
      },
    ]);
  }

  async function loadTravelSeats(tripId: string) {
    if (!user?.id) return;
    setTravelSeatsLoading(true);
    try {
      const res = await apiFetch(`/api/travel/trips/${tripId}/seats?owner_id=${user.id}`);
      if (res.ok) setTravelSeats((await res.json()).seats || []);
    } catch (e) {
      console.error('Error loading seats:', e);
    } finally {
      setTravelSeatsLoading(false);
    }
  }

  function handleOpenTrip(trip: any) {
    setTravelSelectedTrip(trip);
    setSelectedSeatNumbers([]);
    setShowSeatMap(false);
    setShowCustomerDetails(false);
    loadTravelSeats(trip.id);
    loadTravelFuelLogs(String(trip.id));
  }

  function handleOpenAddTravelFuel(tripId?: string) {
    setFuelQty('');
    setFuelRate('');
    setFuelOdometer('');
    setFuelStationName('');
    setFuelBillNumber('');
    setFuelNotes('');
    setFuelDateInput(formatDateISO(new Date()));
    setFuelTypeChoice('Diesel');
    setSelectedTripForFuel(tripId || 'NONE');
    setShowAddFuelModal(true);
  }

  // A trip whose travel date has already passed is view-only: the owner can still see who
  // booked and the revenue, but new seats can no longer be selected/booked/blocked for it.
  function isTripPast(trip: any) {
    return !!trip?.travelDate && trip.travelDate < formatDateISO(new Date());
  }

  function handleDeleteTravelTrip(trip: any) {
    Alert.alert(t('trv_cancelTrip'), t('trv_cancelTripConfirm'), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('common_delete'),
        style: 'destructive',
        onPress: async () => {
          if (!user?.id) return;
          try {
            const res = await apiFetch(`/api/travel/trips/${trip.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ownerId: user.id, status: 'cancelled' }),
            });
            if (res.ok) {
              loadTravelTrips();
            } else {
              const data = await res.json().catch(() => ({}));
              Alert.alert(t('common_error'), data.error || t('common_networkError'));
            }
          } catch {
            Alert.alert(t('common_error'), t('common_networkError'));
          }
        },
      },
    ]);
  }

  function handleOpenNewTrip() {
    setTripRouteInput('');
    setTripDateInput('');
    setTripTimeInput('');
    setTripBusNumberInput('');
    setRouteStopSuggestions([]);
    setNewStopInput('');
    setTripBusTypeInput('seater');
    setTripSeaterCountInput('40');
    setTripSleeperCountInput('0');
    setTripFareInput('');
    setShowTripBusDropdown(false);
    setShowNewTripModal(true);
    loadTravelVehicles();
  }

  async function loadRouteStops(route: string) {
    if (!user?.id || !route.trim()) {
      setRouteStopSuggestions([]);
      return;
    }
    try {
      const res = await apiFetch(`/api/travel/route-stops?owner_id=${user.id}&route=${encodeURIComponent(route.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setRouteStopSuggestions(data.stops || []);
      }
    } catch (e) {
      console.error('Error loading route stops:', e);
    }
  }

  useEffect(() => {
    if (!showNewTripModal) return;
    const timer = setTimeout(() => loadRouteStops(tripRouteInput), 400);
    return () => clearTimeout(timer);
  }, [tripRouteInput, showNewTripModal]);

  async function handleAddRouteStop() {
    const stopName = newStopInput.trim();
    if (!user?.id || !tripRouteInput.trim() || !stopName) return;
    setAddingStop(true);
    try {
      const res = await apiFetch('/api/travel/route-stops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, route: tripRouteInput.trim(), stopName }),
      });
      const data = await res.json();
      if (res.ok) {
        setRouteStopSuggestions(data.stops || []);
        setNewStopInput('');
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setAddingStop(false);
    }
  }

  function handleRemoveRouteStop(stopName: string) {
    if (!user?.id || !tripRouteInput.trim()) return;
    Alert.alert(t('trv_removeStopTitle'), t('trv_removeStopConfirm', { stop: stopName }), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('common_delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            const params = new URLSearchParams({
              owner_id: String(user.id),
              route: tripRouteInput.trim(),
              stopName,
            });
            const res = await apiFetch(`/api/travel/route-stops?${params.toString()}`, { method: 'DELETE' });
            if (res.ok) {
              setRouteStopSuggestions(prev => prev.filter(s => s !== stopName));
            }
          } catch {
            Alert.alert(t('common_error'), t('common_networkError'));
          }
        },
      },
    ]);
  }

  function handleSelectTripBus(v: any) {
    setTripBusNumberInput(v.regNumber);
    handleSelectBusType(v.busType === 'sleeper' ? 'sleeper' : v.busType === 'ertiga' ? 'ertiga' : 'seater');
    setShowTripBusDropdown(false);
  }

  function handleSelectBusType(type: 'seater' | 'sleeper' | 'ertiga') {
    setTripBusTypeInput(type);
    if (type === 'sleeper') {
      setTripSeaterCountInput('0');
      setTripSleeperCountInput(prev => (prev === '0' || !prev ? '30' : prev));
    } else {
      setTripSleeperCountInput('0');
      setTripSeaterCountInput(prev => (prev === '0' || !prev ? (type === 'ertiga' ? '7' : '40') : prev));
    }
  }

  function adjustSeatCount(value: string, setValue: (v: string) => void, delta: number) {
    const n = Math.max(0, Math.min(80, (parseInt(value, 10) || 0) + delta));
    setValue(String(n));
  }

  // ---- Lightweight in-app calendar picker for Travel Date (no native date-picker module
  // is installed, and adding one would need a full native rebuild - this needs none). ----
  function formatDateISO(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function openTripDatePicker() {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(tripDateInput) ? new Date(tripDateInput + 'T00:00:00') : new Date();
    setCalendarMonth(isNaN(parsed.getTime()) ? new Date() : parsed);
    setShowTripDatePicker(true);
  }

  function shiftCalendarMonth(delta: number) {
    setCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  function openTripListDateFilter() {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(tripListDateFilter) ? new Date(tripListDateFilter + 'T00:00:00') : new Date();
    setFilterCalendarMonth(isNaN(parsed.getTime()) ? new Date() : parsed);
    setShowTripListDateFilter(true);
  }

  function shiftFilterCalendarMonth(delta: number) {
    setFilterCalendarMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  function openBillMonthPicker() {
    const match = /^(\d{4})-(\d{2})$/.exec(billMonthFilter);
    setBillMonthPickerYear(match ? parseInt(match[1], 10) : new Date().getFullYear());
    setShowBillMonthPicker(true);
  }

  function renderMonthYearPicker(year: number, selectedYYYYMM: string, onShiftYear: (delta: number) => void, onSelectMonth: (yyyyMM: string) => void) {
    const monthNames = [
      t('cal_jan'), t('cal_feb'), t('cal_mar'), t('cal_apr'), t('cal_may'), t('cal_jun'),
      t('cal_jul'), t('cal_aug'), t('cal_sep'), t('cal_oct'), t('cal_nov'), t('cal_dec'),
    ];
    const rows: number[][] = [];
    for (let i = 0; i < 12; i += 3) rows.push([i, i + 1, i + 2]);
    return (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Pressable onPress={() => onShiftYear(-1)} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.brandBg }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.brand }}>‹</Text>
          </Pressable>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.navy }}>{year}</Text>
          <Pressable onPress={() => onShiftYear(1)} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.brandBg }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.brand }}>›</Text>
          </Pressable>
        </View>
        {rows.map((row, ridx) => (
          <View key={ridx} style={{ flexDirection: 'row', marginBottom: 10 }}>
            {row.map(monthIdx => {
              const yyyyMM = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
              const isSelected = yyyyMM === selectedYYYYMM;
              return (
                <Pressable
                  key={monthIdx}
                  onPress={() => onSelectMonth(yyyyMM)}
                  style={{
                    flex: 1, marginHorizontal: 4, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
                    backgroundColor: isSelected ? colors.brand : colors.page,
                    borderWidth: 1, borderColor: isSelected ? colors.brand : colors.border,
                  }}>
                  <Text style={{ fontSize: 13, fontWeight: isSelected ? '800' : '600', color: isSelected ? '#fff' : colors.slate }}>
                    {monthNames[monthIdx]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    );
  }

  function renderCalendarPicker(month: Date, selectedISO: string, onShiftMonth: (delta: number) => void, onSelectDate: (iso: string) => void) {
    const year = month.getFullYear();
    const monthIdx = month.getMonth();
    const startWeekday = new Date(year, monthIdx, 1).getDay();
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
    const todayISO = formatDateISO(new Date());
    const cells: (number | null)[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    const weekdayLabels = [t('cal_sun'), t('cal_mon'), t('cal_tue'), t('cal_wed'), t('cal_thu'), t('cal_fri'), t('cal_sat')];

    return (
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Pressable onPress={() => onShiftMonth(-1)} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.brandBg }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.brand }}>‹</Text>
          </Pressable>
          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.navy }}>
            {month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </Text>
          <Pressable onPress={() => onShiftMonth(1)} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: colors.brandBg }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.brand }}>›</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', marginBottom: 6 }}>
          {weekdayLabels.map((lbl, idx) => (
            <Text key={idx} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: colors.muted }}>
              {lbl}
            </Text>
          ))}
        </View>
        {rows.map((row, ridx) => (
          <View key={ridx} style={{ flexDirection: 'row' }}>
            {row.map((day, cidx) => {
              if (day == null) return <View key={cidx} style={{ flex: 1, aspectRatio: 1 }} />;
              const iso = formatDateISO(new Date(year, monthIdx, day));
              const isSelected = iso === selectedISO;
              const isToday = iso === todayISO;
              return (
                <Pressable
                  key={cidx}
                  onPress={() => onSelectDate(iso)}
                  style={{
                    flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', margin: 2, borderRadius: 9,
                    backgroundColor: isSelected ? colors.brand : 'transparent',
                    borderWidth: isToday && !isSelected ? 1.5 : 0,
                    borderColor: colors.brand,
                  }}>
                  <Text style={{ fontSize: 13, fontWeight: isSelected ? '800' : '600', color: isSelected ? '#fff' : colors.slate }}>
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    );
  }

  async function handleSaveNewTrip() {
    if (!user?.id) return;
    if (!tripRouteInput.trim()) {
      Alert.alert(t('common_missingField'), t('trv_missingRoute'));
      return;
    }
    if (!tripDateInput.trim()) {
      Alert.alert(t('common_missingField'), t('trv_missingDate'));
      return;
    }
    const seaterCount = parseInt(tripSeaterCountInput, 10) || 0;
    const sleeperCount = tripBusTypeInput === 'sleeper' ? (parseInt(tripSleeperCountInput, 10) || 0) : 0;
    const seats = seaterCount + sleeperCount;
    if (!seats || seats <= 0 || seats > 80) {
      Alert.alert(t('common_missingField'), t('trv_missingSeats'));
      return;
    }
    setNewTripSaving(true);
    try {
      const res = await apiFetch('/api/travel/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          route: tripRouteInput.trim(),
          travelDate: tripDateInput.trim(),
          departureTime: tripTimeInput.trim(),
          busNumber: tripBusNumberInput.trim(),
          busType: tripBusTypeInput,
          totalSeats: seats,
          sleeperSeats: sleeperCount,
          fare: parseFloat(tripFareInput) || 0,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowNewTripModal(false);
        loadTravelTrips();
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setNewTripSaving(false);
    }
  }

  function handleTapSeat(seat: any) {
    if (seat.booked) {
      // Viewing an existing booking's details is always allowed, even for a past trip.
      setActiveSeat(seat);
      setShowSeatDetailModal(true);
      return;
    }
    if (isTripPast(travelSelectedTrip)) return; // trip already departed: no new bookings/blocks
    if (seat.blocked) {
      Alert.alert(
        t('trv_blockedSeatTitle', { seat: String(seat.seatNumber) }),
        seat.blockReason ? t('trv_blockedSeatMsgReason', { reason: seat.blockReason }) : t('trv_blockedSeatMsg'),
        [
          { text: t('common_cancel'), style: 'cancel' },
          { text: t('trv_unblockSeat'), onPress: () => handleToggleBlockSeat(seat, false) },
        ]
      );
      return;
    }
    setSelectedSeatNumbers(prev =>
      prev.includes(seat.seatNumber) ? prev.filter(n => n !== seat.seatNumber) : [...prev, seat.seatNumber]
    );
  }

  function handleLongPressSeat(seat: any) {
    if (seat.booked) return;
    if (isTripPast(travelSelectedTrip)) return; // trip already departed: no new bookings/blocks
    if (seat.blocked) {
      handleToggleBlockSeat(seat, false);
      return;
    }
    Alert.alert(
      t('trv_blockSeatTitle', { seat: String(seat.seatNumber) }),
      t('trv_blockSeatConfirm'),
      [
        { text: t('common_cancel'), style: 'cancel' },
        { text: t('trv_blockSeat'), style: 'destructive', onPress: () => handleToggleBlockSeat(seat, true) },
      ]
    );
  }

  async function handleToggleBlockSeat(seat: any, block: boolean) {
    if (!user?.id || !travelSelectedTrip) return;
    try {
      const url = `/api/travel/trips/${travelSelectedTrip.id}/seats/${seat.seatNumber}/block`;
      const res = block
        ? await apiFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ownerId: user.id }),
          })
        : await apiFetch(`${url}?owner_id=${user.id}`, { method: 'DELETE' });
      if (res.ok) {
        setSelectedSeatNumbers(prev => prev.filter(n => n !== seat.seatNumber));
        loadTravelSeats(travelSelectedTrip.id);
        loadTravelTrips();
      } else {
        const data = await res.json().catch(() => ({}));
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    }
  }

  function handleOpenMultiBook() {
    if (selectedSeatNumbers.length === 0) return;
    setBookPassengerName('');
    setBookMobile('');
    setBookFare(String(travelSelectedTrip?.fare ?? ''));
    setBookPaymentMode('Cash');
    setBookPaymentStatus('paid');
    setBookPickupLocation('');
    setBookDropLocation('');
    if (travelSelectedTrip?.route) loadRouteStops(travelSelectedTrip.route);
    setShowBookSeatModal(true);
  }

  // ---- Bus layout visuals: seater (upright chairs, 2+2) vs sleeper (berths, lower/upper deck) ----
  function renderBusFrontBadge() {
    return (
      <View style={{ alignItems: 'center', marginBottom: 18 }}>
        <View
          style={{
            width: 84, paddingVertical: 7, alignItems: 'center', justifyContent: 'center',
            backgroundColor: colors.slate,
            borderTopLeftRadius: 30, borderTopRightRadius: 30, borderBottomLeftRadius: 6, borderBottomRightRadius: 6,
          }}>
          <Text style={{ fontSize: 15 }}>🧑‍✈️</Text>
        </View>
        <Text style={{ fontSize: 10, fontWeight: '800', color: colors.muted, marginTop: 5, letterSpacing: 1.2 }}>
          {t('trv_front').toUpperCase()}
        </Text>
      </View>
    );
  }

  // Single source of truth for how a seat looks across all cell shapes (seater square, single
  // berth, double berth): booked (green) > blocked (grey, disabled) > selected (brand fill) >
  // available (outlined). Booked/available colors match the legend the user asked to keep.
  function seatVisualStyle(seat: any, selected: boolean) {
    if (seat.booked) return { bg: colors.green, border: colors.greenDark, text: '#fff' };
    if (seat.blocked) return { bg: colors.border, border: colors.muted, text: colors.muted };
    if (selected) return { bg: colors.brand, border: colors.brandDark, text: '#fff' };
    if (isTripPast(travelSelectedTrip)) return { bg: colors.page, border: colors.border, text: colors.muted };
    return { bg: colors.panel, border: colors.brand, text: colors.slate };
  }

  function renderSeaterCell(seat: any) {
    const selected = selectedSeatNumbers.includes(seat.seatNumber);
    const v = seatVisualStyle(seat, selected);
    return (
      <Pressable
        key={seat.seatNumber}
        onPress={() => handleTapSeat(seat)}
        onLongPress={() => handleLongPressSeat(seat)}
        style={{
          width: 52, height: 52, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
          backgroundColor: v.bg, borderWidth: 2, borderColor: v.border,
        }}>
        {seat.blocked ? (
          <Text style={{ fontSize: 16 }}>🚫</Text>
        ) : (
          <Text style={{ fontSize: 14, fontWeight: '800', color: v.text }}>{seat.seatNumber}</Text>
        )}
      </Pressable>
    );
  }

  // Explicit row-by-row 2+2 pairing (left pair / aisle / right pair) instead of relying on
  // flexWrap to break lines - flexWrap doesn't reliably align to logical rows for small counts,
  // so it produced lopsided rows (e.g. 2+3) instead of clean pairs. A trailing partial row splits
  // as evenly as possible between the two sides (e.g. 10 seats -> 5 left / 5 right).
  function renderSeaterGrid(seats: any[]) {
    const rows: any[][] = [];
    for (let i = 0; i < seats.length; i += 4) rows.push(seats.slice(i, i + 4));
    return (
      <View style={{ gap: 10 }}>
        {rows.map((row, ridx) => {
          const leftCount = Math.ceil(row.length / 2);
          const left = row.slice(0, leftCount);
          const right = row.slice(leftCount);
          return (
            <View key={ridx} style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {left.map(seat => renderSeaterCell(seat))}
              </View>
              {right.length > 0 && <View style={{ width: 20 }} />}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {right.map(seat => renderSeaterCell(seat))}
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  function renderSingleBerthCell(seat: any) {
    if (!seat) return <View style={{ width: 58 }} />;
    const selected = selectedSeatNumbers.includes(seat.seatNumber);
    const v = seatVisualStyle(seat, selected);
    return (
      <Pressable
        onPress={() => handleTapSeat(seat)}
        onLongPress={() => handleLongPressSeat(seat)}
        style={{
          width: 58, height: 70, borderRadius: 10, alignItems: 'center', justifyContent: 'flex-end',
          paddingBottom: 5, overflow: 'hidden',
          backgroundColor: v.bg, borderWidth: 1.5, borderColor: v.border,
        }}>
        <View
          style={{
            position: 'absolute', top: 5, left: 6, right: 6, height: 8, borderRadius: 4,
            backgroundColor: seat.booked || selected ? 'rgba(255,255,255,0.4)' : colors.brandBg,
          }}
        />
        {seat.blocked ? (
          <Text style={{ fontSize: 15 }}>🚫</Text>
        ) : (
          <Text style={{ fontSize: 11, fontWeight: '800', color: v.text }}>{seat.seatNumber}</Text>
        )}
      </Pressable>
    );
  }

  // A "larger bed" merges what used to be 2 separate small squares into one wide berth -
  // still 2 independently tappable/bookable seats, split by a thin divider.
  function renderLargerBedHalf(seat: any) {
    if (!seat) return <View style={{ flex: 1, backgroundColor: colors.page }} />;
    const selected = selectedSeatNumbers.includes(seat.seatNumber);
    const v = seatVisualStyle(seat, selected);
    return (
      <Pressable
        onPress={() => handleTapSeat(seat)}
        onLongPress={() => handleLongPressSeat(seat)}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: v.bg }}>
        {seat.blocked ? (
          <Text style={{ fontSize: 13 }}>🚫</Text>
        ) : (
          <Text style={{ fontSize: 11, fontWeight: '800', color: v.text }}>{seat.seatNumber}</Text>
        )}
      </Pressable>
    );
  }

  function renderLargerBedCell(seatA: any, seatB: any, key: React.Key) {
    return (
      <View
        key={key}
        style={{
          flexDirection: 'row', height: 44, borderRadius: 10, overflow: 'hidden',
          borderWidth: 1.5, borderColor: colors.brandLight, marginBottom: 10,
        }}>
        {renderLargerBedHalf(seatA)}
        <View style={{ width: 2, backgroundColor: colors.panel }} />
        {renderLargerBedHalf(seatB)}
      </View>
    );
  }

  // Single beds (left column) and larger/merged-double beds (right column), unsplit by deck -
  // blocks of 5 (1 single + 4 double-seats -> 2 larger beds) determine which seats are which type.
  function renderSleeperBerths(seats: any[]) {
    const blocks: any[][] = [];
    for (let i = 0; i < seats.length; i += 5) blocks.push(seats.slice(i, i + 5));
    const singles: any[] = [];
    const largerPairs: any[][] = [];
    blocks.forEach(block => {
      singles.push(block[0]);
      const doubles = block.slice(1);
      for (let i = 0; i < doubles.length; i += 2) largerPairs.push([doubles[i], doubles[i + 1]]);
    });
    return (
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <View style={{ width: 76 }}>
          <Text style={{ fontSize: 10.5, fontWeight: '800', color: colors.muted, letterSpacing: 0.5, marginBottom: 10 }}>
            {t('trv_singleBedsLabel').toUpperCase()}
          </Text>
          {singles.map((seat, idx) => (
            <View key={seat?.seatNumber ?? idx} style={{ marginBottom: 10, alignItems: 'center' }}>
              {renderSingleBerthCell(seat)}
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10.5, fontWeight: '800', color: colors.muted, letterSpacing: 0.5, marginBottom: 10 }}>
            {t('trv_largerBedsLabel').toUpperCase()}
          </Text>
          {largerPairs.map((pair, idx) => renderLargerBedCell(pair[0], pair[1], idx))}
        </View>
      </View>
    );
  }

  function renderBusLayout(seats: any[]) {
    // Mixed "Seater-cum-Sleeper" buses carry a per-seat seatType from the backend, so a trip
    // can show both a berths section and a plain-seats section - berths first, seats last.
    const seaterSeats = seats.filter(s => (s.seatType || 'seater') !== 'sleeper');
    const sleeperSeatsArr = seats.filter(s => s.seatType === 'sleeper');
    const hasSeater = seaterSeats.length > 0;
    const hasSleeper = sleeperSeatsArr.length > 0;
    return (
      <View
        style={{
          backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: 24,
          paddingTop: 20, paddingBottom: 22, paddingHorizontal: 18, marginBottom: 16,
        }}>
        {renderBusFrontBadge()}
        {hasSleeper && (
          <>
            {hasSeater && (
              <Text style={{ fontSize: 12, fontWeight: '800', color: colors.muted, letterSpacing: 1, marginBottom: 12 }}>
                {t('trv_sleeperBerthsHeading').toUpperCase()}
              </Text>
            )}
            {renderSleeperBerths(sleeperSeatsArr)}
          </>
        )}
        {hasSeater && (
          <>
            {hasSleeper && <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 18 }} />}
            {hasSleeper && (
              <Text style={{ fontSize: 12, fontWeight: '800', color: colors.muted, letterSpacing: 1, marginBottom: 12 }}>
                {t('trv_seaterSeatsHeading').toUpperCase()}
              </Text>
            )}
            {renderSeaterGrid(seaterSeats)}
          </>
        )}
      </View>
    );
  }

  // ---- WhatsApp booking confirmation: opens WhatsApp with a pre-filled, professionally
  // worded message so the owner just has to hit send - no WhatsApp API/business account needed.
  function normalizeIndianMobile(raw: string): string | null {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return null;
    if (digits.length === 10) return `91${digits}`;
    if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
    if (digits.length >= 11) return digits;
    return null;
  }

  function buildBookingWhatsAppMessage(params: {
    passengerName: string;
    seatNumbers: number[];
    trip: any;
    totalFare: number;
    paymentStatus: 'paid' | 'pending';
    ownerName: string;
    pickupLocation?: string;
    dropLocation?: string;
  }) {
    const { passengerName, seatNumbers, trip, totalFare, paymentStatus, ownerName, pickupLocation, dropLocation } = params;
    const seatsLabel = seatNumbers.slice().sort((a, b) => a - b).join(', ');
    const lines = [
      `Dear ${passengerName},`,
      '',
      `Greetings! Your bus seat booking has been *confirmed*. ✅`,
      '',
      `*Booking Details*`,
      `Route: ${trip.route}`,
      `Travel Date: ${trip.travelDate}`,
      trip.departureTime ? `Departure Time: ${trip.departureTime}` : null,
      `Seat No.: ${seatsLabel}`,
      trip.busNumber ? `Bus No.: ${trip.busNumber}` : null,
      pickupLocation ? `Pickup Point: ${pickupLocation}` : null,
      dropLocation ? `Drop Point: ${dropLocation}` : null,
      `Total Fare: ₹${totalFare.toLocaleString()}`,
      `Payment Status: ${paymentStatus === 'paid' ? 'Paid' : 'Pending'}`,
      '',
      `Kindly arrive at the boarding point at least 15 minutes before departure.`,
      '',
      `Thank you for choosing us. Wishing you a safe and pleasant journey!`,
      '',
      `Regards,`,
      ownerName,
    ].filter((line): line is string => line !== null);
    return lines.join('\n');
  }

  async function sendBookingWhatsApp(mobile: string, message: string) {
    const normalized = normalizeIndianMobile(mobile);
    if (!normalized) return;
    const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('common_error'), t('trv_whatsappOpenFailed'));
    }
  }

  async function handleDraftReminder(tripId: string | number, seatNumber: number, mobileNumber: string) {
    if (!user?.id) return;
    if (!mobileNumber) {
      Alert.alert(t('common_error'), t('trv_reminderNoMobile'));
      return;
    }
    setDraftingReminder(true);
    try {
      const res = await apiFetch('/api/travel/draft-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, tripId, seatNumber }),
      });
      const data = await res.json();
      if (data.error) {
        Alert.alert(t('common_error'), data.error);
        return;
      }
      setReminderDraftText(data.message || '');
      setReminderMobile(data.mobileNumber || mobileNumber);
      setShowReminderModal(true);
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setDraftingReminder(false);
    }
  }

  function buildMaintenancePaymentWhatsAppMessage(params: {
    ownerName: string;
    flatNumber: string;
    monthLabel: string;
    amount: number;
    buildingName?: string;
  }) {
    const { ownerName, flatNumber, monthLabel, amount, buildingName } = params;
    const lines = [
      `Dear ${ownerName},`,
      '',
      `Greetings! Your maintenance payment has been *successfully received*. ✅`,
      '',
      `*Payment Details*`,
      `Flat No.: ${flatNumber}`,
      `Month: ${monthLabel}`,
      `Amount Paid: ₹${amount.toLocaleString()}`,
      '',
      `Thank you for your timely payment!`,
      '',
      `Regards,`,
      buildingName || 'Building Management',
    ];
    return lines.join('\n');
  }

  async function handleCallPassenger(mobile: string) {
    try {
      await Linking.openURL(`tel:${mobile}`);
    } catch {
      Alert.alert(t('common_error'), t('trv_callFailed'));
    }
  }

  async function handleConfirmBookSeat() {
    if (!user?.id || !travelSelectedTrip || selectedSeatNumbers.length === 0) return;
    if (!bookPassengerName.trim()) {
      Alert.alert(t('common_missingField'), t('trv_missingPassenger'));
      return;
    }
    setBookSaving(true);
    try {
      const perSeatFare = bookFare === '' ? undefined : parseFloat(bookFare);
      const results = await Promise.all(
        selectedSeatNumbers.map(seatNumber =>
          apiFetch(`/api/travel/trips/${travelSelectedTrip.id}/seats/${seatNumber}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ownerId: user.id,
              passengerName: bookPassengerName.trim(),
              mobileNumber: bookMobile.trim(),
              fare: perSeatFare,
              paymentMode: bookPaymentMode,
              paymentStatus: bookPaymentStatus,
              pickupLocation: bookPickupLocation,
              dropLocation: bookDropLocation,
            }),
          })
        )
      );
      const allOk = results.every(r => r.ok);
      const anyConflict = results.some(r => r.status === 409);
      if (allOk) {
        setShowBookSeatModal(false);
        const mobile = bookMobile.trim();
        if (mobile) {
          const totalFare = (perSeatFare ?? travelSelectedTrip.fare ?? 0) * selectedSeatNumbers.length;
          const message = buildBookingWhatsAppMessage({
            passengerName: bookPassengerName.trim(),
            seatNumbers: selectedSeatNumbers,
            trip: travelSelectedTrip,
            totalFare,
            paymentStatus: bookPaymentStatus,
            ownerName: user.fullName,
            pickupLocation: bookPickupLocation,
            dropLocation: bookDropLocation,
          });
          sendBookingWhatsApp(mobile, message);
        }
        setSelectedSeatNumbers([]);
        await Promise.all([loadTravelSeats(travelSelectedTrip.id), loadTravelTrips()]);
      } else {
        Alert.alert(t('common_error'), anyConflict ? t('trv_bookedAlready') : t('common_networkError'));
        setShowBookSeatModal(false);
        setSelectedSeatNumbers([]);
        await Promise.all([loadTravelSeats(travelSelectedTrip.id), loadTravelTrips()]);
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setBookSaving(false);
    }
  }

  function handleCancelSeatBooking() {
    if (!user?.id || !travelSelectedTrip || !activeSeat) return;
    Alert.alert(t('trv_cancelBooking'), t('trv_cancelBookingConfirm', { seat: activeSeat.seatNumber }), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('common_delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await apiFetch(
              `/api/travel/trips/${travelSelectedTrip.id}/seats/${activeSeat.seatNumber}?owner_id=${user.id}`,
              { method: 'DELETE' }
            );
            if (res.ok) {
              setShowSeatDetailModal(false);
              await Promise.all([loadTravelSeats(travelSelectedTrip.id), loadTravelTrips()]);
            }
          } catch {
            Alert.alert(t('common_error'), t('common_networkError'));
          }
        },
      },
    ]);
  }

  async function handleUpdateSeatPayment(updates: { paymentStatus?: 'paid' | 'pending'; paymentMode?: 'Cash' | 'UPI' | 'Online' }) {
    if (!user?.id || !travelSelectedTrip || !activeSeat) return;
    setPaymentUpdateSaving(true);
    try {
      const res = await apiFetch(
        `/api/travel/trips/${travelSelectedTrip.id}/seats/${activeSeat.seatNumber}/payment`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId: user.id, ...updates }),
        }
      );
      if (res.ok) {
        setActiveSeat((prev: any) => (prev ? { ...prev, booking: { ...prev.booking, ...updates } } : prev));
        await Promise.all([loadTravelSeats(travelSelectedTrip.id), loadTravelTrips()]);
      } else {
        const data = await res.json().catch(() => ({}));
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setPaymentUpdateSaving(false);
    }
  }

  function handleOpenQuickPayment(mode: 'Cash' | 'UPI') {
    setShowQrModal(false);
    setQuickPaymentMode(mode);
    setQuickPaymentAmount('');
    setVoiceTranscript('');
    setVoiceConfirmed(false);
    setShowQuickPaymentModal(true);
  }

  // ---- Voice-to-log: record a short "cash 150" / "upi one fifty" style voice note,
  // send it to the backend (Gemini) to transcribe + extract amount/mode, then pre-fill
  // the same quick-payment popup for the driver to review and save - never auto-saves. ----
  async function handleStartVoiceRecording() {
    if (!user?.id) return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('common_error'), t('drv_micPermissionDenied'));
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      setVoiceTranscript('');
      await voiceRecorder.prepareToRecordAsync();
      voiceRecorder.record();
      setTimeout(() => {
        if (voiceRecorder.isRecording) handleStopVoiceRecording();
      }, 6000);
    } catch (e) {
      console.error('Error starting voice recording:', e);
      Alert.alert(t('common_error'), t('drv_voiceUnavailable'));
    }
  }

  async function handleStopVoiceRecording() {
    if (!user?.id || !voiceRecorder.isRecording) return;
    try {
      await voiceRecorder.stop();
      const uri = voiceRecorder.uri;
      if (!uri) {
        Alert.alert(t('common_error'), t('drv_voiceUnavailable'));
        return;
      }
      setVoiceProcessing(true);
      const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const res = await apiFetch('/api/driver/voice-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, audioBase64, mimeType: 'audio/mp4' }),
      });
      const data = await res.json();
      setVoiceTranscript(data.transcript || '');
      if (data.error) {
        Alert.alert(t('common_error'), data.error);
        return;
      }
      if (!data.amount || data.amount <= 0) {
        Alert.alert(t('drv_voiceNoAmountTitle'), t('drv_voiceNoAmountMsg', { transcript: data.transcript || '' }));
        return;
      }
      setQuickPaymentMode(data.paymentMode === 'UPI' ? 'UPI' : 'Cash');
      setQuickPaymentAmount(String(data.amount));
      setVoiceConfirmed(false);
      setShowQuickPaymentModal(true);
    } catch (e) {
      console.error('Error processing voice recording:', e);
      Alert.alert(t('common_error'), t('drv_voiceUnavailable'));
    } finally {
      setVoiceProcessing(false);
    }
  }

  // Best-effort location lookup - never blocks or fails a save. Returns null on denied
  // permission, disabled GPS, or any other error, so callers just omit the location.
  async function getCurrentLocationName(): Promise<{ locationName: string; latitude: number; longitude: number } | null> {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = position.coords;
      const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (!place) return { locationName: '', latitude, longitude };
      const locationName = [place.street || place.name, place.city || place.subregion || place.district]
        .filter(Boolean)
        .join(', ');
      return { locationName, latitude, longitude };
    } catch (e) {
      console.error('Error getting location:', e);
      return null;
    }
  }

  // Caps the GPS+reverse-geocode lookup above to a short window so a quick
  // payment save never sits waiting on a slow/cold GPS fix - the location is a
  // nice-to-have for the trip list, not something worth delaying Save for.
  function getCurrentLocationNameFast(timeoutMs = 1500): Promise<{ locationName: string; latitude: number; longitude: number } | null> {
    return Promise.race([
      getCurrentLocationName(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  }

  // ---- AI Route Safety advisory (Home tab, passive) ----
  // Combines time-of-day (night driving) with current local weather (free, no API
  // key needed via Open-Meteo) into a simple drive-carefully banner. Never blocks
  // or alerts on failure - permission denied or network error just means no banner.
  async function loadRouteSafetyAdvisory() {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setRouteSafetyAdvisory(null);
        setWeatherStatus(null);
        setWeatherUnavailableReason('permission');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
      const { latitude, longitude } = position.coords;
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=is_day,weather_code,temperature_2m`
      );
      if (!res.ok) {
        setRouteSafetyAdvisory(null);
        setWeatherStatus(null);
        setWeatherUnavailableReason('error');
        return;
      }
      const data = await res.json();
      const isNight = data?.current?.is_day === 0;
      const weatherCode = data?.current?.weather_code ?? 0;
      const tempC = data?.current?.temperature_2m;
      const weather = classifyWeatherRisk(weatherCode);
      const weatherLabel: string = weather.labelKey ? t(weather.labelKey) : '';

      if (typeof tempC === 'number') {
        const condition = describeWeatherCondition(weatherCode, isNight);
        setWeatherStatus({ icon: condition.icon, label: t(condition.labelKey), tempC: Math.round(tempC) });
        setWeatherUnavailableReason(null);
      } else {
        setWeatherStatus(null);
        setWeatherUnavailableReason('error');
      }

      if (weather.severity === 'severe') {
        setRouteSafetyAdvisory({
          severity: 'high',
          message: isNight ? t('drv_safetyNightSevere', { weather: weatherLabel }) : t('drv_safetyDaySevere', { weather: weatherLabel }),
        });
      } else if (isNight && weather.severity === 'mild') {
        setRouteSafetyAdvisory({ severity: 'high', message: t('drv_safetyNightMild', { weather: weatherLabel }) });
      } else if (weather.severity === 'mild') {
        setRouteSafetyAdvisory({ severity: 'moderate', message: t('drv_safetyDayMild', { weather: weatherLabel }) });
      } else if (isNight) {
        setRouteSafetyAdvisory({ severity: 'moderate', message: t('drv_safetyNightClear') });
      } else {
        setRouteSafetyAdvisory(null);
      }
    } catch (e) {
      console.error('Error loading route safety advisory:', e);
      setRouteSafetyAdvisory(null);
      setWeatherStatus(null);
      setWeatherUnavailableReason('error');
    }
  }

  useEffect(() => {
    if (user?.id && (isTravelBusiness || hasFeature('trips')) && activeTab === 'home') {
      loadRouteSafetyAdvisory();
    }
  }, [user?.id, activeTab]);

  // Opens the driver's own Maps app for turn-by-turn navigation with live traffic -
  // no API key or billing needed, since Google Maps itself does the routing. Origin
  // is left out of the URL so Maps defaults to the device's current location.
  async function handleNavigate() {
    const destination = navigateDestination.trim();
    if (!destination) {
      Alert.alert(t('common_missingField'), t('drv_navigateMissingDestination'));
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
    try {
      await Linking.openURL(url);
    } catch (e) {
      console.error('Error opening navigation:', e);
      Alert.alert(t('common_error'), t('drv_navigateUnavailable'));
    }
  }

  async function handleSaveQuickPayment() {
    const amount = parseFloat(quickPaymentAmount);
    if (!amount || amount <= 0) {
      Alert.alert(t('common_missingField'), t('drv_missingCashAmount'));
      return;
    }
    if (!user?.id) return;
    setQuickPaymentSaving(true);
    try {
      const location = await getCurrentLocationNameFast();
      const res = await apiFetch('/api/driver/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          fare: amount,
          paymentMode: quickPaymentMode,
          locationName: location?.locationName || '',
          latitude: location?.latitude,
          longitude: location?.longitude,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowQuickPaymentModal(false);
        loadDriverTrips();
        loadDriverTripsHistory();
        speakConfirmation(t('drv_voiceReceivedMsg', { amount }), language);
      } else {
        Alert.alert(t('common_error'), data.error || t('common_networkError'));
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
    } finally {
      setQuickPaymentSaving(false);
    }
  }

  // ---- Voice-to-log for fuel: record a short "diesel 500" / "cng 350" style voice
  // note, send it to the backend (Gemini) to transcribe + extract fuel type/amount,
  // then pre-fill the Add Fuel modal for the driver to review and save. ----
  async function handleStartFuelVoiceRecording() {
    if (!user?.id) return;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t('common_error'), t('drv_micPermissionDenied'));
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      setFuelVoiceTranscript('');
      await voiceRecorder.prepareToRecordAsync();
      voiceRecorder.record();
      setTimeout(() => {
        if (voiceRecorder.isRecording) handleStopFuelVoiceRecording();
      }, 6000);
    } catch (e) {
      console.error('Error starting fuel voice recording:', e);
      Alert.alert(t('common_error'), t('drv_voiceUnavailable'));
    }
  }

  async function handleStopFuelVoiceRecording() {
    if (!user?.id || !voiceRecorder.isRecording) return;
    try {
      await voiceRecorder.stop();
      const uri = voiceRecorder.uri;
      if (!uri) {
        Alert.alert(t('common_error'), t('drv_voiceUnavailable'));
        return;
      }
      setFuelVoiceProcessing(true);
      const audioBase64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const res = await apiFetch('/api/driver/voice-fuel-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: user.id, audioBase64, mimeType: 'audio/mp4' }),
      });
      const data = await res.json();
      setFuelVoiceTranscript(data.transcript || '');
      if (data.error) {
        Alert.alert(t('common_error'), data.error);
        return;
      }
      if (!data.totalCost || data.totalCost <= 0) {
        Alert.alert(t('drv_voiceNoAmountTitle'), t('drv_voiceNoAmountMsg', { transcript: data.transcript || '' }));
        return;
      }
      if (data.fuelType) setFuelTypeChoice(data.fuelType);
      setFuelQty(data.quantity ? String(data.quantity) : '');
      setFuelTotalOverride(String(data.totalCost));
      setFuelOdometer(String(vehicle.totalKm));
      setFuelVoiceConfirmed(false);
      setShowAddFuelModal(true);
    } catch (e) {
      console.error('Error processing fuel voice recording:', e);
      Alert.alert(t('common_error'), t('drv_voiceUnavailable'));
    } finally {
      setFuelVoiceProcessing(false);
    }
  }

  async function handleAddFuel() {
    const qtyNum = parseFloat(fuelQty);
    const rateNum = parseFloat(fuelRate) || (fuelTypeChoice === 'Diesel' ? 92 : 85);
    const overrideTotal = parseFloat(fuelTotalOverride);
    const hasQty = !isNaN(qtyNum) && qtyNum > 0;
    const hasOverride = !isTravelBusiness && !isNaN(overrideTotal) && overrideTotal > 0;
    if (!hasOverride && !hasQty) {
      Alert.alert('Invalid Entry', isTravelBusiness ? 'Please enter a valid fuel quantity.' : 'Please enter a valid fuel quantity or total amount paid.');
      return;
    }
    const total = hasOverride ? Math.round(overrideTotal) : Math.round(qtyNum * rateNum);
    const finalQty = hasQty ? qtyNum : 0;
    const finalRate = hasQty ? rateNum : 0;
    const odoNum = parseFloat(fuelOdometer) || vehicle.totalKm;

    if (isTravelBusiness && user?.id) {
      try {
        const payload: any = {
          ownerId: user.id,
          tripId: selectedTripForFuel && selectedTripForFuel !== 'NONE' ? Number(selectedTripForFuel) : null,
          fuelType: fuelTypeChoice,
          quantity: qtyNum,
          rate: rateNum,
          totalCost: total,
          odometer: odoNum,
          station: fuelStationName.trim() || 'Highway Fuel Pump',
          billNumber: fuelBillNumber.trim(),
          notes: fuelNotes.trim(),
          fuelDate: fuelDateInput || formatDateISO(new Date()),
          fuelTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        const res = await apiFetch('/api/travel/fuel-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          setShowAddFuelModal(false);
          setFuelQty('');
          setFuelOdometer('');
          setFuelStationName('');
          setFuelBillNumber('');
          setFuelNotes('');
          await Promise.all([loadTravelFuelLogs(fuelTripFilter), loadTravelTrips()]);
          Alert.alert('Saved!', 'Fuel log recorded successfully.');
          return;
        } else {
          const err = await res.json().catch(() => ({}));
          Alert.alert(t('common_error'), err.error || 'Failed to save fuel log.');
          return;
        }
      } catch {
        Alert.alert(t('common_error'), t('common_networkError'));
        return;
      }
    }

    if (!user?.id) return;
    try {
      const res = await apiFetch('/api/driver/fuel-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: user.id,
          fuelType: fuelTypeChoice,
          quantity: finalQty,
          rate: finalRate,
          totalCost: total,
          odometer: odoNum,
          station: fuelStationName.trim() || 'City Fuel Station',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        Alert.alert(t('common_error'), err.error || 'Failed to save fuel log.');
        return;
      }
    } catch {
      Alert.alert(t('common_error'), t('common_networkError'));
      return;
    }

    loadDriverFuelLogs();
    loadDriverFuelLogsHistory();

    // Auto-record to Daily Ledger Khata as Cash Out!
    const newTx: LedgerTransaction = {
      id: `tx-${Date.now()}`,
      type: 'out',
      amount: total,
      party: `Fuel: ${fuelTypeChoice}${finalQty > 0 ? ` (${finalQty} ${fuelTypeChoice === 'CNG' ? 'Kg' : 'L'})` : ''}`,
      category: 'Fuel Expense',
      paymentMode: 'Cash',
      date: 'Today',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setTransactions([newTx, ...transactions]);

    setShowAddFuelModal(false);
    setFuelQty('');
    setFuelOdometer('');
    setFuelStationName('');
    setFuelTotalOverride('');
    setFuelVoiceTranscript('');
    setFuelVoiceConfirmed(false);
  }

  function handleSaveVehicle() {
    if (!editVehReg.trim()) {
      Alert.alert('Invalid Entry', 'Please enter vehicle registration number.');
      return;
    }
    setVehicle(prev => ({
      ...prev,
      regNumber: editVehReg.trim().toUpperCase(),
      model: editVehModel.trim() || prev.model,
      insuranceExpiry: editVehInsurance.trim() || prev.insuranceExpiry,
      fitnessExpiry: editVehFitness.trim() || prev.fitnessExpiry,
      pucExpiry: editVehPuc.trim() || prev.pucExpiry,
    }));
    setShowEditVehicleModal(false);
  }

  // Calculate totals
  const totalCashIn = transactions.filter(t => t.type === 'in').reduce((acc, t) => acc + t.amount, 0);
  const totalCashOut = transactions.filter(t => t.type === 'out').reduce((acc, t) => acc + t.amount, 0);
  const netDailyBalance = totalCashIn - totalCashOut;

  const totalToCollect = dues.filter(d => d.type === 'to_collect').reduce((acc, d) => acc + d.amount, 0);
  const totalToPay = dues.filter(d => d.type === 'to_pay').reduce((acc, d) => acc + d.amount, 0);

  const totalCollectionToCollect = collectionSchedule
    .filter(item => item.status !== 'COLLECTED')
    .reduce((acc, item) => acc + (item.expectedAmount || item.expected_amount || item.amount || 0), 0);

  // Business-specific KPI metrics
  const totalTripDistance = estimateTotalDistanceKm(trips);
  const totalTripEarnings = trips.reduce((acc, t) => acc + t.fare, 0);
  const totalFuelCost = fuelLogs.reduce((acc, f) => acc + f.totalCost, 0);
  const totalFuelLitres = fuelLogs.reduce((acc, f) => acc + f.quantity, 0);
  const totalInventoryItems = inventory.reduce((acc, i) => acc + i.stockQty, 0);
  const lowStockCount = inventory.filter(i => i.stockQty <= i.lowStockThreshold).length;
  const totalCollectedToday = collections.reduce((acc, c) => acc + c.amountCollected, 0);

  const filteredTransactions = transactions.filter(t => {
    if (txFilter === 'in') return t.type === 'in';
    if (txFilter === 'out') return t.type === 'out';
    return true;
  });

  // If user is logged in, show Customer Portal
  if (user) {
    return (
      <View
        style={[styles.mainScreen, isDarkMode && styles.mainScreenDark]}
        onStartShouldSetResponderCapture={() => {
          registerActivity();
          return false;
        }}>
        {/* Top Header Bar with Safe Area spacing */}
        <LinearGradient
          colors={[colors.brandDark, colors.brand, colors.brandLight]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.topHeader, { paddingTop: Math.max(insets.top + 8, Platform.OS === 'android' ? 44 : 20) }]}>
          <Animated.View
            style={{
              opacity: headerAnim,
              transform: [{ translateY: headerAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
            }}>
            <View style={styles.headerUserRow}>
              <Pressable onPress={() => setActiveTab('profile')} style={styles.avatarCircle}>
                <Text style={styles.avatarText}>{user.fullName.charAt(0)}</Text>
              </Pressable>
              <View style={styles.userInfoCol}>
                <View style={styles.userTitleRow}>
                  <Text style={styles.greetingText} numberOfLines={1}>
                    {t(getGreetingKey(), { name: user.fullName.split(' ')[0] })}
                  </Text>
                  <View style={styles.activeBadge}>
                    <View style={styles.activeBadgeDot} />
                    <Text style={styles.activeBadgeText}>{t('header_active')}</Text>
                  </View>
                </View>
                <Text style={styles.businessCategoryText} numberOfLines={1}>
                  {getBusinessIcon(user.businessType)} {user.businessType}
                </Text>
              </View>
              <Pressable
                onPress={() => Alert.alert(t('header_notifications'), t('header_noNotifications'))}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                style={styles.headerIconBtn}>
                <Text style={{ fontSize: 17 }}>🔔</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowLanguageModal(true)}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                style={styles.headerIconBtn}>
                <Text style={{ fontSize: 17 }}>🌐</Text>
              </Pressable>
              <Pressable
                onPress={handleLogout}
                hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                style={({ pressed }) => [styles.logoutBtn, pressed && styles.logoutBtnPressed]}>
                <Text style={styles.logoutBtnText}>{t('header_logout')}</Text>
              </Pressable>
            </View>

            {/* Dynamic Feature-Gated Tab Navigation */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.navTabContainer}>
              {visibleTabs.map(tab => (
                <Pressable
                  key={tab.key}
                  onPress={() => setActiveTab(tab.key)}
                  style={[styles.navTab, activeTab === tab.key && styles.navTabActive]}>
                  <Text style={[styles.navTabText, activeTab === tab.key && styles.navTabTextActive]}>
                    {tab.icon} {tab.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        </LinearGradient>

        {/* Tab Content */}
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {showDailySummary && dailySummaryText && (
            <View style={styles.dailySummaryBanner}>
              <Text style={styles.dailySummaryIcon}>🤖</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.dailySummaryTitle}>{t('summary_dailyInsight')}</Text>
                <Text style={styles.dailySummaryText}>{dailySummaryText}</Text>
              </View>
              <Pressable onPress={handleDismissDailySummary} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.dailySummaryClose}>✕</Text>
              </Pressable>
            </View>
          )}
          {activeTab === 'home' && (
            <View>
              {!isTravelBusiness && (
                <View style={styles.homeBannerCard}>
                  <Text style={styles.homeBannerIcon}>{getBusinessIcon(user.businessType)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.homeBannerTitle} numberOfLines={2}>
                      {t(getGreetingKey(), { name: user.fullName.split(' ')[0] })}
                    </Text>
                    <Text style={styles.homeBannerSubtitle}>
                      {(isBuildingBusiness && myBuilding?.name) ? myBuilding.name : user.businessType} • {t('header_active')} • {user.activePlan}
                    </Text>
                  </View>
                </View>
              )}

              {isTravelBusiness && (() => {
                const todayISO = formatDateISO(new Date());
                const todaysTrips = travelTrips.filter((tr: any) => tr.travelDate === todayISO);
                const todaysBookings = todaysTrips.reduce((sum: number, tr: any) => sum + (tr.bookedCount || 0), 0);
                const totalRevenue = travelTrips.reduce((sum: number, tr: any) => sum + (tr.revenue || 0), 0);
                const totalFuelCost = travelFuelLogs.reduce((sum: number, log: any) => sum + (log.totalCost || 0), 0);
                const pendingBookings = travelTrips.filter((tr: any) => (tr.pendingAmount || 0) > 0).length;
                return (
                  <>
                    {weatherStatus ? (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, marginBottom: 14,
                        backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
                      }}>
                        <Text style={{ fontSize: 24 }}>{weatherStatus.icon}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>{t('drv_weatherStatusTitle')}</Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>{weatherStatus.label} · {weatherStatus.tempC}°C</Text>
                        </View>
                      </View>
                    ) : weatherUnavailableReason === 'permission' ? (
                      <Pressable
                        onPress={() => Linking.openSettings()}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, marginBottom: 14,
                          backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
                        }}>
                        <Text style={{ fontSize: 24 }}>📍</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>{t('drv_weatherStatusTitle')}</Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>{t('drv_weatherPermissionNeeded')}</Text>
                        </View>
                        <Text style={{ fontSize: 18, color: colors.muted }}>›</Text>
                      </Pressable>
                    ) : weatherUnavailableReason === 'error' ? (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, marginBottom: 14,
                        backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
                      }}>
                        <Text style={{ fontSize: 24 }}>⚠️</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>{t('drv_weatherStatusTitle')}</Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>{t('drv_weatherUnavailable')}</Text>
                        </View>
                      </View>
                    ) : null}

                    <View style={styles.seatMapCard}>
                      <Text style={styles.sectionHeading}>{t('drv_navigateTitle')}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 10 }}>{t('drv_navigateHint')}</Text>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TextInput
                          placeholder={t('drv_navigateDestinationPh')}
                          placeholderTextColor={colors.muted}
                          style={[styles.modalInput, { flex: 1 }]}
                          value={navigateDestination}
                          onChangeText={setNavigateDestination}
                          onSubmitEditing={handleNavigate}
                          returnKeyType="go"
                        />
                        <Pressable onPress={handleNavigate} style={[styles.primaryPillBtn, { justifyContent: 'center' }]}>
                          <Text style={styles.primaryPillBtnText}>🧭 {t('drv_navigateGo')}</Text>
                        </Pressable>
                      </View>
                    </View>

                    {routeSafetyAdvisory && (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, marginBottom: 14,
                        backgroundColor: routeSafetyAdvisory.severity === 'high' ? colors.redBg : colors.amberBg,
                        borderWidth: 1, borderColor: routeSafetyAdvisory.severity === 'high' ? colors.redBorder : colors.amberBorder,
                      }}>
                        <Text style={{ fontSize: 20 }}>{routeSafetyAdvisory.severity === 'high' ? '⚠️' : '🌙'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>{t('drv_safetyTitle')}</Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>{routeSafetyAdvisory.message}</Text>
                        </View>
                      </View>
                    )}

                    {renderHomeCardGrid([
                      { icon: '🚌', label: t('home_totalBuses'), value: String(travelVehicles.length), color: colors.brand },
                      { icon: '🗓️', label: t('home_todaysTrips'), value: String(todaysTrips.length), color: colors.blue },
                      { icon: '🎫', label: t('home_todaysBookings'), value: String(todaysBookings), color: colors.green },
                      { icon: '💰', label: t('home_bookingRevenue'), value: `₹${totalRevenue.toLocaleString()}`, color: colors.brand },
                      { icon: '⛽', label: t('home_fuelExpenses'), value: `₹${totalFuelCost.toLocaleString()}`, color: colors.amber },
                      { icon: '⏳', label: t('home_pendingBookings'), value: String(pendingBookings), color: colors.red },
                    ])}
                  </>
                );
              })()}

              {!isTravelBusiness && hasFeature('trips') && (() => {
                const cashTotal = driverTripsHistory.filter(tr => tr.paymentMode === 'Cash').reduce((sum, tr) => sum + tr.fare, 0);
                const upiTotal = driverTripsHistory.filter(tr => tr.paymentMode === 'UPI').reduce((sum, tr) => sum + tr.fare, 0);
                const dayBuckets = Array.from({ length: 7 }).map((_, idx) => {
                  const d = new Date();
                  d.setHours(0, 0, 0, 0);
                  d.setDate(d.getDate() - (6 - idx));
                  const dayStart = d.getTime();
                  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
                  const amount = driverTripsHistory
                    .filter(tr => tr.tripTimeMs >= dayStart && tr.tripTimeMs < dayEnd)
                    .reduce((sum, tr) => sum + tr.fare, 0);
                  return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), amount };
                });
                const recentPayments = driverTripsHistory.slice().sort((a, b) => b.tripTimeMs - a.tripTimeMs).slice(0, 5);

                // Earnings-vs-usual: average of this same weekday over past weeks (excluding
                // today), compared against today's earnings so far - gives the driver a sense
                // of whether today's pace is ahead or behind their own normal rhythm.
                const todayStart = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
                const todayDow = new Date().getDay();
                const pastSameWeekdayTotals = new Map<string, number>();
                driverTripsHistory.forEach(tr => {
                  if (tr.tripTimeMs >= todayStart) return;
                  const d = new Date(tr.tripTimeMs);
                  if (d.getDay() !== todayDow) return;
                  const key = d.toDateString();
                  pastSameWeekdayTotals.set(key, (pastSameWeekdayTotals.get(key) || 0) + tr.fare);
                });
                const pastTotals = Array.from(pastSameWeekdayTotals.values());
                const usualForToday = pastTotals.length ? Math.round(pastTotals.reduce((a, b) => a + b, 0) / pastTotals.length) : null;
                const paceDiffPct = usualForToday && usualForToday > 0 ? Math.round(((totalTripEarnings - usualForToday) / usualForToday) * 100) : null;
                const todayWeekdayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long' });

                const docChecks = [
                  { key: 'insurance', label: t('veh_insurance'), iso: vehicle.insuranceExpiry },
                  { key: 'fitness', label: t('veh_fitnessCert'), iso: vehicle.fitnessExpiry },
                  { key: 'puc', label: t('veh_pucCert'), iso: vehicle.pucExpiry },
                ].map(doc => ({ ...doc, status: getExpiryStatus(doc.iso) }));
                const urgentDocs = docChecks.filter(d => d.status === 'expired' || d.status === 'expiring');

                return (
                  <>
                    {routeSafetyAdvisory && (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, marginBottom: 14,
                        backgroundColor: routeSafetyAdvisory.severity === 'high' ? colors.redBg : colors.amberBg,
                        borderWidth: 1, borderColor: routeSafetyAdvisory.severity === 'high' ? colors.redBorder : colors.amberBorder,
                      }}>
                        <Text style={{ fontSize: 20 }}>{routeSafetyAdvisory.severity === 'high' ? '⚠️' : '🌙'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>{t('drv_safetyTitle')}</Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>{routeSafetyAdvisory.message}</Text>
                        </View>
                      </View>
                    )}

                    {weatherStatus ? (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, marginBottom: 14,
                        backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
                      }}>
                        <Text style={{ fontSize: 24 }}>{weatherStatus.icon}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>{t('drv_weatherStatusTitle')}</Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>{weatherStatus.label} · {weatherStatus.tempC}°C</Text>
                        </View>
                      </View>
                    ) : weatherUnavailableReason === 'permission' ? (
                      <Pressable
                        onPress={() => Linking.openSettings()}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, marginBottom: 14,
                          backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
                        }}>
                        <Text style={{ fontSize: 24 }}>📍</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>{t('drv_weatherStatusTitle')}</Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>{t('drv_weatherPermissionNeeded')}</Text>
                        </View>
                        <Text style={{ fontSize: 18, color: colors.muted }}>›</Text>
                      </Pressable>
                    ) : weatherUnavailableReason === 'error' ? (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, marginBottom: 14,
                        backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border,
                      }}>
                        <Text style={{ fontSize: 24 }}>⚠️</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>{t('drv_weatherStatusTitle')}</Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>{t('drv_weatherUnavailable')}</Text>
                        </View>
                      </View>
                    ) : null}

                    <View style={styles.seatMapCard}>
                      <Text style={styles.sectionHeading}>{t('drv_navigateTitle')}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2, marginBottom: 10 }}>{t('drv_navigateHint')}</Text>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <TextInput
                          placeholder={t('drv_navigateDestinationPh')}
                          placeholderTextColor={colors.muted}
                          style={[styles.modalInput, { flex: 1 }]}
                          value={navigateDestination}
                          onChangeText={setNavigateDestination}
                          onSubmitEditing={handleNavigate}
                          returnKeyType="go"
                        />
                        <Pressable onPress={handleNavigate} style={[styles.primaryPillBtn, { justifyContent: 'center' }]}>
                          <Text style={styles.primaryPillBtnText}>🧭 {t('drv_navigateGo')}</Text>
                        </Pressable>
                      </View>
                    </View>

                    {urgentDocs.length > 0 && (
                      <Pressable
                        onPress={() => setActiveTab('vehicle')}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, marginBottom: 14,
                          backgroundColor: urgentDocs.some(d => d.status === 'expired') ? colors.redBg : colors.amberBg,
                          borderWidth: 1, borderColor: urgentDocs.some(d => d.status === 'expired') ? colors.redBorder : colors.amberBorder,
                        }}>
                        <Text style={{ fontSize: 20 }}>{urgentDocs.some(d => d.status === 'expired') ? '⚠️' : '⏳'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>{t('drv_docReminderTitle')}</Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>
                            {urgentDocs
                              .map(d => `${d.label} (${d.status === 'expired' ? t('trv_expired') : t('trv_expiringSoon')})`)
                              .join(' · ')}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 18, color: colors.muted }}>›</Text>
                      </Pressable>
                    )}

                    {renderHomeCardGrid([
                      { icon: '🗺️', label: t('home_todaysTrips'), value: String(trips.length), color: colors.brand },
                      { icon: '📏', label: t('home_todaysDistance'), value: `${totalTripDistance} km`, color: colors.blue },
                      { icon: '💵', label: t('home_todaysIncome'), value: `₹${totalTripEarnings}`, color: colors.green },
                      {
                        icon: '📊',
                        label: t('home_todaysProfit'),
                        value: `₹${totalTripEarnings - totalFuelCost}`,
                        color: (totalTripEarnings - totalFuelCost) >= 0 ? colors.green : colors.red,
                      },
                    ])}

                    {paceDiffPct !== null && usualForToday !== null && (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12, marginBottom: 14,
                        backgroundColor: paceDiffPct >= 0 ? colors.greenBg : colors.amberBg,
                        borderWidth: 1, borderColor: paceDiffPct >= 0 ? colors.greenBorder : colors.amberBorder,
                      }}>
                        <Text style={{ fontSize: 20 }}>{paceDiffPct >= 0 ? '📈' : '📉'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>
                            {paceDiffPct >= 0
                              ? t('drv_paceAhead', { pct: String(Math.abs(paceDiffPct)), day: todayWeekdayLabel })
                              : t('drv_paceBehind', { pct: String(Math.abs(paceDiffPct)), day: todayWeekdayLabel })}
                          </Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>
                            {t('drv_paceDetail', { today: `₹${totalTripEarnings}`, usual: `₹${usualForToday}` })}
                          </Text>
                        </View>
                      </View>
                    )}

                    <View style={styles.seatMapCard}>
                      <Text style={styles.sectionHeading}>{t('drv_paymentMix')}</Text>
                      <View style={{ marginTop: 10 }}>{renderPaymentMixChart(cashTotal, upiTotal)}</View>
                    </View>

                    <View style={styles.seatMapCard}>
                      <Text style={styles.sectionHeading}>{t('drv_last7Days')}</Text>
                      <View style={{ marginTop: 6 }}>{renderEarningsTrendChart(dayBuckets)}</View>
                    </View>

                    <View style={styles.seatMapCard}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={styles.sectionHeading}>{t('drv_paymentHistory')}</Text>
                        <Pressable onPress={() => setActiveTab('trips')} hitSlop={8}>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.brand }}>{t('drv_viewAll')}</Text>
                        </Pressable>
                      </View>
                      {recentPayments.length === 0 ? (
                        <Text style={[styles.emptyStateText, { marginTop: 10 }]}>{t('drv_noPaymentsYet')}</Text>
                      ) : (
                        <View style={{ marginTop: 8 }}>
                          {recentPayments.map((entry, idx) => (
                            <View
                              key={idx}
                              style={{
                                flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
                                borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: colors.border,
                              }}>
                              <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.navy }} numberOfLines={1}>
                                  {entry.route || entry.locationName || t('drv_locationUnavailable')}
                                </Text>
                                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                                  {new Date(entry.tripTimeMs).toLocaleDateString([], { month: 'short', day: 'numeric' })} ·{' '}
                                  {new Date(entry.tripTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Text>
                              </View>
                              <Text style={{ fontSize: 14, fontWeight: '800', color: colors.green, marginRight: 8 }}>
                                +₹{entry.fare.toLocaleString()}
                              </Text>
                              <View style={[styles.modeBadge, entry.paymentMode === 'UPI' ? styles.modeBadgeUpi : styles.modeBadgeCash]}>
                                <Text style={[styles.modeBadgeText, entry.paymentMode === 'UPI' ? styles.modeBadgeTextUpi : styles.modeBadgeTextCash]}>
                                  {entry.paymentMode}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  </>
                );
              })()}

              {(hasFeature('inventory') || hasFeature('products')) && renderHomeCardGrid([
                { icon: '📦', label: t('home_totalProducts'), value: String(inventory.length), color: colors.brand },
                { icon: '📊', label: t('home_totalUnits'), value: String(totalInventoryItems), color: colors.blue },
                { icon: '⚠️', label: t('home_lowStockItems'), value: String(lowStockCount), color: lowStockCount > 0 ? colors.red : colors.green },
                { icon: '🧾', label: t('home_todaysSales'), value: `₹${(inventorySummary?.totalAmount || 0).toLocaleString()}`, color: colors.green },
              ])}

              {isBuildingBusiness && (() => {
                const todayISO = formatDateISO(new Date());
                const todaysCollection = buildingPayments
                  .filter((p: any) => p.paymentDate === todayISO)
                  .reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
                return renderHomeCardGrid([
                  { icon: '👥', label: t('home_totalMembers'), value: String(buildingMembers.length), color: colors.brand },
                  { icon: '📢', label: t('home_pendingComplaints'), value: String(complaintsOpenCount), color: complaintsOpenCount > 0 ? colors.red : colors.green },
                  { icon: '🧾', label: t('home_maintenanceDue'), value: `₹${(billsSummary?.totalPending || 0).toLocaleString()}`, color: colors.amber },
                  { icon: '💰', label: t('home_todaysCollection'), value: `₹${todaysCollection.toLocaleString()}`, color: colors.green },
                ]);
              })()}

              <Text style={styles.sectionHeading}>{t('home_quickActions')}</Text>
              <View style={styles.homeQuickActionGrid}>
                {visibleTabs
                  .filter(tab => !['home', 'plan', 'profile', 'ledger', 'dues'].includes(tab.key))
                  .map(tab => (
                    <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} style={styles.homeQuickActionCard}>
                      <Text style={styles.homeQuickActionIcon}>{tab.icon}</Text>
                      <Text style={styles.homeQuickActionLabel} numberOfLines={2}>{tab.label}</Text>
                    </Pressable>
                  ))}
              </View>
            </View>
          )}

          {activeTab === 'ledger' && !isCollection && (
            <View>
              {/* Daily Balance Overview Card */}
              <View style={styles.balanceCard}>
                <View style={styles.balanceHeaderRow}>
                  <Text style={styles.balanceCardLabel}>TODAY'S NET BALANCE</Text>
                  <View style={styles.dateChip}>
                    <Text style={styles.dateChipText}>Today's Cashbook</Text>
                  </View>
                </View>

                <Text
                  style={[
                    styles.balanceMainAmount,
                    netDailyBalance >= 0 ? styles.textPositive : styles.textNegative,
                  ]}>
                  {netDailyBalance >= 0 ? `+ ₹${netDailyBalance.toLocaleString()}` : `- ₹${Math.abs(netDailyBalance).toLocaleString()}`}
                </Text>

                <View style={styles.balanceSplitRow}>
                  <View style={[styles.splitBox, styles.splitBoxGreen]}>
                    <Text style={styles.splitBoxLabel}>CASH IN (COLLECTED)</Text>
                    <Text style={[styles.splitBoxValue, styles.textPositive]}>
                      + ₹{totalCashIn.toLocaleString()}
                    </Text>
                  </View>

                  <View style={[styles.splitBox, styles.splitBoxRed]}>
                    <Text style={styles.splitBoxLabel}>CASH OUT (SPENT)</Text>
                    <Text style={[styles.splitBoxValue, styles.textNegative]}>
                      - ₹{totalCashOut.toLocaleString()}
                    </Text>
                  </View>
                </View>

                {/* Quick Add Buttons */}
                <View style={styles.quickActionRow}>
                  <Pressable
                    onPress={() => {
                      setTxType('in');
                      setShowAddModal(true);
                    }}
                    style={[styles.quickAddBtn, styles.quickAddBtnIn]}>
                    <Text style={styles.quickAddBtnTextIn}>+ Cash In (Got)</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setTxType('out');
                      setShowAddModal(true);
                    }}
                    style={[styles.quickAddBtn, styles.quickAddBtnOut]}>
                    <Text style={styles.quickAddBtnTextOut}>- Cash Out (Gave)</Text>
                  </Pressable>
                </View>
              </View>

              {/* Transactions Section */}
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>Daily Transactions ({filteredTransactions.length})</Text>
                <View style={styles.filterPillsRow}>
                  <Pressable
                    onPress={() => setTxFilter('all')}
                    style={[styles.filterPill, txFilter === 'all' && styles.filterPillActive]}>
                    <Text style={[styles.filterPillText, txFilter === 'all' && styles.filterPillTextActive]}>
                      All
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setTxFilter('in')}
                    style={[styles.filterPill, txFilter === 'in' && styles.filterPillActive]}>
                    <Text style={[styles.filterPillText, txFilter === 'in' && styles.filterPillTextActive]}>
                      In
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setTxFilter('out')}
                    style={[styles.filterPill, txFilter === 'out' && styles.filterPillActive]}>
                    <Text style={[styles.filterPillText, txFilter === 'out' && styles.filterPillTextActive]}>
                      Out
                    </Text>
                  </Pressable>
                </View>
              </View>

              {filteredTransactions.map(tx => (
                <View key={tx.id} style={styles.txCard}>
                  <View style={[styles.txIconBox, tx.type === 'in' ? styles.txIconBoxIn : styles.txIconBoxOut]}>
                    <Text style={[styles.txIconSymbol, tx.type === 'in' ? styles.textPositive : styles.textNegative]}>
                      {tx.type === 'in' ? '↓' : '↑'}
                    </Text>
                  </View>
                  <View style={styles.txDetailsCol}>
                    <Text style={styles.txPartyName}>{tx.party}</Text>
                    <View style={styles.txMetaRow}>
                      <Text style={styles.txCategoryTag}>{tx.category}</Text>
                      <Text style={styles.txBullet}>•</Text>
                      <Text style={styles.txModeTag}>{tx.paymentMode}</Text>
                      <Text style={styles.txBullet}>•</Text>
                      <Text style={styles.txTime}>{tx.time}</Text>
                    </View>
                  </View>
                  <View style={styles.txAmountCol}>
                    <Text
                      style={[
                        styles.txAmountText,
                        tx.type === 'in' ? styles.textPositive : styles.textNegative,
                      ]}>
                      {tx.type === 'in' ? `+₹${tx.amount}` : `-₹${tx.amount}`}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Business Feature Tab: Vehicle (Auto Driver: single vehicle / Travels: fleet of buses) */}
          {activeTab === 'vehicle' && hasFeature('vehicle') && (
            <View>
              {isTravelBusiness ? (
                !selectedTravelVehicle ? (
                  <>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={styles.sectionHeading}>{t('trv_myBuses')}</Text>
                      <Pressable onPress={handleOpenAddTravelVehicle} style={styles.primaryPillBtn}>
                        <Text style={styles.primaryPillBtnText}>{t('trv_addVehicle')}</Text>
                      </Pressable>
                    </View>
                    {travelVehiclesLoading && travelVehicles.length === 0 ? (
                      <Text style={styles.emptyStateText}>{t('common_loading')}</Text>
                    ) : travelVehicles.length === 0 ? (
                      <Text style={styles.emptyStateText}>{t('trv_emptyVehicles')}</Text>
                    ) : (
                      travelVehicles.map(v => (
                        <Pressable key={v.id} onPress={() => setSelectedTravelVehicle(v)} style={styles.tripCard}>
                          <View style={styles.tripLeftCol}>
                            <View style={styles.tripRouteRow}>
                              <Text style={styles.tripRoutePin}>🚌</Text>
                              <Text style={styles.tripRouteText}>{v.regNumber}</Text>
                            </View>
                            <View style={styles.tripMetricsRow}>
                              <Text style={styles.tripMetricText}>{v.model || t('trv_noModel')}</Text>
                              <Text style={styles.bulletDot}>•</Text>
                              <Text style={styles.tripTimeText}>{vehicleTypeIconLabel(v.busType === 'sleeper' ? 'sleeper' : v.busType === 'ertiga' ? 'ertiga' : 'seater')}</Text>
                              <Text style={styles.bulletDot}>•</Text>
                              <Text style={styles.tripTimeText}>⛽ {v.fuelType}</Text>
                            </View>
                          </View>
                          <View style={styles.tripRightCol}>
                            <Text style={styles.tripFareText}>{v.totalKm.toLocaleString()} KM</Text>
                            <View style={[styles.modeBadge, v.status === 'active' ? styles.modeBadgeUpi : { backgroundColor: colors.border }]}>
                              <Text style={[styles.modeBadgeText, v.status === 'active' ? styles.modeBadgeTextUpi : { color: colors.muted }]}>
                                {v.status === 'active' ? t('veh_active') : t('trv_inactive')}
                              </Text>
                            </View>
                          </View>
                        </Pressable>
                      ))
                    )}
                  </>
                ) : (
                  <>
                    <Pressable
                      onPress={() => setSelectedTravelVehicle(null)}
                      style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                      <Text style={{ fontSize: 14, color: colors.brand, fontWeight: '700' }}>← {t('trv_myBuses')}</Text>
                    </Pressable>

                    <View style={styles.businessHeroCard}>
                      <View style={styles.businessHeroHeader}>
                        <View style={styles.businessIconBadge}>
                          <Text style={{ fontSize: 28 }}>🚌</Text>
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={styles.businessHeroTitle}>{selectedTravelVehicle.regNumber}</Text>
                            <View style={[styles.activeBadge, selectedTravelVehicle.status !== 'active' && { backgroundColor: colors.border }]}>
                              <Text style={[styles.activeBadgeText, selectedTravelVehicle.status !== 'active' && { color: colors.muted }]}>
                                {selectedTravelVehicle.status === 'active' ? t('veh_active') : t('trv_inactive')}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.businessHeroSubtitle}>{selectedTravelVehicle.model || t('trv_noModel')}</Text>
                          <View style={styles.pillRow}>
                            <View style={styles.featureMiniPill}>
                              <Text style={styles.featureMiniPillText}>
                                {vehicleTypeIconLabel(selectedTravelVehicle.busType === 'sleeper' ? 'sleeper' : selectedTravelVehicle.busType === 'ertiga' ? 'ertiga' : 'seater')}
                              </Text>
                            </View>
                            <View style={styles.featureMiniPill}>
                              <Text style={styles.featureMiniPillText}>⛽ {selectedTravelVehicle.fuelType}</Text>
                            </View>
                            {!!selectedTravelVehicle.regDate && (
                              <View style={styles.featureMiniPill}>
                                <Text style={styles.featureMiniPillText}>
                                  📅 {t('veh_reg')} {formatDisplayDate(selectedTravelVehicle.regDate)}
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                      </View>

                      <View style={styles.vehicleOdoBox}>
                        <Text style={styles.vehicleOdoLabel}>{t('veh_totalDistance')}</Text>
                        <Text style={styles.vehicleOdoValue}>{selectedTravelVehicle.totalKm.toLocaleString()} KM</Text>
                        <Text style={styles.vehicleOdoSub}>{t('veh_recordedAcross')}</Text>
                      </View>

                      <Pressable
                        onPress={() => handleOpenEditTravelVehicle(selectedTravelVehicle)}
                        style={styles.actionBtnOutline}>
                        <Text style={styles.actionBtnOutlineText}>{t('veh_editDetails')}</Text>
                      </Pressable>
                    </View>

                    <Text style={styles.sectionHeading}>{t('veh_complianceDocs')}</Text>
                    <View style={styles.card}>
                      <View style={styles.complianceRow}>
                        <View style={styles.complianceIconBox}>
                          <Text style={{ fontSize: 18 }}>🛡️</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.complianceTitle}>{t('veh_insurance')}</Text>
                          <Text style={styles.complianceDesc}>
                            {selectedTravelVehicle.insuranceExpiry
                              ? `${t('veh_expires')} ${formatDisplayDate(selectedTravelVehicle.insuranceExpiry)}`
                              : t('trv_notSet')}
                          </Text>
                        </View>
                        {renderComplianceBadge(selectedTravelVehicle.insuranceExpiry)}
                      </View>

                      <View style={styles.cardDivider} />

                      <View style={styles.complianceRow}>
                        <View style={styles.complianceIconBox}>
                          <Text style={{ fontSize: 18 }}>📋</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.complianceTitle}>{t('veh_fitnessCert')}</Text>
                          <Text style={styles.complianceDesc}>
                            {selectedTravelVehicle.fitnessExpiry
                              ? `${t('veh_expires')} ${formatDisplayDate(selectedTravelVehicle.fitnessExpiry)}`
                              : t('trv_notSet')}
                          </Text>
                        </View>
                        {renderComplianceBadge(selectedTravelVehicle.fitnessExpiry)}
                      </View>

                      <View style={styles.cardDivider} />

                      <View style={styles.complianceRow}>
                        <View style={styles.complianceIconBox}>
                          <Text style={{ fontSize: 18 }}>🌿</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.complianceTitle}>{t('veh_pucCert')}</Text>
                          <Text style={styles.complianceDesc}>
                            {selectedTravelVehicle.pucExpiry
                              ? `${t('veh_expires')} ${formatDisplayDate(selectedTravelVehicle.pucExpiry)}`
                              : t('trv_notSet')}
                          </Text>
                        </View>
                        {renderComplianceBadge(selectedTravelVehicle.pucExpiry)}
                      </View>
                    </View>

                    <Pressable
                      onPress={() => handleDeleteTravelVehicle(selectedTravelVehicle)}
                      style={[styles.modalSubmitBtn, { backgroundColor: colors.red, marginTop: 16 }]}>
                      <Text style={styles.modalSubmitBtnText}>🗑️ {t('trv_deleteVehicle')}</Text>
                    </Pressable>
                  </>
                )
              ) : (
                <>
                  {/* Vehicle Hero Card (Auto Driver, single vehicle) */}
                  <View style={styles.businessHeroCard}>
                    <View style={styles.businessHeroHeader}>
                      <View style={styles.businessIconBadge}>
                        <Text style={{ fontSize: 28 }}>🛺</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={styles.businessHeroTitle}>{vehicle.regNumber}</Text>
                          <View style={styles.activeBadge}>
                            <Text style={styles.activeBadgeText}>{t('veh_active')}</Text>
                          </View>
                        </View>
                        <Text style={styles.businessHeroSubtitle}>{vehicle.model}</Text>
                        <View style={styles.pillRow}>
                          <View style={styles.featureMiniPill}>
                            <Text style={styles.featureMiniPillText}>⛽ {vehicle.fuelType}</Text>
                          </View>
                          <View style={styles.featureMiniPill}>
                            <Text style={styles.featureMiniPillText}>📅 {t('veh_reg')} {vehicle.regDate}</Text>
                          </View>
                        </View>
                      </View>
                    </View>

                    {/* Odometer KPI Box */}
                    <View style={styles.vehicleOdoBox}>
                      <Text style={styles.vehicleOdoLabel}>{t('veh_totalDistance')}</Text>
                      <Text style={styles.vehicleOdoValue}>{vehicle.totalKm.toLocaleString()} KM</Text>
                      <Text style={styles.vehicleOdoSub}>{t('veh_recordedAcross')}</Text>
                    </View>

                    {/* Edit details button */}
                    <Pressable
                      onPress={() => {
                        setEditVehReg(vehicle.regNumber);
                        setEditVehModel(vehicle.model);
                        setEditVehInsurance(vehicle.insuranceExpiry);
                        setEditVehFitness(vehicle.fitnessExpiry);
                        setEditVehPuc(vehicle.pucExpiry);
                        setShowEditVehicleModal(true);
                      }}
                      style={styles.actionBtnOutline}>
                      <Text style={styles.actionBtnOutlineText}>{t('veh_editDetails')}</Text>
                    </Pressable>
                  </View>

                  {/* Compliance & Fitness Card */}
                  <Text style={styles.sectionHeading}>{t('veh_complianceDocs')}</Text>
                  <View style={styles.card}>
                    <View style={styles.complianceRow}>
                      <View style={styles.complianceIconBox}>
                        <Text style={{ fontSize: 18 }}>🛡️</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.complianceTitle}>{t('veh_insurance')}</Text>
                        <Text style={styles.complianceDesc}>{t('veh_expires')} {formatDisplayDate(vehicle.insuranceExpiry)}</Text>
                      </View>
                      {renderComplianceBadge(vehicle.insuranceExpiry)}
                    </View>

                    <View style={styles.cardDivider} />

                    <View style={styles.complianceRow}>
                      <View style={styles.complianceIconBox}>
                        <Text style={{ fontSize: 18 }}>📋</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.complianceTitle}>{t('veh_fitnessCert')}</Text>
                        <Text style={styles.complianceDesc}>{t('veh_expires')} {formatDisplayDate(vehicle.fitnessExpiry)}</Text>
                      </View>
                      {renderComplianceBadge(vehicle.fitnessExpiry)}
                    </View>

                    <View style={styles.cardDivider} />

                    <View style={styles.complianceRow}>
                      <View style={styles.complianceIconBox}>
                        <Text style={{ fontSize: 18 }}>🌿</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.complianceTitle}>{t('veh_pucCert')}</Text>
                        <Text style={styles.complianceDesc}>{t('veh_expires')} {formatDisplayDate(vehicle.pucExpiry)}</Text>
                      </View>
                      {renderComplianceBadge(vehicle.pucExpiry)}
                    </View>
                  </View>
                </>
              )}
            </View>
          )}

          {/* Business Feature Tab: Online Booking (Travels Bus Booking Online) */}
          {activeTab === 'online_booking' && isTravelBusiness && (
            <View>
              {!travelSelectedTrip ? (
                <>
                  {fareSuggestions.length > 0 && (
                    <View style={styles.seatMapCard}>
                      <Text style={styles.sectionHeading}>💡 {t('trv_fareSuggestionsTitle')}</Text>
                      {fareSuggestions.map(s => (
                        <View
                          key={s.tripId}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 10, marginTop: 10,
                            backgroundColor: s.signal === 'high_demand' ? colors.greenBg : colors.amberBg,
                            borderWidth: 1, borderColor: s.signal === 'high_demand' ? colors.greenBorder : colors.amberBorder,
                          }}>
                          <Text style={{ fontSize: 20 }}>{s.signal === 'high_demand' ? '📈' : '📉'}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>
                              {s.route} • {s.travelDate}
                            </Text>
                            <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>
                              {s.signal === 'high_demand'
                                ? t('trv_fareSuggestHigh', { current: String(s.currentFillPct), usual: String(s.historicalFillPct), days: String(s.daysLeft) })
                                : t('trv_fareSuggestLow', { current: String(s.currentFillPct), usual: String(s.historicalFillPct), days: String(s.daysLeft) })}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeading}>{t('trv_tripsHeading')}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Pressable
                        onPress={openTripListDateFilter}
                        style={{
                          width: 36, height: 36, borderRadius: 10, marginRight: 8,
                          alignItems: 'center', justifyContent: 'center',
                          backgroundColor: tripListDateFilter ? colors.brand : colors.brandBg,
                        }}>
                        <Text style={{ fontSize: 16 }}>{tripListDateFilter ? '📅' : '🗓️'}</Text>
                      </Pressable>
                      <Pressable onPress={handleOpenNewTrip} style={styles.primaryPillBtn}>
                        <Text style={styles.primaryPillBtnText}>{t('trv_newTrip')}</Text>
                      </Pressable>
                    </View>
                  </View>
                  {!!tripListDateFilter && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', backgroundColor: colors.brandBg,
                        borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12,
                      }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.brand }}>{tripListDateFilter}</Text>
                        <Pressable onPress={() => setTripListDateFilter('')} hitSlop={8} style={{ marginLeft: 8 }}>
                          <Text style={{ fontSize: 12, fontWeight: '800', color: colors.brand }}>✕</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}
                  {(() => {
                    const filteredTravelTrips = tripListDateFilter
                      ? travelTrips.filter(trip => trip.travelDate === tripListDateFilter)
                      : travelTrips;
                    if (filteredTravelTrips.length === 0) {
                      return (
                        <Text style={styles.emptyStateText}>
                          {tripListDateFilter ? t('trv_noTripsForDate') : t('trv_emptyTrips')}
                        </Text>
                      );
                    }
                    return filteredTravelTrips.map(trip => {
                    const past = isTripPast(trip);
                    return (
                    <Pressable key={trip.id} onPress={() => handleOpenTrip(trip)} style={styles.tripCard}>
                      <View style={styles.tripLeftCol}>
                        <View style={styles.tripRouteRow}>
                          <Text style={styles.tripRoutePin}>🚌</Text>
                          <Text style={[styles.tripRouteText, past && { color: colors.muted }]}>{trip.route}</Text>
                        </View>
                        <View style={styles.tripMetricsRow}>
                          <Text style={styles.tripMetricText}>
                            {trip.travelDate}{trip.departureTime ? `, ${trip.departureTime}` : ''}
                          </Text>
                          <Text style={styles.bulletDot}>•</Text>
                          <Text style={styles.tripTimeText}>{trip.bookedCount}/{trip.totalSeats} {t('trv_booked').toLowerCase()}</Text>
                          <Text style={styles.bulletDot}>•</Text>
                          <Text style={styles.tripTimeText}>{trip.busType === 'sleeper' ? `🛏️ ${t('trv_sleeper')}` : `💺 ${t('trv_seater')}`}</Text>
                        </View>
                      </View>
                      <View style={styles.tripRightCol}>
                        <Text style={styles.tripFareText}>₹{trip.revenue.toLocaleString()}</Text>
                        {trip.pendingAmount > 0 && (
                          <Text style={{ fontSize: 10, color: colors.amber, fontWeight: '700', marginTop: 1 }}>
                            ₹{trip.pendingAmount.toLocaleString()} {t('trv_pending').toLowerCase()}
                          </Text>
                        )}
                        {past ? (
                          <View style={[styles.modeBadge, { backgroundColor: colors.border }]}>
                            <Text style={[styles.modeBadgeText, { color: colors.muted }]}>{t('trv_departed')}</Text>
                          </View>
                        ) : (
                          <View style={[styles.modeBadge, styles.modeBadgeUpi]}>
                            <Text style={[styles.modeBadgeText, styles.modeBadgeTextUpi]}>{t('trv_manage')}</Text>
                          </View>
                        )}
                      </View>
                      <Pressable
                        onPress={() => handleDeleteTravelTrip(trip)}
                        hitSlop={10}
                        style={{
                          marginLeft: 10, width: 34, height: 34, borderRadius: 17,
                          alignItems: 'center', justifyContent: 'center', backgroundColor: colors.redBg,
                        }}>
                        <Text style={{ fontSize: 15 }}>🗑️</Text>
                      </Pressable>
                    </Pressable>
                    );
                    });
                  })()}
                </>
              ) : (
                <>
                  <Pressable onPress={() => { setTravelSelectedTrip(null); setSelectedSeatNumbers([]); }} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                    <Text style={{ fontSize: 14, color: colors.brand, fontWeight: '700' }}>← {t('trv_tripsHeading')}</Text>
                  </Pressable>

                  <View style={styles.businessHeroCard}>
                    <View style={styles.businessHeroHeader}>
                      <View style={styles.businessIconBadge}>
                        <Text style={{ fontSize: 24 }}>🚌</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.businessHeroTitle}>{travelSelectedTrip.route}</Text>
                        <Text style={styles.businessHeroSubtitle}>
                          {travelSelectedTrip.travelDate}{travelSelectedTrip.departureTime ? `, ${travelSelectedTrip.departureTime}` : ''}
                          {travelSelectedTrip.busNumber ? ` • ${travelSelectedTrip.busNumber}` : ''}
                          {' • '}{travelSelectedTrip.busType === 'sleeper' ? `🛏️ ${t('trv_sleeper')}` : `💺 ${t('trv_seater')}`}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {isTripPast(travelSelectedTrip) && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.border,
                      borderRadius: 12, padding: 12, marginBottom: 16,
                    }}>
                      <Text style={{ fontSize: 16 }}>🚏</Text>
                      <Text style={{ flex: 1, fontSize: 12, color: colors.slate, lineHeight: 17 }}>
                        {t('trv_tripDepartedBanner')}
                      </Text>
                    </View>
                  )}

                  <View style={styles.kpiRow}>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>{t('trv_booked')}</Text>
                      <Text style={[styles.kpiValue, styles.textPositive]}>{travelSelectedTrip.bookedCount}</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>{t('trv_available')}</Text>
                      <Text style={[styles.kpiValue, { color: colors.red }]}>{travelSelectedTrip.availableCount}</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>{t('trv_revenue')}</Text>
                      <Text style={[styles.kpiValue, { color: colors.brand }]}>₹{travelSelectedTrip.revenue.toLocaleString()}</Text>
                    </View>
                    {travelSelectedTrip.pendingAmount > 0 && (
                      <View style={styles.kpiCard}>
                        <Text style={styles.kpiLabel}>{t('trv_pending').toUpperCase()}</Text>
                        <Text style={[styles.kpiValue, { color: colors.amber }]}>₹{travelSelectedTrip.pendingAmount.toLocaleString()}</Text>
                      </View>
                    )}
                    {travelSelectedTrip.fuelCost > 0 && (
                      <View style={styles.kpiCard}>
                        <Text style={styles.kpiLabel}>{t('trv_netProfit')}</Text>
                        <Text style={[styles.kpiValue, { color: colors.slate }]}>
                          ₹{(travelSelectedTrip.revenue - travelSelectedTrip.fuelCost).toLocaleString()}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.seatMapCard}>
                    <Pressable
                      onPress={() => setShowSeatMap(v => !v)}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={styles.sectionHeading}>{t('trv_seatMap')}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand }}>
                        {showSeatMap ? `▲` : `▼`}
                      </Text>
                    </Pressable>
                    {showSeatMap && (
                      <View style={{ marginTop: 14 }}>
                        {travelSeatsLoading && travelSeats.length === 0 ? (
                          <Text style={styles.emptyStateText}>{t('common_loading')}</Text>
                        ) : (
                          renderBusLayout(travelSeats)
                        )}

                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginBottom: 14 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: colors.panel, borderWidth: 1.5, borderColor: colors.brand }} />
                            <Text style={{ fontSize: 12, color: colors.slate }}>{t('trv_available')}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: colors.brand }} />
                            <Text style={{ fontSize: 12, color: colors.slate }}>{t('trv_selected')}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: colors.green }} />
                            <Text style={{ fontSize: 12, color: colors.slate }}>{t('trv_booked')}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: colors.border, borderWidth: 1.5, borderColor: colors.muted }} />
                            <Text style={{ fontSize: 12, color: colors.slate }}>{t('trv_blocked')}</Text>
                          </View>
                        </View>
                        <Text style={{ fontSize: 11, color: colors.muted, marginTop: -6 }}>
                          {t('trv_longPressHint')}
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.seatMapCard}>
                    <Pressable
                      onPress={() => setShowCustomerDetails(v => !v)}
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={styles.sectionHeading}>{t('trv_customerDetails')}</Text>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand }}>
                        {showCustomerDetails ? `▲` : `▼`}
                      </Text>
                    </Pressable>
                    {showCustomerDetails && (() => {
                      const bookedSeats = travelSeats
                        .filter((s: any) => s.booked && s.booking)
                        .sort((a: any, b: any) => a.seatNumber - b.seatNumber);
                      if (bookedSeats.length === 0) {
                        return (
                          <Text style={[styles.emptyStateText, { marginTop: 14 }]}>{t('trv_noBookedSeatsYet')}</Text>
                        );
                      }
                      return (
                        <View style={{ marginTop: 14 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: 8 }}>
                            <Text style={[styles.customerGridHeaderText, { width: 40 }]}>{t('trv_seatShort')}</Text>
                            <Text style={[styles.customerGridHeaderText, { flex: 1 }]}>{t('trv_customer')}</Text>
                            <Text style={[styles.customerGridHeaderText, { width: 70, textAlign: 'center' }]}>{t('trv_paymentStatus')}</Text>
                            <Text style={[styles.customerGridHeaderText, { width: 40, textAlign: 'center' }]}>{t('trv_call')}</Text>
                          </View>
                          {bookedSeats.map((seat: any) => {
                            const isPending = seat.booking.paymentStatus === 'pending';
                            return (
                              <Pressable
                                key={seat.seatNumber}
                                onPress={() => handleTapSeat(seat)}
                                style={{
                                  flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                                  borderTopWidth: 1, borderTopColor: colors.border,
                                }}>
                                <View style={{ width: 40 }}>
                                  <View style={{
                                    width: 30, height: 30, borderRadius: 9, backgroundColor: colors.brandBg,
                                    alignItems: 'center', justifyContent: 'center',
                                  }}>
                                    <Text style={{ fontSize: 12, fontWeight: '800', color: colors.brand }}>{seat.seatNumber}</Text>
                                  </View>
                                </View>
                                <View style={{ flex: 1, paddingRight: 6 }}>
                                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.navy }} numberOfLines={1}>
                                    {seat.booking.passengerName}
                                  </Text>
                                  {!!seat.booking.mobileNumber && (
                                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
                                      {seat.booking.mobileNumber}
                                    </Text>
                                  )}
                                  {(!!seat.booking.pickupLocation || !!seat.booking.dropLocation) && (
                                    <Text style={{ fontSize: 11, color: colors.brand, marginTop: 1, fontWeight: '600' }} numberOfLines={1}>
                                      🚏 {seat.booking.pickupLocation || '—'} → {seat.booking.dropLocation || '—'}
                                    </Text>
                                  )}
                                </View>
                                <View style={{ width: 70, alignItems: 'center' }}>
                                  <View style={[styles.modeBadge, isPending ? { backgroundColor: colors.amberBg } : { backgroundColor: colors.greenBg }]}>
                                    <Text style={[styles.modeBadgeText, isPending ? { color: colors.amber } : { color: colors.greenDark }]}>
                                      {isPending ? t('trv_pending') : t('trv_paid')}
                                    </Text>
                                  </View>
                                </View>
                                <View style={{ width: 40, alignItems: 'center' }}>
                                  {!!seat.booking.mobileNumber && (
                                    <Pressable
                                      onPress={() => handleCallPassenger(seat.booking.mobileNumber)}
                                      hitSlop={10}
                                      style={{
                                        width: 32, height: 32, borderRadius: 16, backgroundColor: colors.greenBg,
                                        alignItems: 'center', justifyContent: 'center',
                                      }}>
                                      <Text style={{ fontSize: 14 }}>📞</Text>
                                    </Pressable>
                                  )}
                                </View>
                              </Pressable>
                            );
                          })}
                        </View>
                      );
                    })()}
                  </View>

                  {selectedSeatNumbers.length > 0 && (
                    <View style={{ backgroundColor: colors.brandBg, borderWidth: 1.5, borderColor: colors.brand, borderRadius: 16, padding: 14, marginBottom: 20 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                        <View style={{ flex: 1, marginRight: 10 }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: colors.brand, letterSpacing: 0.5 }}>
                            {t('trv_selectedSeats').toUpperCase()}
                          </Text>
                          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.navy, marginTop: 3 }}>
                            {selectedSeatNumbers.slice().sort((a, b) => a - b).join(', ')}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: 11, color: colors.muted }}>{t('trv_totalAmount')}</Text>
                          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.brand }}>
                            ₹{(selectedSeatNumbers.length * (travelSelectedTrip.fare || 0)).toLocaleString()}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <Pressable
                          onPress={() => setSelectedSeatNumbers([])}
                          style={{ flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.brand, alignItems: 'center' }}>
                          <Text style={{ color: colors.brand, fontWeight: '700' }}>{t('common_cancel')}</Text>
                        </Pressable>
                        <Pressable
                          onPress={handleOpenMultiBook}
                          style={{ flex: 2, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.brand, alignItems: 'center' }}>
                          <Text style={{ color: '#fff', fontWeight: '800' }}>
                            {t('trv_bookSelectedSeats', { count: String(selectedSeatNumbers.length) })}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  )}

                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeading}>{t('trv_tripFuel')}</Text>
                    <Pressable
                      onPress={() => handleOpenAddTravelFuel(String(travelSelectedTrip.id))}
                      style={styles.primaryPillBtn}>
                      <Text style={styles.primaryPillBtnText}>{t('trv_addTripFuel')}</Text>
                    </Pressable>
                  </View>
                  {(() => {
                    const tripFuelLogs = travelFuelLogs.filter(
                      (log: any) => String(log.tripId) === String(travelSelectedTrip.id)
                    );
                    if (travelFuelLoading && tripFuelLogs.length === 0) {
                      return <Text style={styles.emptyStateText}>{t('common_loading')}</Text>;
                    }
                    if (tripFuelLogs.length === 0) {
                      return <Text style={styles.emptyStateText}>{t('trv_noFuelLogsTrip')}</Text>;
                    }
                    return tripFuelLogs.map(log => (
                      <View key={log.id} style={[styles.fuelCard, { flexDirection: 'row', alignItems: 'center' }]}>
                        <View style={styles.fuelLeftCol}>
                          <View style={styles.fuelStationRow}>
                            <Text style={styles.fuelStationIcon}>⛽</Text>
                            <Text style={styles.fuelStationName}>{log.station || '—'}</Text>
                          </View>
                          <Text style={styles.fuelDetailText}>
                            {log.quantity} {log.fuelType === 'CNG' ? 'Kg' : 'Litres'} @ ₹{log.rate}
                          </Text>
                          <Text style={styles.fuelDateText}>{log.fuelDate}{log.fuelTime ? `, ${log.fuelTime}` : ''}</Text>
                        </View>
                        <View style={styles.fuelRightCol}>
                          <Text style={styles.fuelAmountText}>-₹{log.totalCost.toLocaleString()}</Text>
                          <View style={styles.fuelTypePill}>
                            <Text style={styles.fuelTypePillText}>{log.fuelType}</Text>
                          </View>
                        </View>
                        <Pressable
                          onPress={() => handleDeleteTravelFuel(log.id)}
                          hitSlop={10}
                          style={{
                            marginLeft: 10, width: 34, height: 34, borderRadius: 17,
                            alignItems: 'center', justifyContent: 'center', backgroundColor: colors.redBg,
                          }}>
                          <Text style={{ fontSize: 15 }}>🗑️</Text>
                        </Pressable>
                      </View>
                    ));
                  })()}
                </>
              )}
            </View>
          )}

          {/* Business Feature Tab: Trips (Auto Driver) */}
          {activeTab === 'trips' && !isTravelBusiness && hasFeature('trips') && (
            <View>
              {/* Driver's own UPI QR (passengers scan it to pay) */}
              <View style={{ backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Pressable onPress={() => (driverQr ? setShowQrModal(true) : handlePickQr())}>
                    {driverQr ? (
                      <Image source={{ uri: driverQr }} style={{ width: 64, height: 64, borderRadius: 8, backgroundColor: '#fff' }} resizeMode="contain" />
                    ) : (
                      <View style={{ width: 64, height: 64, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.brand, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2FF' }}>
                        <Text style={{ fontSize: 22 }}>📷</Text>
                      </View>
                    )}
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>{t('drv_upiQrTitle')}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                      {driverQr ? t('drv_tapToEnlarge') : t('drv_uploadQrHint')}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <Pressable
                    onPress={() => handleOpenQuickPayment('UPI')}
                    disabled={qrSaving}
                    style={[styles.primaryPillBtn, { flex: 1, alignItems: 'center' }]}>
                    <Text style={styles.primaryPillBtnText}>{qrSaving ? t('common_saving') : `💳 ${t('drv_recordUpi')}`}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleOpenQuickPayment('Cash')}
                    style={{
                      flex: 1, backgroundColor: colors.greenBg, borderWidth: 1, borderColor: colors.greenBorder,
                      borderRadius: 8, paddingVertical: 9, alignItems: 'center', justifyContent: 'center',
                    }}>
                    <Text style={{ color: colors.greenDark, fontSize: 12, fontWeight: '700' }}>💵 {t('drv_recordCash')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={voiceRecorderState.isRecording ? handleStopVoiceRecording : handleStartVoiceRecording}
                    disabled={voiceProcessing}
                    style={{
                      flex: 1, backgroundColor: voiceRecorderState.isRecording ? colors.redBg : colors.brandBg,
                      borderWidth: 1, borderColor: voiceRecorderState.isRecording ? colors.redBorder : '#C7D2FE',
                      borderRadius: 8, paddingVertical: 9, alignItems: 'center', justifyContent: 'center',
                      opacity: voiceProcessing ? 0.6 : 1,
                    }}>
                    <Text style={{ color: voiceRecorderState.isRecording ? colors.red : colors.brand, fontSize: 12, fontWeight: '700' }}>
                      {voiceProcessing
                        ? t('drv_voiceProcessing')
                        : voiceRecorderState.isRecording
                        ? `⏹ ${t('drv_voiceStop')}`
                        : `🎤 ${t('drv_voiceSpeak')}`}
                    </Text>
                  </Pressable>
                </View>
                {(voiceRecorderState.isRecording || voiceProcessing) && (
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8, textAlign: 'center' }}>
                    {voiceRecorderState.isRecording ? t('drv_voiceListeningHint') : t('drv_voiceProcessingHint')}
                  </Text>
                )}
              </View>


              {/* Trips KPI Summary */}
              <View style={styles.kpiRow}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('trip_todaysTrips')}</Text>
                  <Text style={styles.kpiValue}>{trips.length}</Text>
                  <Text style={styles.kpiSub}>{t('trip_completed')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('trip_distance')}</Text>
                  <Text style={[styles.kpiValue, { color: colors.brand }]}>{totalTripDistance} km</Text>
                  <Text style={styles.kpiSub}>{t('trip_totalLogged')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('trip_fareEarned')}</Text>
                  <Text style={[styles.kpiValue, styles.textPositive]}>₹{totalTripEarnings}</Text>
                  <Text style={styles.kpiSub}>{t('trip_netEarnings')}</Text>
                </View>
              </View>

              <Text style={styles.sectionHeading}>{t('trip_loggedTrips', { count: trips.length })}</Text>

              {trips.map(trip => (
                <Pressable key={trip.id} onLongPress={() => handleDeleteTrip(trip)} style={styles.tripCard}>
                  <View style={styles.tripLeftCol}>
                    <View style={styles.tripRouteRow}>
                      <Text style={styles.tripRoutePin}>📍</Text>
                      <Text style={styles.tripRouteText}>
                        {trip.route || trip.locationName || t('drv_locationUnavailable')}
                      </Text>
                    </View>
                    <View style={styles.tripMetricsRow}>
                      {trip.distanceKm > 0 && (
                        <>
                          <Text style={styles.tripMetricText}>
                            {trip.startKm} → {trip.endKm} km ({trip.distanceKm} km ride)
                          </Text>
                          <Text style={styles.bulletDot}>•</Text>
                        </>
                      )}
                      <Text style={styles.tripTimeText}>{trip.time}</Text>
                    </View>
                  </View>
                  <View style={styles.tripRightCol}>
                    <Text style={styles.tripFareText}>+₹{trip.fare}</Text>
                    <View
                      style={[
                        styles.modeBadge,
                        trip.paymentMode === 'UPI' ? styles.modeBadgeUpi : styles.modeBadgeCash,
                      ]}>
                      <Text
                        style={[
                          styles.modeBadgeText,
                          trip.paymentMode === 'UPI' ? styles.modeBadgeTextUpi : styles.modeBadgeTextCash,
                        ]}>
                        {trip.paymentMode}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {/* Business Feature Tab: Fuel (Auto Driver) */}
          {activeTab === 'fuel' && !isTravelBusiness && hasFeature('fuel') && (
            <View>
              {/* Fuel KPI Summary */}
              <View style={styles.kpiRow}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('fuel_totalSpent')}</Text>
                  <Text style={[styles.kpiValue, styles.textNegative]}>₹{totalFuelCost}</Text>
                  <Text style={styles.kpiSub}>{t('fuel_expenses')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('fuel_quantityLabel')}</Text>
                  <Text style={[styles.kpiValue, { color: colors.slate }]}>{totalFuelLitres} Kg/L</Text>
                  <Text style={styles.kpiSub}>{t('fuel_totalFilled')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('fuel_avgRate')}</Text>
                  <Text style={[styles.kpiValue, { color: colors.brand }]}>₹85/Kg</Text>
                  <Text style={styles.kpiSub}>{t('fuel_cngRate')}</Text>
                </View>
              </View>

              {(() => {
                const fuelDayBuckets = Array.from({ length: 7 }).map((_, idx) => {
                  const d = new Date();
                  d.setHours(0, 0, 0, 0);
                  d.setDate(d.getDate() - (6 - idx));
                  const dayStart = d.getTime();
                  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
                  const amount = driverFuelHistory
                    .filter(f => f.fuelTimeMs >= dayStart && f.fuelTimeMs < dayEnd)
                    .reduce((sum, f) => sum + f.totalCost, 0);
                  return { label: d.toLocaleDateString('en-US', { weekday: 'short' }), amount };
                });
                return (
                  <View style={styles.seatMapCard}>
                    <Text style={styles.sectionHeading}>{t('fuel_last7Days')}</Text>
                    <View style={{ marginTop: 6 }}>{renderEarningsTrendChart(fuelDayBuckets, selectedFuelDay, setSelectedFuelDay)}</View>
                  </View>
                );
              })()}

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>{t('fuel_fuelLogs', { count: fuelLogs.length })}</Text>
                <Pressable
                  onPress={() => {
                    setFuelOdometer(String(vehicle.totalKm));
                    setFuelTotalOverride('');
                    setFuelVoiceTranscript('');
                    setFuelVoiceConfirmed(false);
                    setShowAddFuelModal(true);
                  }}
                  style={styles.primaryPillBtn}>
                  <Text style={styles.primaryPillBtnText}>{t('fuel_addFuelFill')}</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={fuelVoiceProcessing ? undefined : (voiceRecorderState.isRecording ? handleStopFuelVoiceRecording : handleStartFuelVoiceRecording)}
                disabled={fuelVoiceProcessing}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  backgroundColor: voiceRecorderState.isRecording ? colors.redBg : colors.brandBg,
                  borderWidth: 1, borderColor: voiceRecorderState.isRecording ? colors.redBorder : '#C7D2FE',
                  borderRadius: 10, paddingVertical: 10, marginBottom: 10,
                  opacity: fuelVoiceProcessing ? 0.6 : 1,
                }}>
                <Text style={{ color: voiceRecorderState.isRecording ? colors.red : colors.brand, fontSize: 12, fontWeight: '700' }}>
                  {fuelVoiceProcessing
                    ? t('drv_voiceProcessing')
                    : voiceRecorderState.isRecording
                    ? t('drv_voiceStop')
                    : t('fuel_speak')}
                </Text>
              </Pressable>
              {(voiceRecorderState.isRecording || fuelVoiceProcessing) && (
                <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'center', marginBottom: 10 }}>
                  {voiceRecorderState.isRecording ? t('drv_voiceListeningHintFuel') : t('drv_voiceProcessingHint')}
                </Text>
              )}

              {fuelLogs.map(log => (
                <View key={log.id} style={styles.fuelCard}>
                  <View style={styles.fuelLeftCol}>
                    <View style={styles.fuelStationRow}>
                      <Text style={styles.fuelStationIcon}>⛽</Text>
                      <Text style={styles.fuelStationName}>{log.station}</Text>
                    </View>
                    <Text style={styles.fuelDetailText}>
                      {log.quantity > 0
                        ? `${log.quantity} ${log.fuelType === 'CNG' ? 'Kg' : 'Litres'} @ ₹${log.rate}/${log.fuelType === 'CNG' ? 'Kg' : 'L'} • Odo: ${log.odometer} km`
                        : `Odo: ${log.odometer} km`}
                    </Text>
                    <Text style={styles.fuelDateText}>{log.date}</Text>
                  </View>
                  <View style={styles.fuelRightCol}>
                    <Text style={styles.fuelAmountText}>-₹{log.totalCost}</Text>
                    <View style={styles.fuelTypePill}>
                      <Text style={styles.fuelTypePillText}>{log.fuelType}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Business Feature Tab: Driver Reports (week/month/custom-range history + charts) */}
          {activeTab === 'driver_reports' && (hasFeature('trips') || isTravelBusiness) && (() => {
            const reportCashTotal = reportTrips.filter(t => t.paymentMode === 'Cash').reduce((s, t) => s + t.fare, 0);
            const reportUpiTotal = reportTrips.filter(t => t.paymentMode === 'UPI').reduce((s, t) => s + t.fare, 0);
            const reportTotalEarnings = reportCashTotal + reportUpiTotal;
            const reportTotalFuelCost = reportFuelLogs.reduce((s, f) => s + f.totalCost, 0);
            const reportNetProfit = reportTotalEarnings - reportTotalFuelCost;

            const rangeStartISO =
              reportPeriod === 'week'
                ? formatDateISO(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000))
                : reportPeriod === 'month'
                ? formatDateISO(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000))
                : reportCustomStart;
            const rangeEndISO = reportPeriod === 'custom' ? reportCustomEnd : formatDateISO(new Date());

            const earningsBuckets = buildPeriodBuckets(
              reportTrips.map(t => ({ timeMs: t.tripTimeMs, amount: t.fare })),
              rangeStartISO, rangeEndISO
            );
            const fuelBuckets = buildPeriodBuckets(
              reportFuelLogs.map(f => ({ timeMs: f.fuelTimeMs, amount: f.totalCost })),
              rangeStartISO, rangeEndISO
            );

            const sortedPayments = reportTrips.slice().sort((a, b) => b.tripTimeMs - a.tripTimeMs);
            const sortedFuelLogs = reportFuelLogs.slice().sort((a, b) => b.fuelTimeMs - a.fuelTimeMs);

            // Best/worst day of week: average earnings per occurrence of that weekday
            // within the period (not a raw sum, so a period with e.g. 5 Mondays vs
            // 4 Tuesdays doesn't unfairly favor whichever weekday appears more often).
            const perDateTotals = new Map<string, { total: number; dow: number }>();
            reportTrips.forEach(tr => {
              const d = new Date(tr.tripTimeMs);
              const key = d.toDateString();
              const existing = perDateTotals.get(key);
              if (existing) existing.total += tr.fare;
              else perDateTotals.set(key, { total: tr.fare, dow: d.getDay() });
            });
            const dowGroups = new Map<number, number[]>();
            perDateTotals.forEach(({ total, dow }) => {
              if (!dowGroups.has(dow)) dowGroups.set(dow, []);
              dowGroups.get(dow)!.push(total);
            });
            const dowAverages = Array.from(dowGroups.entries()).map(([dow, totals]) => ({
              dow,
              avg: totals.reduce((a, b) => a + b, 0) / totals.length,
            }));
            const bestDay = dowAverages.length > 0 ? dowAverages.reduce((a, b) => (b.avg > a.avg ? b : a)) : null;
            const worstDay = dowAverages.length > 0 ? dowAverages.reduce((a, b) => (b.avg < a.avg ? b : a)) : null;

            // Peak hours: which part of the day earns the most, using the same
            // morning/afternoon/evening/night buckets as the greeting/safety features.
            const peakTotals = { morning: 0, afternoon: 0, evening: 0, night: 0 };
            reportTrips.forEach(tr => {
              peakTotals[timeOfDayBucket(new Date(tr.tripTimeMs).getHours())] += tr.fare;
            });
            const peakBuckets = [
              { label: t('drv_timeMorning'), amount: peakTotals.morning },
              { label: t('drv_timeAfternoon'), amount: peakTotals.afternoon },
              { label: t('drv_timeEvening'), amount: peakTotals.evening },
              { label: t('drv_timeNight'), amount: peakTotals.night },
            ];

            async function handleExportReportPdf() {
              setReportExporting(true);
              try {
                const periodLabel =
                  reportPeriod === 'week' ? t('drv_reportsWeek') : reportPeriod === 'month' ? t('drv_reportsMonth') : t('drv_reportsCustom');
                const paymentRows = sortedPayments
                  .map(
                    p => `<tr>
                      <td>${new Date(p.tripTimeMs).toLocaleString()}</td>
                      <td>${escapeHtml(p.route || p.locationName || '-')}</td>
                      <td style="text-align:right;">₹${p.fare.toLocaleString()}</td>
                      <td>${p.paymentMode}</td>
                    </tr>`
                  )
                  .join('');
                const fuelRows = sortedFuelLogs
                  .map(
                    f => `<tr>
                      <td>${new Date(f.fuelTimeMs).toLocaleString()}</td>
                      <td>${escapeHtml(f.station || '-')}</td>
                      <td style="text-align:right;">₹${f.totalCost.toLocaleString()}</td>
                      <td>${f.fuelType}</td>
                    </tr>`
                  )
                  .join('');
                const html = `
                  <html>
                    <head><meta charset="utf-8"/></head>
                    <body style="font-family: Helvetica, Arial, sans-serif; color: #1e293b; padding: 24px;">
                      <h1 style="margin-bottom: 2px;">BizPilot - Earnings Report</h1>
                      <div style="color: #64748b; margin-bottom: 20px;">
                        ${escapeHtml(user?.fullName || '')} · ${escapeHtml(user?.businessType || '')}<br/>
                        ${periodLabel}: ${rangeStartISO} to ${rangeEndISO}
                      </div>
                      <table style="width:100%; border-collapse: collapse; margin-bottom: 24px;" cellpadding="8">
                        <tr><td style="border:1px solid #e2e8f0;">Total Trips</td><td style="border:1px solid #e2e8f0; text-align:right;">${reportTrips.length}</td></tr>
                        <tr><td style="border:1px solid #e2e8f0;">Total Earnings</td><td style="border:1px solid #e2e8f0; text-align:right;">₹${reportTotalEarnings.toLocaleString()}</td></tr>
                        <tr><td style="border:1px solid #e2e8f0;">Total Fuel Cost</td><td style="border:1px solid #e2e8f0; text-align:right;">₹${reportTotalFuelCost.toLocaleString()}</td></tr>
                        <tr><td style="border:1px solid #e2e8f0; font-weight:bold;">Net Profit</td><td style="border:1px solid #e2e8f0; text-align:right; font-weight:bold;">₹${reportNetProfit.toLocaleString()}</td></tr>
                      </table>
                      <h2>Payment History</h2>
                      <table style="width:100%; border-collapse: collapse; font-size: 12px;" cellpadding="6">
                        <tr style="background:#f1f5f9;"><th style="border:1px solid #e2e8f0; text-align:left;">Date</th><th style="border:1px solid #e2e8f0; text-align:left;">Route</th><th style="border:1px solid #e2e8f0; text-align:right;">Amount</th><th style="border:1px solid #e2e8f0;">Mode</th></tr>
                        ${paymentRows || '<tr><td colspan="4" style="border:1px solid #e2e8f0; text-align:center; color:#94a3b8;">No payments in this period</td></tr>'}
                      </table>
                      <h2 style="margin-top:24px;">Fuel Log</h2>
                      <table style="width:100%; border-collapse: collapse; font-size: 12px;" cellpadding="6">
                        <tr style="background:#f1f5f9;"><th style="border:1px solid #e2e8f0; text-align:left;">Date</th><th style="border:1px solid #e2e8f0; text-align:left;">Station</th><th style="border:1px solid #e2e8f0; text-align:right;">Cost</th><th style="border:1px solid #e2e8f0;">Type</th></tr>
                        ${fuelRows || '<tr><td colspan="4" style="border:1px solid #e2e8f0; text-align:center; color:#94a3b8;">No fuel fill-ups in this period</td></tr>'}
                      </table>
                    </body>
                  </html>
                `;
                const { uri } = await Print.printToFileAsync({ html });
                if (await Sharing.isAvailableAsync()) {
                  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: t('drv_reportsExport') });
                } else {
                  Alert.alert(t('common_error'), t('drv_reportsShareUnavailable'));
                }
              } catch (e) {
                console.error('Error exporting report PDF:', e);
                Alert.alert(t('common_error'), t('drv_reportsExportFailed'));
              } finally {
                setReportExporting(false);
              }
            }

            return (
              <View>
                <View style={styles.modePillRow}>
                  {(['week', 'month', 'custom'] as const).map(p => (
                    <Pressable
                      key={p}
                      onPress={() => setReportPeriod(p)}
                      style={[styles.modePill, reportPeriod === p && styles.modePillActive]}>
                      <Text style={[styles.modePillText, reportPeriod === p && styles.modePillTextActive]}>
                        {p === 'week' ? t('drv_reportsWeek') : p === 'month' ? t('drv_reportsMonth') : t('drv_reportsCustom')}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Pressable
                  onPress={handleExportReportPdf}
                  disabled={reportExporting || reportLoading || reportTrips.length === 0}
                  style={[
                    styles.primaryPillBtn,
                    { alignSelf: 'flex-start', marginBottom: 14 },
                    (reportExporting || reportLoading || reportTrips.length === 0) && { opacity: 0.5 },
                  ]}>
                  <Text style={styles.primaryPillBtnText}>
                    {reportExporting ? t('common_saving') : `📄 ${t('drv_reportsExport')}`}
                  </Text>
                </Pressable>

                {reportPeriod === 'custom' && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <Pressable onPress={openReportStartPicker} style={[styles.modalInput, { flex: 1, justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 13, color: colors.navy, fontWeight: '600' }}>{reportCustomStart}</Text>
                    </Pressable>
                    <Text style={{ color: colors.muted }}>–</Text>
                    <Pressable onPress={openReportEndPicker} style={[styles.modalInput, { flex: 1, justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 13, color: colors.navy, fontWeight: '600' }}>{reportCustomEnd}</Text>
                    </Pressable>
                  </View>
                )}

                {reportPeriod === 'custom' && reportCustomStart > reportCustomEnd ? (
                  <Text style={styles.emptyStateText}>{t('drv_reportsInvalidRange')}</Text>
                ) : reportLoading ? (
                  <Text style={styles.emptyStateText}>{t('common_loading')}</Text>
                ) : (
                  <>
                    {renderHomeCardGrid([
                      { icon: '🗺️', label: isTravelBusiness ? t('drv_reportsTotalBookings') : t('drv_reportsTotalTrips'), value: String(reportTrips.length), color: colors.brand },
                      { icon: '💵', label: t('drv_reportsTotalEarnings'), value: `₹${reportTotalEarnings.toLocaleString()}`, color: colors.green },
                      { icon: '⛽', label: t('fuel_totalSpent'), value: `₹${reportTotalFuelCost.toLocaleString()}`, color: colors.amber },
                      {
                        icon: '📊',
                        label: t('drv_reportsNetProfit'),
                        value: `₹${reportNetProfit.toLocaleString()}`,
                        color: reportNetProfit >= 0 ? colors.green : colors.red,
                      },
                    ])}

                    <View style={styles.seatMapCard}>
                      <Text style={styles.sectionHeading}>{t('drv_paymentMix')}</Text>
                      <View style={{ marginTop: 10 }}>{renderPaymentMixChart(reportCashTotal, reportUpiTotal)}</View>
                    </View>

                    <View style={styles.seatMapCard}>
                      <Text style={styles.sectionHeading}>{t('drv_reportsEarningsTrend')}</Text>
                      <View style={{ marginTop: 6 }}>
                        {renderEarningsTrendChart(earningsBuckets, selectedReportEarningsDay, setSelectedReportEarningsDay)}
                      </View>
                    </View>

                    <View style={styles.seatMapCard}>
                      <Text style={styles.sectionHeading}>{t('drv_reportsFuelTrend')}</Text>
                      <View style={{ marginTop: 6 }}>
                        {renderEarningsTrendChart(fuelBuckets, selectedReportFuelDay, setSelectedReportFuelDay)}
                      </View>
                    </View>

                    {bestDay && worstDay && dowAverages.length >= 2 && (
                      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                        <View style={[styles.seatMapCard, { flex: 1, marginBottom: 0, backgroundColor: colors.greenBg, borderWidth: 1, borderColor: colors.greenBorder }]}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.greenDark }}>{t('drv_reportsBestDay')}</Text>
                          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.navy, marginTop: 2 }}>{weekdayName(bestDay.dow)}</Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>{t('drv_reportsAvgPerDay', { amount: `₹${Math.round(bestDay.avg).toLocaleString()}` })}</Text>
                        </View>
                        <View style={[styles.seatMapCard, { flex: 1, marginBottom: 0, backgroundColor: colors.amberBg, borderWidth: 1, borderColor: colors.amberBorder }]}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.amber }}>{t('drv_reportsWorstDay')}</Text>
                          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.navy, marginTop: 2 }}>{weekdayName(worstDay.dow)}</Text>
                          <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>{t('drv_reportsAvgPerDay', { amount: `₹${Math.round(worstDay.avg).toLocaleString()}` })}</Text>
                        </View>
                      </View>
                    )}

                    <View style={styles.seatMapCard}>
                      <Text style={styles.sectionHeading}>{t('drv_reportsPeakHours')}</Text>
                      <View style={{ marginTop: 6 }}>
                        {renderEarningsTrendChart(peakBuckets, selectedReportPeakBucket, setSelectedReportPeakBucket)}
                      </View>
                    </View>

                    <View style={styles.seatMapCard}>
                      <Text style={styles.sectionHeading}>{t('drv_paymentHistory')}</Text>
                      {sortedPayments.length === 0 ? (
                        <Text style={[styles.emptyStateText, { marginTop: 10 }]}>{t('drv_noPaymentsYet')}</Text>
                      ) : (
                        <View style={{ marginTop: 8 }}>
                          {sortedPayments.map((entry, idx) => (
                            <View
                              key={idx}
                              style={{
                                flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
                                borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: colors.border,
                              }}>
                              <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.navy }} numberOfLines={1}>
                                  {entry.route || entry.locationName || t('drv_locationUnavailable')}
                                </Text>
                                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                                  {new Date(entry.tripTimeMs).toLocaleDateString([], { month: 'short', day: 'numeric' })} ·{' '}
                                  {new Date(entry.tripTimeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Text>
                              </View>
                              <Text style={{ fontSize: 14, fontWeight: '800', color: colors.green, marginRight: 8 }}>
                                +₹{entry.fare.toLocaleString()}
                              </Text>
                              <View style={[styles.modeBadge, entry.paymentMode === 'UPI' ? styles.modeBadgeUpi : styles.modeBadgeCash]}>
                                <Text style={[styles.modeBadgeText, entry.paymentMode === 'UPI' ? styles.modeBadgeTextUpi : styles.modeBadgeTextCash]}>
                                  {entry.paymentMode}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>

                    <View style={styles.seatMapCard}>
                      <Text style={styles.sectionHeading}>{t('fuel_fuelLogs', { count: sortedFuelLogs.length })}</Text>
                      {sortedFuelLogs.length === 0 ? (
                        <Text style={[styles.emptyStateText, { marginTop: 10 }]}>{t('drv_reportsNoFuelLogs')}</Text>
                      ) : (
                        <View style={{ marginTop: 8 }}>
                          {sortedFuelLogs.map((log, idx) => (
                            <View
                              key={idx}
                              style={{
                                flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
                                borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: colors.border,
                              }}>
                              <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.navy }} numberOfLines={1}>
                                  {log.station || '—'}
                                </Text>
                                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                                  {new Date(log.fuelTimeMs).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </Text>
                              </View>
                              <Text style={{ fontSize: 14, fontWeight: '800', color: colors.red, marginRight: 8 }}>
                                -₹{log.totalCost.toLocaleString()}
                              </Text>
                              <View style={styles.fuelTypePill}>
                                <Text style={styles.fuelTypePillText}>{log.fuelType}</Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  </>
                )}
              </View>
            );
          })()}

          {/* Business Feature Tab: Fuel (Travels Bus Booking Online) */}
          {activeTab === 'fuel' && isTravelBusiness && (
            <View>
              <View style={styles.kpiRow}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('fuel_totalSpent')}</Text>
                  <Text style={[styles.kpiValue, styles.textNegative]}>₹{(travelFuelSummary?.totalCost || 0).toLocaleString()}</Text>
                  <Text style={styles.kpiSub}>{t('fuel_expenses')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('fuel_quantityLabel')}</Text>
                  <Text style={[styles.kpiValue, { color: colors.slate }]}>{travelFuelSummary?.totalQuantity || 0}</Text>
                  <Text style={styles.kpiSub}>{t('fuel_totalFilled')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('fuel_avgRate')}</Text>
                  <Text style={[styles.kpiValue, { color: colors.brand }]}>₹{travelFuelSummary?.avgRate || 0}</Text>
                </View>
              </View>

              <Text style={styles.fieldLabel}>{t('trv_allTrips')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
                <Pressable
                  onPress={() => setFuelTripFilter('ALL')}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
                    backgroundColor: fuelTripFilter === 'ALL' ? colors.brand : colors.page,
                    borderWidth: 1.5, borderColor: fuelTripFilter === 'ALL' ? colors.brand : colors.border,
                  }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: fuelTripFilter === 'ALL' ? '#fff' : colors.slate }}>
                    {t('trv_allTrips')}
                  </Text>
                </Pressable>
                {travelTrips.map(trip => (
                  <Pressable
                    key={trip.id}
                    onPress={() => setFuelTripFilter(String(trip.id))}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, maxWidth: 200,
                      backgroundColor: fuelTripFilter === String(trip.id) ? colors.brand : colors.page,
                      borderWidth: 1.5, borderColor: fuelTripFilter === String(trip.id) ? colors.brand : colors.border,
                    }}>
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 12, fontWeight: '700', color: fuelTripFilter === String(trip.id) ? '#fff' : colors.slate }}>
                      {trip.route}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>{t('fuel_fuelLogs', { count: travelFuelLogs.length })}</Text>
                <Pressable
                  onPress={() => handleOpenAddTravelFuel(fuelTripFilter !== 'ALL' ? fuelTripFilter : undefined)}
                  style={styles.primaryPillBtn}>
                  <Text style={styles.primaryPillBtnText}>{t('fuel_addFuelFill')}</Text>
                </Pressable>
              </View>

              {travelFuelLoading && travelFuelLogs.length === 0 ? (
                <Text style={styles.emptyStateText}>{t('common_loading')}</Text>
              ) : travelFuelLogs.length === 0 ? (
                <Text style={styles.emptyStateText}>{t('trv_noFuelLogsTrip')}</Text>
              ) : (
                travelFuelLogs.map(log => (
                  <View key={log.id} style={[styles.fuelCard, { flexDirection: 'row', alignItems: 'center' }]}>
                    <View style={styles.fuelLeftCol}>
                      <View style={styles.fuelStationRow}>
                        <Text style={styles.fuelStationIcon}>⛽</Text>
                        <Text style={styles.fuelStationName}>{log.station || '—'}</Text>
                      </View>
                      <Text style={styles.fuelDetailText}>
                        {log.quantity} {log.fuelType === 'CNG' ? 'Kg' : 'Litres'} @ ₹{log.rate}/
                        {log.fuelType === 'CNG' ? 'Kg' : 'L'}{log.odometer ? ` • Odo: ${log.odometer} km` : ''}
                      </Text>
                      <Text style={styles.fuelDateText}>
                        {log.fuelDate}{log.fuelTime ? `, ${log.fuelTime}` : ''}{log.tripRoute ? ` • 🚌 ${log.tripRoute}` : ''}
                      </Text>
                    </View>
                    <View style={styles.fuelRightCol}>
                      <Text style={styles.fuelAmountText}>-₹{log.totalCost.toLocaleString()}</Text>
                      <View style={styles.fuelTypePill}>
                        <Text style={styles.fuelTypePillText}>{log.fuelType}</Text>
                      </View>
                    </View>
                    <Pressable
                      onPress={() => handleDeleteTravelFuel(log.id)}
                      hitSlop={10}
                      style={{
                        marginLeft: 10, width: 34, height: 34, borderRadius: 17,
                        alignItems: 'center', justifyContent: 'center', backgroundColor: colors.redBg,
                      }}>
                      <Text style={{ fontSize: 15 }}>🗑️</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          )}

          {/* Business Feature Tab: Inventory / Products (Fruit/Vegetable & Retailer) */}
          {activeTab === 'inventory' && (hasFeature('inventory') || hasFeature('products')) && (
            <View>
              {/* Inventory KPI Summary */}
              <View style={styles.kpiRow}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('inv_totalProducts')}</Text>
                  <Text style={styles.kpiValue}>{inventory.length}</Text>
                  <Text style={styles.kpiSub}>{t('inv_catalogItems')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('inv_totalUnits')}</Text>
                  <Text style={[styles.kpiValue, { color: colors.brand }]}>{totalInventoryItems}</Text>
                  <Text style={styles.kpiSub}>{t('inv_inStock')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('inv_lowStock')}</Text>
                  <Text style={[styles.kpiValue, lowStockCount > 0 ? styles.textNegative : styles.textPositive]}>
                    {lowStockCount}
                  </Text>
                  <Text style={styles.kpiSub}>{t('inv_needReorder')}</Text>
                </View>
              </View>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>{t('inv_catalogHeading')}</Text>
                <Pressable
                  onPress={() => {
                    setInventoryVoiceTranscript('');
                    setInventoryVoiceConfirmed(false);
                    setShowAddProductModal(true);
                  }}
                  style={styles.primaryPillBtn}>
                  <Text style={styles.primaryPillBtnText}>{t('inv_addItem')}</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={inventoryVoiceProcessing ? undefined : (voiceRecorderState.isRecording ? handleStopInventoryVoiceRecording : handleStartInventoryVoiceRecording)}
                disabled={inventoryVoiceProcessing}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  backgroundColor: voiceRecorderState.isRecording ? colors.redBg : colors.brandBg,
                  borderWidth: 1, borderColor: voiceRecorderState.isRecording ? colors.redBorder : '#C7D2FE',
                  borderRadius: 10, paddingVertical: 10, marginBottom: 10,
                  opacity: inventoryVoiceProcessing ? 0.6 : 1,
                }}>
                <Text style={{ color: voiceRecorderState.isRecording ? colors.red : colors.brand, fontSize: 12, fontWeight: '700' }}>
                  {inventoryVoiceProcessing
                    ? t('drv_voiceProcessing')
                    : voiceRecorderState.isRecording
                    ? t('drv_voiceStop')
                    : t('inv_voiceAgentBtn')}
                </Text>
              </Pressable>
              {(voiceRecorderState.isRecording || inventoryVoiceProcessing) && (
                <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'center', marginBottom: 10 }}>
                  {voiceRecorderState.isRecording ? t('inv_voiceListeningHintAgent') : t('drv_voiceProcessingHint')}
                </Text>
              )}

              {inventory.length === 0 && !inventoryLoading && (
                <Text style={styles.emptyStateText}>{t('inv_emptyState')}</Text>
              )}

              {inventory.map(item => {
                const isLow = item.stockQty <= item.lowStockThreshold;
                return (
                  <View key={item.id} style={styles.inventoryCard}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.invItemName}>{item.name}</Text>
                        <View style={styles.invCategoryPill}>
                          <Text style={styles.invCategoryText}>{item.category}</Text>
                        </View>
                      </View>
                      <Text style={styles.invPriceText}>
                        {t('inv_sellingPrice')} <Text style={{ fontWeight: '700', color: colors.navy }}>₹{item.sellingPrice}/{item.unit}</Text>
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <View style={[styles.stockBadge, isLow ? styles.stockBadgeLow : styles.stockBadgeOk]}>
                        <Text style={[styles.stockBadgeText, isLow ? styles.stockBadgeTextLow : styles.stockBadgeTextOk]}>
                          {isLow ? `${t('inv_low')} ${item.stockQty} ${item.unit}` : `${item.stockQty} ${item.unit}`}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        {isLow && (
                          <Pressable
                            onPress={() => handleOpenEditStock(item)}
                            style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFBEB', borderColor: '#FDE68A', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                            <Text style={{ fontSize: 13 }}>✏️</Text>
                          </Pressable>
                        )}
                        <Pressable
                          onPress={() => handleOpenRecordSale(item)}
                          style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                          <Text style={{ fontSize: 15 }}>➕</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleDeleteProduct(item)}
                          style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                          <Text style={{ fontSize: 14 }}>🗑️</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })}

              {restockSuggestions.length > 0 && (
                <View style={styles.chartCard}>
                  <View style={styles.chartCardHeaderRow}>
                    <Text style={styles.chartCardTitle}>📦 {t('restock_heading')}</Text>
                  </View>
                  {restockSuggestions.map((s) => {
                    const isCritical = s.urgency === 'critical';
                    const highWastage = s.wastageRatio >= 0.35;
                    return (
                      <View
                        key={s.productId}
                        style={[
                          styles.restockCard,
                          isCritical ? styles.restockCardCritical : styles.restockCardSoon,
                        ]}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={styles.invItemName}>{s.productName}</Text>
                              <View style={[styles.restockUrgencyTag, isCritical && styles.restockUrgencyTagCritical]}>
                                <Text style={[styles.restockUrgencyTagText, isCritical && styles.restockUrgencyTagTextCritical]}>
                                  {isCritical ? t('restock_critical') : t('restock_soon')}
                                </Text>
                              </View>
                            </View>
                            <Text style={styles.restockBuyText}>
                              {t('restock_buy', { qty: s.suggestedQty, unit: s.unit })}
                            </Text>
                            <Text style={styles.restockReasonText}>
                              {t('restock_reasoning', { rate: s.avgDailySales, unit: s.unit, days: s.daysOfStockLeft })}
                            </Text>
                            {highWastage && (
                              <Text style={styles.restockWastageNote}>{t('restock_highWastage')}</Text>
                            )}
                          </View>
                        </View>
                        <Pressable
                          onPress={() => {
                            const product = inventory.find(p => p.id === s.productId);
                            handleOpenRecordSale(product, 'PURCHASE', String(s.suggestedQty));
                          }}
                          style={styles.restockPurchaseBtn}>
                          <Text style={styles.restockPurchaseBtnText}>{t('restock_recordPurchase')}</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* Business Feature Tab: Daily Collection (Fruit/Vegetable & Retailer) */}
          {activeTab === 'daily_collection' && (hasFeature('inventory') || hasFeature('products')) && (
            <View>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>{t('dc_heading')}</Text>
                <Pressable
                  onPress={() => {
                    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(dcSelectedDate) ? new Date(dcSelectedDate + 'T00:00:00') : new Date();
                    setDcCalendarMonth(isNaN(parsed.getTime()) ? new Date() : parsed);
                    setShowDcCalendarPicker(true);
                  }}
                  style={{
                    width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: colors.brandBg, borderWidth: 1, borderColor: '#C7D2FE',
                  }}>
                  <Text style={{ fontSize: 18 }}>📅</Text>
                </Pressable>
              </View>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: -6, marginBottom: 14 }}>
                {dcSelectedDate === formatDateISO(new Date()) ? t('common_today') : formatDisplayDate(dcSelectedDate)}
              </Text>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <Pressable onPress={() => handleOpenRecordSale(undefined, 'SALE')} style={[styles.primaryPillBtn, { flex: 1, alignItems: 'center' }]}>
                  <Text style={styles.primaryPillBtnText}>🧾 {t('dc_sale')}</Text>
                </Pressable>
                <Pressable onPress={() => handleOpenRecordSale(undefined, 'PURCHASE')} style={[styles.primaryPillBtn, { flex: 1, alignItems: 'center', backgroundColor: '#D97706' }]}>
                  <Text style={styles.primaryPillBtnText}>📥 {t('dc_purchase')}</Text>
                </Pressable>
                <Pressable onPress={() => handleOpenRecordSale(undefined, 'WASTAGE')} style={[styles.primaryPillBtn, { flex: 1, alignItems: 'center', backgroundColor: colors.red }]}>
                  <Text style={styles.primaryPillBtnText}>🗑️ {t('dc_wastage')}</Text>
                </Pressable>
              </View>

              <View style={styles.kpiRow}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('dc_totalCollected')}</Text>
                  <Text style={[styles.kpiValue, styles.textPositive]}>₹{(inventorySummary?.totalAmount || 0).toLocaleString()}</Text>
                  <Text style={styles.kpiSub}>{dcSelectedDate === formatDateISO(new Date()) ? t('common_today') : formatDisplayDate(dcSelectedDate)}</Text>
                </View>
                <Pressable style={styles.kpiCard} onPress={() => setShowPurchaseDetailModal(true)}>
                  <Text style={styles.kpiLabel}>{t('dc_purchases')}</Text>
                  <Text style={[styles.kpiValue, { color: '#D97706' }]}>₹{(inventorySummary?.purchaseValue || 0).toLocaleString()}</Text>
                  <Text style={styles.kpiSub}>{t('dc_unitsBought', { qty: inventorySummary?.purchaseQuantity || 0 })}</Text>
                </Pressable>
              </View>
              <View style={styles.kpiRow}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('dc_wastageLabel')}</Text>
                  <Text style={[styles.kpiValue, styles.textNegative]}>₹{(inventorySummary?.wastageValue || 0).toLocaleString()}</Text>
                  <Text style={styles.kpiSub}>{t('dc_unitsLost', { qty: inventorySummary?.wastageQuantity || 0 })}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('dc_transactions')}</Text>
                  <Text style={[styles.kpiValue, { color: colors.brand }]}>{inventorySummary?.totalCount || 0}</Text>
                  <Text style={styles.kpiSub}>{t('dc_recorded')}</Text>
                </View>
              </View>
              <View style={styles.kpiRow}>
                <View style={[styles.kpiCard, { flex: 1 }]}>
                  <Text style={styles.kpiLabel}>{t('dc_netProfit')}</Text>
                  <Text style={[styles.kpiValue, (inventorySummary?.netProfit || 0) >= 0 ? styles.textPositive : styles.textNegative]}>
                    ₹{(inventorySummary?.netProfit || 0).toLocaleString()}
                  </Text>
                  <Text style={styles.kpiSub}>{t('dc_netProfitHint')}</Text>
                </View>
              </View>

              {inventoryTransactions.length === 0 && !inventoryLoading && (
                <Text style={styles.emptyStateText}>{t('dc_emptyState')}</Text>
              )}

              {inventoryTransactions.length > 0 && (
                <View style={styles.txTableWrap}>
                  <View style={styles.txTableHeaderRow}>
                    <Text style={[styles.txTableHeaderText, { flex: 1.3 }]}>{t('dc_product')}</Text>
                    <Text style={[styles.txTableHeaderText, { flex: 0.8, textAlign: 'center' }]}>{t('dc_qty')}</Text>
                    <Text style={[styles.txTableHeaderText, { flex: 1, textAlign: 'center' }]}>{t('dc_date')}</Text>
                    <Text style={[styles.txTableHeaderText, { flex: 1, textAlign: 'right' }]}>{t('dc_amount')}</Text>
                    <View style={{ width: 30 }} />
                  </View>
                  {inventoryTransactions.map(tx => {
                    const isWastage = tx.type === 'WASTAGE';
                    const isPurchase = tx.type === 'PURCHASE';
                    return (
                      <View key={tx.id} style={styles.txTableRow}>
                        <View style={{ flex: 1.3 }}>
                          <Text style={styles.txTableCellName} numberOfLines={1}>{tx.productName}</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
                            {isWastage && (
                              <View style={styles.wastageTag}>
                                <Text style={styles.wastageTagText}>{t('dc_wastageLabel')}</Text>
                              </View>
                            )}
                            {isPurchase && (
                              <View style={[styles.wastageTag, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
                                <Text style={[styles.wastageTagText, { color: '#B45309' }]}>{t('dc_purchases')}</Text>
                              </View>
                            )}
                            {isPurchase && tx.amountDue > 0 && (
                              <View style={[styles.wastageTag, { backgroundColor: colors.redBg, borderColor: colors.redBorder }]}>
                                <Text style={[styles.wastageTagText, { color: colors.red }]}>{t('dc_vendorDueShort')} ₹{tx.amountDue}</Text>
                              </View>
                            )}
                          </View>
                          {isPurchase && !!tx.note && (
                            <Pressable onPress={() => handleOpenVendorLedger(tx.note)} hitSlop={4}>
                              <Text style={{ fontSize: 11, color: colors.brand, fontWeight: '700', marginTop: 3, textDecorationLine: 'underline' }} numberOfLines={1}>
                                🏪 {tx.note}
                              </Text>
                            </Pressable>
                          )}
                        </View>
                        <Text style={[styles.txTableCell, { flex: 0.8, textAlign: 'center' }]}>
                          {tx.quantity > 0 ? `${tx.quantity} ${tx.unit}` : '—'}
                        </Text>
                        <Text style={[styles.txTableCell, { flex: 1, textAlign: 'center' }]}>{tx.date}</Text>
                        <Text
                          style={[
                            styles.txTableCellAmount,
                            { flex: 1, textAlign: 'right' },
                            isWastage && { color: colors.red },
                            isPurchase && { color: '#B45309' },
                          ]}>
                          {isWastage || isPurchase ? '−' : '+'}₹{tx.amount.toLocaleString()}
                        </Text>
                        <Pressable
                          onPress={() => handleDeleteTransaction(tx)}
                          style={{ width: 30, height: 26, alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
                          <Text style={{ fontSize: 13 }}>🗑️</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              )}

              {(inventorySummary?.byProduct || []).length > 0 && (
                <View style={styles.chartCard}>
                  <View style={styles.chartCardHeaderRow}>
                    <Text style={styles.chartCardTitle}>🍊 {t('dc_fruitwiseSales')}</Text>
                    <Text style={styles.chartCardBadge}>
                      {dcSelectedDate === formatDateISO(new Date()) ? t('common_today') : formatDisplayDate(dcSelectedDate)}
                    </Text>
                  </View>
                  {(() => {
                    const rows = (inventorySummary?.byProduct || []) as any[];
                    const max = Math.max(...rows.map(r => r.amount), 1);
                    return (
                      <View>
                        {rows.map((row, idx) => (
                          <View key={row.productName} style={styles.rankRow}>
                            <View style={[styles.rankBadge, { backgroundColor: PIE_CHART_PALETTE[idx % PIE_CHART_PALETTE.length] }]}>
                              <Text style={styles.rankBadgeText}>{idx + 1}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                                <Text style={styles.rankProductName}>{row.productName}</Text>
                                <Text style={styles.rankAmount}>₹{row.amount.toLocaleString()}</Text>
                              </View>
                              <View style={styles.rankTrack}>
                                <View
                                  style={[
                                    styles.rankFill,
                                    { width: `${Math.max((row.amount / max) * 100, 4)}%`, backgroundColor: PIE_CHART_PALETTE[idx % PIE_CHART_PALETTE.length] },
                                  ]}>
                                  <View style={styles.rankFillSheen} />
                                </View>
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    );
                  })()}
                </View>
              )}
            </View>
          )}

          {/* Business Feature Tab: Insights / Charts (Fruit/Vegetable & Retailer) */}
          {activeTab === 'inventory_insights' && (hasFeature('inventory') || hasFeature('products')) && (
            <View>
              <View style={styles.chartCard}>
                <View style={styles.chartCardHeaderRow}>
                  <Text style={styles.chartCardTitle}>🏆 {t('ins_mostSelling')}</Text>
                  <Text style={styles.chartCardBadge}>{t('ins_last30Days')}</Text>
                </View>
                {(() => {
                  const rows = (inventoryInsights?.topProducts || []) as any[];
                  if (rows.length === 0) {
                    return (
                      <Text style={styles.emptyStateText}>{t('ins_noSales30')}</Text>
                    );
                  }
                  const max = Math.max(...rows.map(r => r.amount), 1);
                  const total = rows.reduce((acc, r) => acc + r.amount, 0);
                  return (
                    <View>
                      {rows.map((row, idx) => {
                        const rankColor = PIE_CHART_PALETTE[idx % PIE_CHART_PALETTE.length];
                        const pct = total > 0 ? Math.round((row.amount / total) * 100) : 0;
                        return (
                          <View key={row.productName} style={styles.rankRow}>
                            <View style={[styles.rankBadge, { backgroundColor: rankColor }]}>
                              <Text style={styles.rankBadgeText}>{idx + 1}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                                <Text style={styles.rankProductName}>{row.productName}</Text>
                                <Text style={styles.rankAmount}>₹{row.amount.toLocaleString()}</Text>
                              </View>
                              <View style={styles.rankTrack}>
                                <View
                                  style={[
                                    styles.rankFill,
                                    { width: `${Math.max((row.amount / max) * 100, 4)}%`, backgroundColor: rankColor },
                                  ]}>
                                  <View style={styles.rankFillSheen} />
                                </View>
                              </View>
                            </View>
                            <Text style={styles.rankPct}>{pct}%</Text>
                          </View>
                        );
                      })}
                    </View>
                  );
                })()}
              </View>

              <View style={styles.chartCard}>
                <View style={styles.chartCardHeaderRow}>
                  <Text style={styles.chartCardTitle}>🗑️ {t('ins_mostWasted')}</Text>
                  <Text style={[styles.chartCardBadge, { color: colors.red, backgroundColor: '#FEF2F2' }]}>{t('ins_last30Days')}</Text>
                </View>
                {(() => {
                  const rows = (inventoryInsights?.topWastedProducts || []) as any[];
                  if (rows.length === 0) {
                    return (
                      <Text style={styles.emptyStateText}>{t('ins_noWastage30')}</Text>
                    );
                  }
                  const max = Math.max(...rows.map(r => r.amount), 1);
                  const total = rows.reduce((acc, r) => acc + r.amount, 0);
                  return (
                    <View>
                      {rows.map((row, idx) => {
                        const pct = total > 0 ? Math.round((row.amount / total) * 100) : 0;
                        return (
                          <View key={row.productName} style={styles.rankRow}>
                            <View style={[styles.rankBadge, { backgroundColor: colors.red }]}>
                              <Text style={styles.rankBadgeText}>{idx + 1}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                                <Text style={styles.rankProductName}>{row.productName}</Text>
                                <Text style={[styles.rankAmount, { color: colors.red }]}>₹{row.amount.toLocaleString()}</Text>
                              </View>
                              <View style={styles.rankTrack}>
                                <View
                                  style={[
                                    styles.rankFill,
                                    { width: `${Math.max((row.amount / max) * 100, 4)}%`, backgroundColor: colors.red },
                                  ]}>
                                  <View style={styles.rankFillSheen} />
                                </View>
                              </View>
                            </View>
                            <Text style={styles.rankPct}>{pct}%</Text>
                          </View>
                        );
                      })}
                    </View>
                  );
                })()}
              </View>

              {[
                { key: 'daily', title: `📅 ${t('ins_dayWise')}`, badge: t('ins_last7Days'), data: inventoryInsights?.dailyTrend, itemKey: 'date', from: '#818CF8', to: colors.brand },
              ].map((chart) => {
                const rows = (chart.data || []) as any[];
                const max = Math.max(...rows.map((r) => r.amount), 1);
                const peak = rows.reduce((a, b) => (b.amount > a ? b.amount : a), 0);
                const current = rows.length > 0 ? rows[rows.length - 1].amount : 0;
                return (
                  <View key={chart.key} style={styles.chartCard}>
                    <View style={styles.chartCardHeaderRow}>
                      <Text style={styles.chartCardTitle}>{chart.title}</Text>
                      <Text style={styles.chartCardBadge}>{chart.badge}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 14, marginBottom: 14 }}>
                      <Text style={styles.chartStatText}>{t('ins_peak')} <Text style={styles.chartStatValue}>₹{peak.toLocaleString()}</Text></Text>
                      <Text style={styles.chartStatText}>{t('ins_current')} <Text style={styles.chartStatValue}>₹{current.toLocaleString()}</Text></Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 130 }}>
                      {rows.map((d, i) => {
                        const isLast = i === rows.length - 1;
                        const barH = Math.max((d.amount / max) * 96, d.amount > 0 ? 8 : 3);
                        return (
                          <View key={d[chart.itemKey]} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                            {d.amount > 0 && (
                              <Text style={styles.barValueChip} numberOfLines={1}>
                                {d.amount >= 1000 ? `${(d.amount / 1000).toFixed(1)}k` : Math.round(d.amount)}
                              </Text>
                            )}
                            <View
                              style={[
                                styles.barPill,
                                {
                                  height: barH,
                                  backgroundColor: isLast ? chart.to : chart.from,
                                  opacity: isLast ? 1 : 0.55,
                                },
                              ]}>
                              <View style={styles.barPillSheen} />
                            </View>
                          </View>
                        );
                      })}
                    </View>
                    <View style={styles.chartBaseline} />
                    <View style={{ flexDirection: 'row' }}>
                      {rows.map((d, i) => (
                        <View key={d[chart.itemKey]} style={{ flex: 1, alignItems: 'center' }}>
                          <Text style={[styles.barLabel, i === rows.length - 1 && styles.barLabelActive]} numberOfLines={1}>
                            {d.label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}

              <View style={styles.chartCard}>
                <View style={styles.chartCardHeaderRow}>
                  <Text style={styles.chartCardTitle}>💳 {t('ins_paymentSplit')}</Text>
                  <Text style={styles.chartCardBadge}>{t('ins_last30Days')}</Text>
                </View>
                {(() => {
                  const cash = inventoryInsights?.paymentMethodSplit?.cash || 0;
                  const upi = inventoryInsights?.paymentMethodSplit?.upi || 0;
                  const credit = inventoryInsights?.paymentMethodSplit?.credit || 0;
                  const total = cash + upi + credit;
                  if (total <= 0) {
                    return <Text style={styles.emptyStateText}>{t('ins_noSales30Short')}</Text>;
                  }
                  const rows = [
                    { label: t('common_cash'), value: cash, color: colors.green },
                    { label: t('common_upi'), value: upi, color: colors.brand },
                    { label: t('common_credit'), value: credit, color: '#F59E0B' },
                  ];
                  const cx = 70;
                  const cy = 70;
                  const r = 70;
                  let cumulativeAngle = 0;
                  const slices = rows
                    .filter(row => row.value > 0)
                    .map((row) => {
                      const angle = (row.value / total) * 360;
                      const startAngle = cumulativeAngle;
                      const endAngle = cumulativeAngle + angle;
                      cumulativeAngle = endAngle;
                      return { ...row, startAngle, endAngle };
                    });
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                      <Svg width={140} height={140} viewBox="0 0 140 140">
                        {slices.length === 1 ? (
                          <Path
                            d={`M ${cx - r},${cy} a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 -${r * 2},0`}
                            fill={slices[0].color}
                          />
                        ) : (
                          slices.map((s) => (
                            <Path key={s.label} d={describePieSlice(cx, cy, r, s.startAngle, s.endAngle)} fill={s.color} />
                          ))
                        )}
                      </Svg>
                      <View style={{ flex: 1 }}>
                        {rows.map((row) => (
                          <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color, marginRight: 6 }} />
                            <Text style={{ flex: 1, fontSize: 12, color: colors.slate }}>{row.label}</Text>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.navy }}>₹{row.value.toLocaleString()}</Text>
                            <Text style={{ fontSize: 11, color: colors.muted, marginLeft: 8, minWidth: 34, textAlign: 'right' }}>
                              {total > 0 ? Math.round((row.value / total) * 100) : 0}%
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                })()}
              </View>

              <View style={styles.chartCard}>
                <View style={styles.chartCardHeaderRow}>
                  <Text style={styles.chartCardTitle}>📊 {t('ins_purchaseVsSales')}</Text>
                  <Text style={styles.chartCardBadge}>{t('ins_last30Days')}</Text>
                </View>
                {(() => {
                  const purchase = inventoryInsights?.purchaseVsSales?.purchase || 0;
                  const sales = inventoryInsights?.purchaseVsSales?.sales || 0;
                  const max = Math.max(purchase, sales, 1);
                  const rows = [
                    { label: t('dc_purchase'), value: purchase, color: '#D97706' },
                    { label: t('dc_sale'), value: sales, color: colors.green },
                  ];
                  return (
                    <View>
                      {rows.map((row) => (
                        <View key={row.label} style={{ marginBottom: 14 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.slateDark }}>{row.label}</Text>
                            <Text style={{ fontSize: 13, fontWeight: '800', color: row.color }}>₹{row.value.toLocaleString()}</Text>
                          </View>
                          <View style={styles.rankTrack}>
                            <View
                              style={[
                                styles.rankFill,
                                { width: `${Math.max((row.value / max) * 100, row.value > 0 ? 4 : 0)}%`, backgroundColor: row.color },
                              ]}>
                              <View style={styles.rankFillSheen} />
                            </View>
                          </View>
                        </View>
                      ))}
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                        {t('ins_netMargin')} <Text style={{ fontWeight: '800', color: sales - purchase >= 0 ? colors.greenDark : colors.red }}>
                          ₹{(sales - purchase).toLocaleString()}
                        </Text>
                      </Text>
                    </View>
                  );
                })()}
              </View>
            </View>
          )}

          {/* Business Feature Tab: Vendors (Fruit/Vegetable & Retailer) - passbook of who's owed what */}
          {activeTab === 'vendors' && (hasFeature('inventory') || hasFeature('products')) && (
            <View>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>{t('nav_vendors')}</Text>
                <Pressable onPress={handleOpenAddInventoryVendor} style={styles.primaryPillBtn}>
                  <Text style={styles.primaryPillBtnText}>{t('dc_addVendor')}</Text>
                </Pressable>
              </View>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: -6, marginBottom: 14 }}>
                {t('dc_vendorsSubtitle')}
              </Text>

              {vendorsLoading && vendors.length === 0 && (
                <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} />
              )}

              {!vendorsLoading && vendors.length === 0 && (
                <Text style={styles.emptyStateText}>{t('dc_noVendorsYet')}</Text>
              )}

              {vendors.map((v: any) => {
                const due = v.totalDue || 0;
                return (
                  <Pressable
                    key={v.vendorName}
                    onPress={() => handleOpenVendorLedger(v.vendorName)}
                    style={[styles.inventoryCard, { alignItems: 'center' }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.invItemName}>🏪 {v.vendorName}</Text>
                      {!!v.mobileNumber && (
                        <Text style={{ fontSize: 11, color: colors.slate, marginTop: 2 }}>📞 {v.mobileNumber}</Text>
                      )}
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                        {v.lastActivity ? t('dc_vendorLastActivity', { date: formatDisplayDate(v.lastActivity) }) : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      {due > 0 ? (
                        <>
                          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.red }}>₹{due.toLocaleString()}</Text>
                          <Text style={{ fontSize: 10, color: colors.muted }}>{t('dc_vendorDueShort')}</Text>
                        </>
                      ) : (
                        <View style={[styles.stockBadge, styles.stockBadgeOk]}>
                          <Text style={[styles.stockBadgeText, styles.stockBadgeTextOk]}>{t('dc_paidInFull')}</Text>
                        </View>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Business Feature Tab: Sales (Retailer & Fruit/Vegetable) */}
          {activeTab === 'sales' && hasFeature('sales') && (
            <View>
              {/* Sales Overview */}
              <View style={styles.kpiRow}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('sales_todaysSales')}</Text>
                  <Text style={[styles.kpiValue, styles.textPositive]}>₹14,250</Text>
                  <Text style={styles.kpiSub}>{t('sales_grossRevenue')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('sales_orders')}</Text>
                  <Text style={[styles.kpiValue, { color: colors.brand }]}>28</Text>
                  <Text style={styles.kpiSub}>{t('sales_billedToday')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('sales_avgBill')}</Text>
                  <Text style={[styles.kpiValue, { color: colors.slate }]}>₹509</Text>
                  <Text style={styles.kpiSub}>{t('sales_perCustomer')}</Text>
                </View>
              </View>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>{t('sales_recentOrders')}</Text>
                <Pressable
                  onPress={() => {
                    setTxType('in');
                    setTxCategory('Store Sale');
                    setShowAddModal(true);
                  }}
                  style={styles.primaryPillBtn}>
                  <Text style={styles.primaryPillBtnText}>{t('sales_newSale')}</Text>
                </Pressable>
              </View>

              <View style={styles.card}>
                <View style={styles.complianceRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.invItemName}>Walk-in Customer #108</Text>
                    <Text style={styles.complianceDesc}>Vegetables & Grocery Basket • 4 items</Text>
                    <Text style={styles.fuelDateText}>Today, 02:45 PM • UPI</Text>
                  </View>
                  <Text style={[styles.tripFareText, styles.textPositive]}>+₹480</Text>
                </View>
                <View style={styles.cardDivider} />
                <View style={styles.complianceRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.invItemName}>Radha Krishna Caterers</Text>
                    <Text style={styles.complianceDesc}>Wholesale Tomato & Onion Bags • 35 kg</Text>
                    <Text style={styles.fuelDateText}>Today, 11:20 AM • Cash</Text>
                  </View>
                  <Text style={[styles.tripFareText, styles.textPositive]}>+₹2,100</Text>
                </View>
              </View>
            </View>
          )}

          {/* Business Feature Tab: Service Jobs (Mechanic) */}
          {activeTab === 'service_jobs' && hasFeature('service_jobs') && (
            <View>
              {/* Mechanic Service Jobs KPI */}
              <View style={styles.kpiRow}>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('jobs_activeJobs')}</Text>
                  <Text style={[styles.kpiValue, { color: colors.amber }]}>
                    {serviceJobs.filter(j => j.status === 'In Progress').length}
                  </Text>
                  <Text style={styles.kpiSub}>{t('jobs_inGarage')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('jobs_ready')}</Text>
                  <Text style={[styles.kpiValue, styles.textPositive]}>
                    {serviceJobs.filter(j => j.status === 'Ready').length}
                  </Text>
                  <Text style={styles.kpiSub}>{t('jobs_forPickup')}</Text>
                </View>
                <View style={styles.kpiCard}>
                  <Text style={styles.kpiLabel}>{t('jobs_jobValue')}</Text>
                  <Text style={[styles.kpiValue, { color: colors.brand }]}>
                    ₹{serviceJobs.reduce((acc, j) => acc + j.estimatedAmount, 0).toLocaleString()}
                  </Text>
                  <Text style={styles.kpiSub}>{t('jobs_estimated')}</Text>
                </View>
              </View>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>{t('jobs_vehicleJobCards', { count: serviceJobs.length })}</Text>
                <Pressable
                  onPress={() => Alert.alert(t('jobs_newJobCardAlert'), t('jobs_openIntakeForm'))}
                  style={styles.primaryPillBtn}>
                  <Text style={styles.primaryPillBtnText}>{t('jobs_newJobCard')}</Text>
                </Pressable>
              </View>

              {serviceJobs.map(job => (
                <View key={job.id} style={styles.serviceJobCard}>
                  <View style={styles.serviceJobHeader}>
                    <View>
                      <Text style={styles.serviceJobId}>#{job.jobNumber || job.id}</Text>
                      <Text style={styles.serviceJobCustomer}>{job.customerName}</Text>
                    </View>
                    <View
                      style={[
                        styles.jobStatusBadge,
                        job.status === 'Ready'
                          ? styles.jobStatusReady
                          : job.status === 'In Progress'
                            ? styles.jobStatusInProgress
                            : styles.jobStatusDelivered,
                      ]}>
                      <Text
                        style={[
                          styles.jobStatusBadgeText,
                          job.status === 'Ready'
                            ? styles.jobStatusReadyText
                            : job.status === 'In Progress'
                              ? styles.jobStatusInProgressText
                              : styles.jobStatusDeliveredText,
                        ]}>
                        {job.status}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.serviceJobVehicleRow}>
                    <Text style={styles.serviceJobVehicleText}>🚘 {job.vehicleNumber} ({job.vehicleModel || t('jobs_vehicleFallback')})</Text>
                  </View>

                  <Text style={styles.serviceJobComplaintText}>🔧 {job.complaint}</Text>

                  <View style={styles.serviceJobFooter}>
                    <Text style={styles.serviceJobEstLabel}>
                      {t('jobs_est')} <Text style={styles.serviceJobEstVal}>₹{job.estimatedAmount}</Text>
                    </Text>
                    <Text style={styles.fuelDateText}>{t('jobs_delivery')} {job.deliveryDate}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Business Feature Tab: Collections (Field Collection Agent) */}
          {activeTab === 'collection_records' && (
            <View>
              {/* Dues Overview Card (Identical layout to screenshot) */}
              <View style={styles.duesOverviewCard}>
                <View style={styles.duesOverviewCol}>
                  <Text style={styles.duesOverviewLabel}>{t('col_youWillGet')}</Text>
                  <Text style={[styles.duesOverviewAmount, styles.textPositive]}>
                    ₹{(
                      collectionSummary?.totalRemainingAmount ??
                      collectionSummary?.totalPendingAmount ??
                      (totalCollectionToCollect > 0 ? totalCollectionToCollect : 54950)
                    ).toLocaleString()}
                  </Text>
                </View>
                <View style={styles.duesDivider} />
                <View style={styles.duesOverviewCol}>
                  <Text style={styles.duesOverviewLabel}>{t('col_youWillGive')}</Text>
                  <Text style={[styles.duesOverviewAmount, styles.textNegative]}>
                    ₹{(collectionSummary?.totalGivenAmount || 0).toLocaleString()}
                  </Text>
                </View>
              </View>

              {/* Agent Field Reports & Privacy Isolation Banner */}
              <View style={{ backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#3730A3' }}>
                      {t('col_fieldReports')}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.slate, marginTop: 2 }}>
                      {user?.fullName || 'Riya N'} • {t('col_privateAccount')}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setShowAgentReportsModal(true)}
                    style={{ backgroundColor: colors.brand, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                    <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>{t('col_viewReports')}</Text>
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E0E7FF' }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {t('col_collected')} <Text style={{ fontWeight: '700', color: colors.greenDark }}>₹{(collectionSummary?.totalCollectedAmount ?? 3000).toLocaleString()}</Text>
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {t('col_recovery')} <Text style={{ fontWeight: '700', color: colors.brandDark }}>{collectionSummary?.collectionRate ?? 5.3}%</Text>
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {t('col_cash')} <Text style={{ fontWeight: '700', color: colors.slateDark }}>₹{(collectionSummary?.cashAmount ?? 3000).toLocaleString()}</Text>
                  </Text>
                </View>
              </View>

              {/* Section Header Row */}
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>
                  {t('col_collectionCustomers', { count: customerSearchQuery.trim() ? `${filteredCollectionSchedule.length} of ${collectionSchedule.length}` : collectionSchedule.length })}
                </Text>
                <Pressable onPress={() => setActiveTab('add_customer')} style={styles.addDueBtnSmall}>
                  <Text style={styles.addDueBtnSmallText}>{t('col_addCustomerBtn')}</Text>
                </Pressable>
              </View>

              {/* Customer Search Box */}
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#FFFFFF',
                borderWidth: 1.5,
                borderColor: customerSearchQuery.trim() ? colors.brand : '#E2E8F0',
                borderRadius: 10,
                paddingHorizontal: 12,
                marginTop: 8,
                marginBottom: 12,
                height: 46,
                shadowColor: '#64748B',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.06,
                shadowRadius: 2,
                elevation: 1,
              }}>
                <Text style={{ fontSize: 16, marginRight: 8 }}>🔍</Text>
                <TextInput
                  value={customerSearchQuery}
                  onChangeText={setCustomerSearchQuery}
                  placeholder={t('col_searchPlaceholder')}
                  placeholderTextColor={colors.muted}
                  style={{
                    flex: 1,
                    fontSize: 14,
                    color: colors.navy,
                    paddingVertical: 0,
                  }}
                  returnKeyType="search"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {customerSearchQuery.length > 0 && (
                  <Pressable
                    onPress={() => setCustomerSearchQuery('')}
                    hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
                    style={{ padding: 6 }}>
                    <Text style={{ fontSize: 14, color: colors.muted, fontWeight: '700' }}>✕</Text>
                  </Pressable>
                )}
              </View>

              {/* Customer Due Cards - Filtered by Search */}
              {filteredCollectionSchedule.length === 0 && extraCustomerResults.length === 0 && !searchingAllCustomers ? (
                <View style={{
                  paddingVertical: 28,
                  paddingHorizontal: 20,
                  backgroundColor: '#FFFFFF',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: '#E2E8F0',
                  alignItems: 'center',
                  marginVertical: 8,
                }}>
                  <Text style={{ fontSize: 36, marginBottom: 8 }}>📋</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.navy }}>
                    {customerSearchQuery ? t('col_noMatching') : t('col_beatEmpty')}
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginTop: 4, lineHeight: 18, maxWidth: 290 }}>
                    {customerSearchQuery
                      ? t('col_noMatchMsg', { query: customerSearchQuery })
                      : t('col_readyToTest')}
                  </Text>
                  {customerSearchQuery ? (
                    <Pressable
                      onPress={() => setCustomerSearchQuery('')}
                      style={{
                        marginTop: 12,
                        paddingVertical: 8,
                        paddingHorizontal: 16,
                        backgroundColor: '#EEF2FF',
                        borderColor: '#C7D2FE',
                        borderWidth: 1,
                        borderRadius: 8,
                      }}>
                      <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 13 }}>{t('col_clearSearch')}</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => setActiveTab('add_customer')}
                      style={{
                        marginTop: 14,
                        paddingVertical: 10,
                        paddingHorizontal: 20,
                        backgroundColor: colors.brand,
                        borderRadius: 8,
                      }}>
                      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>{t('col_registerFirstCustomer')}</Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                filteredCollectionSchedule.map((item, idx) => {
                  const isCollected = item.status === 'COLLECTED';
                  const custName = item.customerName || item.customer_name || item.name || `Customer #${idx + 1}`;
                  const custPhone = item.mobile || item.phone || '+91 98201 11201';
                  const overdueDays = item.overdueDays || item.overdue_days_count || 0;
                  const dueAmt = isCollected
                    ? (item.todayCollectedAmount || item.today_collected_amount || item.collectedAmount || item.expectedAmount || 1000)
                    : (item.pendingAmount || item.expectedAmount || item.amount || 1000);
                  const relTime = item.lastUpdated || item.last_updated || 'Just now';
                  const cleanRelTime = String(relTime).replace(/^Updated:\s*/i, '');
                  const updatedText = isCollected
                    ? t('col_updatedToday')
                    : item.status === 'NOT_AVAILABLE'
                      ? t('col_updatedNotAvailable')
                      : item.status === 'RESCHEDULED'
                        ? t('col_updatedRescheduled')
                        : item.status === 'REFUSED'
                          ? t('col_updatedRefused')
                          : `${t('col_updatedPrefix')} ${cleanRelTime}`;

                  return (
                    <View key={item.scheduleId || item.id || `col-${idx}`} style={[styles.dueCard, { flexDirection: 'column', alignItems: 'stretch' }]}>
                      <Pressable
                        onPress={() => handleOpenCustomerPassbook(item)}
                        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={styles.dueInfoCol}>
                          <Text style={styles.dueName}>{custName}</Text>
                          <Text style={styles.duePhone}>{custPhone}</Text>
                          <Text style={styles.dueUpdated}>{updatedText}</Text>
                          {!isCollected && overdueDays > 0 && (
                            <View style={styles.overdueBadge}>
                              <Text style={styles.overdueBadgeText}>
                                ⚠ {overdueDays} {overdueDays === 1 ? t('col_dayPending') : t('col_daysPending')}
                              </Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.dueAmountCol}>
                          <Text style={[styles.dueAmountText, styles.textPositive]}>
                            {isCollected ? t('col_paid', { amount: dueAmt.toLocaleString() }) : t('col_get', { amount: dueAmt.toLocaleString() })}
                          </Text>
                          {isCollected && (item.pendingAmount || 0) > 0 && (
                            <Text style={styles.remainingPendingText}>
                              ⚠ ₹{Number(item.pendingAmount).toLocaleString()} {t('col_stillPending')}
                            </Text>
                          )}
                          <Pressable
                            onPress={() => {
                              if (isCollected) {
                                handleViewReceipt(item.receiptNumber || item.receipt_number || 'REC-20260907-0001');
                              } else {
                                handleOpenCollectModal(item);
                              }
                            }}
                            style={[
                              styles.settleBtn,
                              isCollected && { backgroundColor: colors.greenBg, borderColor: colors.greenBorder },
                            ]}>
                            <Text
                              style={[
                                styles.settleBtnText,
                                isCollected && { color: colors.greenDark },
                              ]}>
                              {isCollected ? 'Receipt 🧾' : 'Settle / Paid'}
                            </Text>
                          </Pressable>
                        </View>
                      </Pressable>

                      {/* Customer Action Bar: Passbook In-Out, Calendar, Edit & Delete */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Pressable
                            onPress={() => handleOpenCustomerPassbook(item)}
                            style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                            <Text style={{ fontSize: 14 }}>📖</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleOpenCustomerCalendar(item)}
                            style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                            <Text style={{ fontSize: 14 }}>📅</Text>
                          </Pressable>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Pressable
                            onPress={() => handleOpenEditCustomer(item)}
                            style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                            <Text style={{ fontSize: 14 }}>✏️</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleDeleteCustomer(item)}
                            style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                            <Text style={{ fontSize: 14 }}>🗑️</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  );
                })
              )}

              {searchingAllCustomers && (
                <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center', marginTop: 10 }}>
                  🔍 Searching previous records...
                </Text>
              )}

              {/* Previous / other records matching the search, not part of today's scheduled beat */}
              {extraCustomerResults.length > 0 && (
                <View style={{ marginTop: 18 }}>
                  <Text style={styles.sectionHeading}>
                    📁 Previous Records ({extraCustomerResults.length})
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, marginBottom: 10 }}>
                    Matches from your full customer list, not scheduled for today.
                  </Text>
                  {extraCustomerResults.map((item) => {
                    const custName = item.name || item.full_name || 'Customer';
                    const custPhone = item.mobile || item.phone || '—';
                    const custDue = item.totalDue || item.total_due || 0;
                    return (
                      <View key={`extra-${item.id}`} style={[styles.dueCard, { flexDirection: 'column', alignItems: 'stretch' }]}>
                        <Pressable
                          onPress={() => handleOpenCustomerPassbook(item)}
                          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <View style={styles.dueInfoCol}>
                            <Text style={styles.dueName}>{custName}</Text>
                            <Text style={styles.duePhone}>{custPhone}</Text>
                            <Text style={styles.dueUpdated}>
                              {item.lastPaymentDate ? `Last paid: ${item.lastPaymentDate}` : 'Not scheduled today'}
                            </Text>
                          </View>
                          <View style={styles.dueAmountCol}>
                            <Text style={[styles.dueAmountText, custDue > 0 ? styles.textNegative : styles.textPositive]}>
                              {custDue > 0 ? `Due ₹${custDue.toLocaleString()}` : 'No dues'}
                            </Text>
                          </View>
                        </Pressable>

                        {/* Customer Action Bar: Passbook In-Out, Calendar, Edit & Delete (no Settle/Paid - not part of today's schedule) */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Pressable
                              onPress={() => handleOpenCustomerPassbook(item)}
                              style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                              <Text style={{ fontSize: 14 }}>📖</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => handleOpenCustomerCalendar(item)}
                              style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                              <Text style={{ fontSize: 14 }}>📅</Text>
                            </Pressable>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Pressable
                              onPress={() => handleOpenEditCustomer(item)}
                              style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', borderColor: '#CBD5E1', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                              <Text style={{ fontSize: 14 }}>✏️</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => handleDeleteCustomer(item)}
                              style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                              <Text style={{ fontSize: 14 }}>🗑️</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Clean End of Day Beat Reconciliation */}
              <Pressable
                onPress={() => setShowClosingModal(true)}
                style={[
                  styles.actionBtnOutline,
                  isDayClosed && { backgroundColor: colors.greenBg, borderColor: colors.greenBorder },
                  { marginTop: 16, marginBottom: 30 },
                ]}>
                <Text
                  style={[
                    styles.actionBtnOutlineText,
                    isDayClosed && { color: colors.greenDark },
                  ]}>
                  {isDayClosed ? '🔒 Beat Reconciled & Closed' : '🏁 End of Day Beat Reconciliation'}
                </Text>
              </Pressable>
            </View>
          )}

          {/* Business Feature Tab: Collection Dashboard (Field Collection Agent) */}
          {activeTab === 'collection_dashboard' && (
            <View>
              {/* Header Banner */}
              <View style={styles.dashHeaderCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dashHeaderTitle}>COLLECTION DASHBOARD</Text>
                  <Text style={styles.dashHeaderSubtitle}>
                    {dashboardData?.period?.label || 'Target & Recovery Analytics'}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    onPress={() => setShowChartsModal(true)}
                    style={styles.dashChartIconBtn}>
                    <Text style={styles.dashChartIconBtnText}>📊</Text>
                  </Pressable>
                  <Pressable
                    onPress={loadDashboardData}
                    style={styles.dashRefreshBtn}>
                    <Text style={styles.dashRefreshBtnText}>{dashLoading ? '⏳ Loading' : '🔄 Refresh'}</Text>
                  </Pressable>
                </View>
              </View>

              {/* Time Period Filter Type Segment */}
              <View style={styles.dashPeriodSegment}>
                <Pressable
                  onPress={() => setDashFilterType('all')}
                  style={[styles.dashPeriodTab, dashFilterType === 'all' && styles.dashPeriodTabActive]}>
                  <Text style={[styles.dashPeriodTabText, dashFilterType === 'all' && styles.dashPeriodTabTextActive]}>
                    🗂️ All
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setDashFilterType('date');
                    setDashSelectedDate(getTodayDateString());
                  }}
                  style={[styles.dashPeriodTab, dashFilterType === 'date' && styles.dashPeriodTabActive]}>
                  <Text style={[styles.dashPeriodTabText, dashFilterType === 'date' && styles.dashPeriodTabTextActive]}>
                    📅 Date
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setDashFilterType('monthly');
                    setDashSelectedMonth('2026-09');
                  }}
                  style={[styles.dashPeriodTab, dashFilterType === 'monthly' && styles.dashPeriodTabActive]}>
                  <Text style={[styles.dashPeriodTabText, dashFilterType === 'monthly' && styles.dashPeriodTabTextActive]}>
                    📆 Monthly
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setDashFilterType('quarterly');
                    setDashSelectedQuarter('Q3-2026');
                  }}
                  style={[styles.dashPeriodTab, dashFilterType === 'quarterly' && styles.dashPeriodTabActive]}>
                  <Text style={[styles.dashPeriodTabText, dashFilterType === 'quarterly' && styles.dashPeriodTabTextActive]}>
                    📊 Quarterly
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setDashFilterType('yearly');
                    setDashSelectedYear('2026');
                  }}
                  style={[styles.dashPeriodTab, dashFilterType === 'yearly' && styles.dashPeriodTabActive]}>
                  <Text style={[styles.dashPeriodTabText, dashFilterType === 'yearly' && styles.dashPeriodTabTextActive]}>
                    📈 Yearly
                  </Text>
                </Pressable>
              </View>

              {/* Sub-Period Selector Chips */}
              <View style={styles.dashChipRow}>
                {dashFilterType === 'date' && (
                  <>
                    <Pressable
                      onPress={() => setDashSelectedDate(getTodayDateString())}
                      style={[styles.dashChip, dashSelectedDate === getTodayDateString() && styles.dashChipActive]}>
                      <Text style={[styles.dashChipText, dashSelectedDate === getTodayDateString() && styles.dashChipTextActive]}>
                        Today ({new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })})
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setDashSelectedDate(getYesterdayDateString())}
                      style={[styles.dashChip, dashSelectedDate === getYesterdayDateString() && styles.dashChipActive]}>
                      <Text style={[styles.dashChipText, dashSelectedDate === getYesterdayDateString() && styles.dashChipTextActive]}>
                        Yesterday ({new Date(Date.now() - 86400000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })})
                      </Text>
                    </Pressable>
                  </>
                )}

                {dashFilterType === 'monthly' && (
                  <>
                    <Pressable
                      onPress={() => setDashSelectedMonth('2026-09')}
                      style={[styles.dashChip, dashSelectedMonth === '2026-09' && styles.dashChipActive]}>
                      <Text style={[styles.dashChipText, dashSelectedMonth === '2026-09' && styles.dashChipTextActive]}>
                        This Month (Sep 2026)
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setDashSelectedMonth('last_month')}
                      style={[styles.dashChip, dashSelectedMonth === 'last_month' && styles.dashChipActive]}>
                      <Text style={[styles.dashChipText, dashSelectedMonth === 'last_month' && styles.dashChipTextActive]}>
                        Last Month (Aug 2026)
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setDashSelectedMonth('2026-07')}
                      style={[styles.dashChip, dashSelectedMonth === '2026-07' && styles.dashChipActive]}>
                      <Text style={[styles.dashChipText, dashSelectedMonth === '2026-07' && styles.dashChipTextActive]}>
                        Jul 2026
                      </Text>
                    </Pressable>
                  </>
                )}

                {dashFilterType === 'quarterly' && (
                  <>
                    <Pressable
                      onPress={() => setDashSelectedQuarter('Q3-2026')}
                      style={[styles.dashChip, dashSelectedQuarter === 'Q3-2026' && styles.dashChipActive]}>
                      <Text style={[styles.dashChipText, dashSelectedQuarter === 'Q3-2026' && styles.dashChipTextActive]}>
                        Q3 2026 (Jul-Sep)
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setDashSelectedQuarter('Q2-2026')}
                      style={[styles.dashChip, dashSelectedQuarter === 'Q2-2026' && styles.dashChipActive]}>
                      <Text style={[styles.dashChipText, dashSelectedQuarter === 'Q2-2026' && styles.dashChipTextActive]}>
                        Q2 2026 (Apr-Jun)
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setDashSelectedQuarter('Q1-2026')}
                      style={[styles.dashChip, dashSelectedQuarter === 'Q1-2026' && styles.dashChipActive]}>
                      <Text style={[styles.dashChipText, dashSelectedQuarter === 'Q1-2026' && styles.dashChipTextActive]}>
                        Q1 2026 (Jan-Mar)
                      </Text>
                    </Pressable>
                  </>
                )}

                {dashFilterType === 'yearly' && (
                  <>
                    <Pressable
                      onPress={() => setDashSelectedYear('2026')}
                      style={[styles.dashChip, dashSelectedYear === '2026' && styles.dashChipActive]}>
                      <Text style={[styles.dashChipText, dashSelectedYear === '2026' && styles.dashChipTextActive]}>
                        Year 2026
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setDashSelectedYear('2025')}
                      style={[styles.dashChip, dashSelectedYear === '2025' && styles.dashChipActive]}>
                      <Text style={[styles.dashChipText, dashSelectedYear === '2025' && styles.dashChipTextActive]}>
                        Year 2025
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>

              {/* Target & Collection Card */}
              <View style={styles.dashTargetCard}>
                <View style={styles.dashTargetRow}>
                  <Text style={styles.dashTargetLabel}>
                    {dashFilterType === 'date' ? "Today's Target" : 'Period Target'}
                  </Text>
                  <Text style={styles.dashTargetValue}>
                    ₹{(dashboardData?.targetAmount || 0).toLocaleString()}
                  </Text>
                </View>

                <View style={styles.dashTargetRow}>
                  <Text style={styles.dashCollectedLabel}>Collected</Text>
                  <Text style={styles.dashCollectedValue}>
                    ₹{(dashboardData?.collectedAmount || 0).toLocaleString()}
                  </Text>
                </View>

                <View style={styles.dashTargetRow}>
                  <Text style={styles.dashRemainingLabel}>Remaining</Text>
                  <Text style={styles.dashRemainingValue}>
                    ₹{(dashboardData?.remainingAmount || 0).toLocaleString()}
                  </Text>
                </View>

                {/* Progress Bar */}
                <View style={styles.dashProgressTrack}>
                  <View
                    style={[
                      styles.dashProgressBar,
                      {
                        width: `${Math.min(
                          100,
                          dashboardData?.targetAmount
                            ? Math.round(((dashboardData.collectedAmount || 0) / dashboardData.targetAmount) * 100)
                            : 0
                        )}%`,
                      },
                    ]}
                  />
                </View>
                <View style={styles.dashProgressMeta}>
                  <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '600' }}>
                    Recovery Rate: {dashboardData?.collectionRate || 0}%
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '600' }}>
                    {dashboardData?.people?.collected || 0} / {dashboardData?.people?.total || 0} Accounts
                  </Text>
                </View>
              </View>

              {/* People Breakdown Card */}
              <View style={styles.dashCard}>
                <Text style={styles.dashCardSectionTitle}>👥 People Breakdown</Text>
                <View style={styles.dashPeopleGrid}>
                  <Pressable
                    onPress={() => setDashSubFilter('ALL')}
                    style={[styles.dashPeopleBox, dashSubFilter === 'ALL' && styles.dashPeopleBoxActive]}>
                    <Text style={{ fontSize: 18 }}>👥</Text>
                    <Text style={styles.dashPeopleCount}>{dashboardData?.people?.total || 0}</Text>
                    <Text style={styles.dashPeopleLabel}>Total People</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setDashSubFilter('COLLECTED')}
                    style={[
                      styles.dashPeopleBox,
                      { borderColor: colors.greenBorder },
                      dashSubFilter === 'COLLECTED' && { backgroundColor: colors.greenBg, borderColor: colors.green },
                    ]}>
                    <Text style={{ fontSize: 18, color: colors.green, fontWeight: 'bold' }}>✓</Text>
                    <Text style={[styles.dashPeopleCount, { color: colors.green }]}>
                      {dashboardData?.people?.collected || 0}
                    </Text>
                    <Text style={styles.dashPeopleLabel}>Collected</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setDashSubFilter('PENDING')}
                    style={[
                      styles.dashPeopleBox,
                      { borderColor: colors.amberBorder },
                      dashSubFilter === 'PENDING' && { backgroundColor: colors.amberBg, borderColor: colors.amber },
                    ]}>
                    <Text style={{ fontSize: 18, color: colors.amber }}>⏳</Text>
                    <Text style={[styles.dashPeopleCount, { color: colors.amber }]}>
                      {dashboardData?.people?.pending || 0}
                    </Text>
                    <Text style={styles.dashPeopleLabel}>Pending</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setDashSubFilter('MISSED')}
                    style={[
                      styles.dashPeopleBox,
                      { borderColor: colors.redBorder },
                      dashSubFilter === 'MISSED' && { backgroundColor: colors.redBg, borderColor: colors.red },
                    ]}>
                    <Text style={{ fontSize: 18, color: colors.red, fontWeight: 'bold' }}>❌</Text>
                    <Text style={[styles.dashPeopleCount, { color: colors.red }]}>
                      {dashboardData?.people?.missed || 0}
                    </Text>
                    <Text style={styles.dashPeopleLabel}>Missed</Text>
                  </Pressable>
                </View>
              </View>

              {/* Payment Method Breakdown - all three methods in one row, matching People Breakdown style */}
              <View style={styles.dashCard}>
                <Text style={styles.dashCardSectionTitle}>💳 Payment Method</Text>
                <View style={styles.dashPeopleGrid}>
                  <View style={styles.dashPeopleBox}>
                    <Text style={{ fontSize: 18 }}>💵</Text>
                    <Text style={styles.dashPeopleCount}>
                      ₹{(dashboardData?.paymentMethods?.cash || 0).toLocaleString()}
                    </Text>
                    <Text style={styles.dashPeopleLabel}>Cash</Text>
                  </View>
                  <View style={styles.dashPeopleBox}>
                    <Text style={{ fontSize: 18 }}>📱</Text>
                    <Text style={styles.dashPeopleCount}>
                      ₹{(dashboardData?.paymentMethods?.upi || 0).toLocaleString()}
                    </Text>
                    <Text style={styles.dashPeopleLabel}>UPI</Text>
                  </View>
                  <View style={styles.dashPeopleBox}>
                    <Text style={{ fontSize: 18 }}>🏦</Text>
                    <Text style={styles.dashPeopleCount}>
                      ₹{(dashboardData?.paymentMethods?.bankTransfer || 0).toLocaleString()}
                    </Text>
                    <Text style={styles.dashPeopleLabel}>Bank Transfer</Text>
                  </View>
                </View>
              </View>

              {/* Quick Action / Sub-Filter Buttons */}
              <View style={styles.dashCard}>
                <Text style={styles.dashCardSectionTitle}>⚡ Quick Filters</Text>
                <View style={styles.dashActionsCol}>
                  <Pressable
                    onPress={() => setDashSubFilter(dashSubFilter === 'COLLECTED' ? 'ALL' : 'COLLECTED')}
                    style={[
                      styles.dashActionBtn,
                      dashSubFilter === 'COLLECTED' && styles.dashActionBtnActiveGreen,
                    ]}>
                    <Text style={[styles.dashActionBtnText, dashSubFilter === 'COLLECTED' && styles.dashActionBtnTextActive]}>
                      ✓ {dashFilterType === 'date' ? "Today's Collection" : dashFilterType === 'all' ? "All Collections" : "Period Collections"} ({dashboardData?.quickCounts?.collected || 0})
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setDashSubFilter(dashSubFilter === 'MISSED' ? 'ALL' : 'MISSED')}
                    style={[
                      styles.dashActionBtn,
                      dashSubFilter === 'MISSED' && styles.dashActionBtnActiveRed,
                    ]}>
                    <Text style={[styles.dashActionBtnText, dashSubFilter === 'MISSED' && styles.dashActionBtnTextActive]}>
                      ❌ Missed Collections ({dashboardData?.quickCounts?.missed || 0})
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setDashSubFilter(dashSubFilter === 'HISTORY' ? 'ALL' : 'HISTORY')}
                    style={[
                      styles.dashActionBtn,
                      dashSubFilter === 'HISTORY' && styles.dashActionBtnActiveBlue,
                    ]}>
                    <Text style={[styles.dashActionBtnText, dashSubFilter === 'HISTORY' && styles.dashActionBtnTextActive]}>
                      📜 Collection History ({dashboardData?.quickCounts?.history || 0})
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setDashSubFilter(dashSubFilter === 'DAILY_REPORT' ? 'ALL' : 'DAILY_REPORT')}
                    style={[
                      styles.dashActionBtn,
                      dashSubFilter === 'DAILY_REPORT' && styles.dashActionBtnActiveTeal,
                    ]}>
                    <Text style={[styles.dashActionBtnText, dashSubFilter === 'DAILY_REPORT' && styles.dashActionBtnTextActive]}>
                      📊 Daily Report ({dashboardData?.dailyReports?.length || 0} Days)
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Drilldown List: Daily Reports or Filtered Customers */}
              {dashSubFilter === 'DAILY_REPORT' ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={[styles.sectionHeading, { marginBottom: 10 }]}>
                    Daily Breakdown ({dashboardData?.dailyReports?.length || 0} Days)
                  </Text>
                  {(dashboardData?.dailyReports || []).map((rep: any, idx: number) => (
                    <View key={`rep-${idx}`} style={styles.dashDailyReportCard}>
                      <View style={styles.dashDailyReportHeader}>
                        <Text style={styles.dashDailyReportDate}>📅 {rep.displayDate}</Text>
                        <Text style={styles.dashDailyReportCollected}>
                          ₹{(rep.collected ?? rep.collectedAmount ?? 0).toLocaleString()} / ₹{(rep.target ?? rep.expectedAmount ?? 0).toLocaleString()}
                        </Text>
                      </View>
                      <View style={styles.dashDailyReportStats}>
                        <Text style={{ fontSize: 12, color: colors.muted }}>
                          👥 {rep.collectedPeople ?? rep.collectedCount ?? 0} / {rep.people ?? rep.totalAssigned ?? 0} Paid
                        </Text>
                        <Text style={{ fontSize: 12, color: colors.muted }}>
                          💵 Cash: ₹{(rep.cash ?? rep.cashAmount ?? 0).toLocaleString()} | 📱 UPI: ₹{(rep.upi ?? rep.upiAmount ?? 0).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : (() => {
                const displayedDashCustomers = (dashboardData?.customers || [])
                  .slice()
                  .sort((a: any, b: any) => {
                    const idA = Number(a.scheduleId || a.schedule_id || a.customerId || a.customer_id || a.id || 0);
                    const idB = Number(b.scheduleId || b.schedule_id || b.customerId || b.customer_id || b.id || 0);
                    return idB - idA; // Latest on top
                  })
                  .filter((item: any) => {
                    const isCol = item.status === 'COLLECTED';
                    const isMis = ['MISSED', 'NOT_AVAILABLE', 'REFUSED', 'RESCHEDULED'].includes(item.status);
                    const isPen = item.status === 'PENDING';
                    if (dashSubFilter === 'COLLECTED' && !isCol) return false;
                    if (dashSubFilter === 'MISSED' && !isMis) return false;
                    if (dashSubFilter === 'PENDING' && !isPen) return false;
                    if (!dashCustomerSearch.trim()) return true;
                    const q = dashCustomerSearch.trim().toLowerCase();
                    const name = (item.customerName || item.customer_name || item.name || '').toLowerCase();
                    const phone = (item.mobile || item.phone || '').toLowerCase();
                    const area = (item.area || item.address || '').toLowerCase();
                    const acc = (item.accountNumber || '').toLowerCase();
                    return name.includes(q) || phone.includes(q) || area.includes(q) || acc.includes(q);
                  });

                return (
                  <View style={{ marginTop: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <Text style={styles.sectionHeading}>
                        {dashSubFilter === 'MISSED'
                          ? 'Missed Accounts'
                          : dashSubFilter === 'COLLECTED'
                            ? 'Collected Accounts'
                            : dashSubFilter === 'PENDING'
                              ? 'Pending Accounts'
                              : 'Customer Records'}{' '}
                        ({displayedDashCustomers.length})
                      </Text>
                      {dashSubFilter !== 'ALL' && (
                        <Pressable onPress={() => setDashSubFilter('ALL')}>
                          <Text style={{ fontSize: 12, color: colors.brand, fontWeight: '700' }}>Clear Filter</Text>
                        </Pressable>
                      )}
                    </View>

                    {/* Search Box */}
                    <View style={styles.dashSearchBox}>
                      <TextInput
                        value={dashCustomerSearch}
                        onChangeText={setDashCustomerSearch}
                        placeholder="🔍 Search customer name, phone, area..."
                        placeholderTextColor="#94A3B8"
                        style={styles.dashSearchInput}
                      />
                      {dashCustomerSearch.length > 0 && (
                        <Pressable onPress={() => setDashCustomerSearch('')} style={styles.dashSearchClear}>
                          <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '700' }}>✕</Text>
                        </Pressable>
                      )}
                    </View>

                    {/* Customer Cards */}
                    {displayedDashCustomers.length === 0 ? (
                      <View style={styles.dashEmptyBox}>
                        <Text style={{ fontSize: 28, marginBottom: 8 }}>🔍</Text>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.slateDark }}>
                          No customers found
                        </Text>
                        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
                          Try adjusting the period or search keyword
                        </Text>
                      </View>
                    ) : (
                      displayedDashCustomers.map((item: any, idx: number) => {
                        const isCol = item.status === 'COLLECTED';
                        const isMis = ['MISSED', 'NOT_AVAILABLE', 'REFUSED', 'RESCHEDULED'].includes(item.status);
                        return (
                          <Pressable
                            key={`dash-cust-${item.scheduleId || item.id || item.customerId || 'c'}-${idx}`}
                            onPress={() => handleOpenCustomerPassbook(item)}
                            style={styles.dashCustomerCard}>
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={styles.dashCustomerName}>{item.customerName}</Text>
                                {item.accountNumber && (
                                  <View style={styles.dashAccBadge}>
                                    <Text style={styles.dashAccText}>{item.accountNumber}</Text>
                                  </View>
                                )}
                              </View>

                              <Text style={styles.dashCustomerMeta}>
                                📞 {item.mobile || 'No phone'} • 📍 {item.area || item.address || 'Field Route'}
                              </Text>

                              {isMis && item.missedReason && (
                                <View style={styles.dashMissedReasonBox}>
                                  <Text style={styles.dashMissedReasonText}>⚠️ Reason: {item.missedReason}</Text>
                                </View>
                              )}

                              {isCol && (
                                <Text style={{ fontSize: 11, color: colors.green, marginTop: 3 }}>
                                  Paid via {item.paymentMethod || 'Cash'} {item.time ? `at ${item.time}` : ''}
                                </Text>
                              )}
                            </View>

                            <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
                              <Text style={styles.dashCustomerAmount}>
                                ₹{(isCol ? (item.collectedAmount || item.expectedAmount || 0) : (item.expectedAmount || 0)).toLocaleString()}
                              </Text>

                              <View
                                style={[
                                  styles.dashStatusPill,
                                  isCol && { backgroundColor: colors.greenBg, borderColor: colors.greenBorder },
                                  isMis && { backgroundColor: colors.redBg, borderColor: colors.redBorder },
                                  !isCol && !isMis && { backgroundColor: colors.amberBg, borderColor: colors.amberBorder },
                                ]}>
                                <Text
                                  style={[
                                    styles.dashStatusText,
                                    isCol && { color: colors.green },
                                    isMis && { color: colors.red },
                                    !isCol && !isMis && { color: colors.amber },
                                  ]}>
                                  {item.status || 'PENDING'}
                                </Text>
                              </View>

                              <Text style={{ fontSize: 10, color: colors.brand, fontWeight: '700', marginTop: 4 }}>
                                📖 Passbook →
                              </Text>
                            </View>
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                );
              })()}
            </View>
          )}

          {/* Business Feature Tab: Add Customer (Field Collection Agent) */}
          {activeTab === 'add_customer' && (
            <View>
              {/* Header Info Card */}
              <View style={[styles.dueCard, { flexDirection: 'column', backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', padding: 16, marginBottom: 14 }]}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#3730A3' }}>
                  👤 Register New Customer
                </Text>
                <Text style={{ fontSize: 12, color: colors.slate, marginTop: 4, lineHeight: 17 }}>
                  Add a customer to your collection roster. They will automatically be assigned to your route and scheduled for today's recovery beat.
                </Text>
              </View>

              {/* Add Customer Form */}
              <View style={[styles.dueCard, { flexDirection: 'column', alignItems: 'stretch', padding: 16, marginBottom: 30 }]}>
                <Text style={styles.fieldLabel}>CUSTOMER FULL NAME *</Text>
                <TextInput
                  value={newCustName}
                  onChangeText={setNewCustName}
                  placeholder="e.g. Anand Kulkarni"
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                />

                <Text style={styles.fieldLabel}>MOBILE NUMBER *</Text>
                <TextInput
                  value={newCustMobile}
                  onChangeText={setNewCustMobile}
                  placeholder="e.g. +91 98201 11255"
                  placeholderTextColor={colors.muted}
                  keyboardType="phone-pad"
                  style={styles.modalInput}
                />

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>AREA / BEAT</Text>
                    <TextInput
                      value={newCustArea}
                      onChangeText={setNewCustArea}
                      placeholder="e.g. Market Yard"
                      placeholderTextColor={colors.muted}
                      style={styles.modalInput}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>EXPECTED TODAY (₹) *</Text>
                    <TextInput
                      value={newCustExpected}
                      onChangeText={setNewCustExpected}
                      placeholder="1000"
                      placeholderTextColor={colors.muted}
                      keyboardType="numeric"
                      style={styles.modalInput}
                    />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>TOTAL OUTSTANDING DUE (₹)</Text>
                <TextInput
                  value={newCustTotalDue}
                  onChangeText={setNewCustTotalDue}
                  placeholder="e.g. 4000"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  style={styles.modalInput}
                />

                <Text style={styles.fieldLabel}>ANNUAL INTEREST RATE (%)</Text>
                <TextInput
                  value={newCustInterestRate}
                  onChangeText={setNewCustInterestRate}
                  placeholder="e.g. 12"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  style={styles.modalInput}
                />

                <Text style={styles.fieldLabel}>STREET ADDRESS</Text>
                <TextInput
                  value={newCustAddress}
                  onChangeText={setNewCustAddress}
                  placeholder="e.g. Shop 22, Vegetable Mandi"
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                />

                <Pressable
                  onPress={handleCreateCollectionCustomer}
                  disabled={addCustLoading}
                  style={[styles.modalSubmitBtn, { backgroundColor: colors.brand, marginTop: 16, marginBottom: 10 }]}>
                  <Text style={styles.modalSubmitBtnText}>
                    {addCustLoading ? 'Registering Customer...' : '✓ Save Customer & Add to Beat'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setActiveTab('collection_records')}
                  style={[styles.actionBtnOutline, { borderColor: colors.border }]}>
                  <Text style={[styles.actionBtnOutlineText, { color: colors.slate }]}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* Business Feature Tab: Building Setup (Building Maintenance) */}
          {activeTab === 'building_setup' && isBuildingBusiness && (
            <View>
              {!myBuilding && !buildingLoading && (
                <View style={[styles.card, { paddingVertical: 24, alignItems: 'center' }]}>
                  <Text style={{ fontSize: 36, marginBottom: 8 }}>🏢</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.navy, marginBottom: 4 }}>{t('bld_createBuilding')}</Text>
                  <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginBottom: 14 }}>{t('bld_createBuildingDesc')}</Text>
                  <Pressable onPress={handleOpenBuildingForm} style={styles.primaryPillBtn}>
                    <Text style={styles.primaryPillBtnText}>{t('bld_createBuilding')}</Text>
                  </Pressable>
                </View>
              )}

              {myBuilding && (
                <>
                  <View style={styles.kpiRow}>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>{t('bld_totalFloors')}</Text>
                      <Text style={styles.kpiValue}>{myBuilding.numFloors}</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>{t('bld_totalFlats')}</Text>
                      <Text style={[styles.kpiValue, { color: colors.brand }]}>{myBuilding.numFlats}</Text>
                    </View>
                  </View>

                  <View style={styles.card}>
                    <View style={styles.sectionHeaderRow}>
                      <Text style={styles.invItemName}>{myBuilding.name}</Text>
                      <Pressable onPress={handleOpenBuildingForm}>
                        <Text style={{ fontSize: 13, color: colors.brand, fontWeight: '700' }}>✏️ {t('common_edit')}</Text>
                      </Pressable>
                    </View>
                    {!!myBuilding.code && <Text style={styles.complianceDesc}>{t('bld_buildingCode')}: {myBuilding.code}</Text>}
                    {!!myBuilding.address && <Text style={styles.complianceDesc}>📍 {myBuilding.address}{myBuilding.city ? `, ${myBuilding.city}` : ''}{myBuilding.state ? `, ${myBuilding.state}` : ''} {myBuilding.pincode}</Text>}
                    {!!myBuilding.contactNumber && <Text style={styles.complianceDesc}>📞 {myBuilding.contactNumber}</Text>}
                    {!!myBuilding.constructionYear && <Text style={styles.complianceDesc}>{t('bld_constructionYear')}: {myBuilding.constructionYear}</Text>}
                    {!!myBuilding.description && <Text style={[styles.complianceDesc, { marginTop: 6 }]}>{myBuilding.description}</Text>}
                  </View>
                </>
              )}
            </View>
          )}

          {/* Business Feature Tab: Floors (Building Maintenance) */}
          {activeTab === 'building_floors' && isBuildingBusiness && (
            <View>
              {!myBuilding ? (
                <Text style={styles.emptyStateText}>{t('bld_noBuildingYet')}</Text>
              ) : (
                <>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeading}>{t('bld_floorsHeading')}</Text>
                    <Pressable onPress={handleOpenAddFloor} style={styles.primaryPillBtn}>
                      <Text style={styles.primaryPillBtnText}>{t('bld_addFloor')}</Text>
                    </Pressable>
                  </View>
                  {buildingFloors.length === 0 && (
                    <Text style={styles.emptyStateText}>{t('bld_emptyFloors')}</Text>
                  )}
                  {buildingFloors.map(floor => (
                    <View key={floor.id} style={styles.inventoryCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.invItemName}>{floor.floorName || `Floor ${floor.floorNumber}`}</Text>
                        <Text style={styles.invPriceText}>{t('bld_flatsOnFloor', { count: floor.numFlats })}</Text>
                      </View>
                      <Pressable
                        onPress={() => handleDeleteFloor(floor)}
                        style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                        <Text style={{ fontSize: 14 }}>🗑️</Text>
                      </Pressable>
                    </View>
                  ))}
                </>
              )}
            </View>
          )}

          {/* Business Feature Tab: Flats (Building Maintenance) */}
          {activeTab === 'building_flats' && isBuildingBusiness && (
            <View>
              {!myBuilding ? (
                <Text style={styles.emptyStateText}>{t('bld_noBuildingYet')}</Text>
              ) : (
                <>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeading}>{t('bld_flatsHeading')}</Text>
                    <Pressable onPress={handleOpenAddFlat} style={styles.primaryPillBtn}>
                      <Text style={styles.primaryPillBtnText}>{t('bld_addFlat')}</Text>
                    </Pressable>
                  </View>

                  <View style={styles.modePillRow}>
                    {[{ key: '', label: t('bld_allFloors') }, ...buildingFloors.map(f => ({ key: f.id, label: f.floorName || `#${f.floorNumber}` }))].map(opt => (
                      <Pressable
                        key={opt.key || 'all'}
                        onPress={() => setFlatFloorFilter(opt.key)}
                        style={[styles.modePill, flatFloorFilter === opt.key && styles.modePillActive]}>
                        <Text style={[styles.modePillText, flatFloorFilter === opt.key && styles.modePillTextActive]} numberOfLines={1}>{opt.label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {buildingFlats.length === 0 && (
                    <Text style={styles.emptyStateText}>{t('bld_emptyFlats')}</Text>
                  )}
                  {buildingFlats.map(flat => {
                    const isOccupied = flat.occupancyStatus === 'Occupied' || flat.occupancyStatus === 'Rented';
                    return (
                      <View key={flat.id} style={styles.inventoryCard}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={styles.invItemName}>{flat.flatNumber}</Text>
                            {!!flat.flatType && (
                              <View style={styles.invCategoryPill}>
                                <Text style={styles.invCategoryText}>{flat.flatType}</Text>
                              </View>
                            )}
                          </View>
                          <Text style={styles.invPriceText}>{flat.ownerName || flat.tenantName || '—'} {flat.primaryMobile ? `• ${flat.primaryMobile}` : ''}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 6 }}>
                          <View style={[styles.stockBadge, isOccupied ? styles.stockBadgeOk : styles.stockBadgeLow]}>
                            <Text style={[styles.stockBadgeText, isOccupied ? styles.stockBadgeTextOk : styles.stockBadgeTextLow]}>{flat.occupancyStatus}</Text>
                          </View>
                          <View style={{ flexDirection: 'row', gap: 6 }}>
                            <Pressable
                              onPress={() => handleOpenEditFlat(flat)}
                              style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                              <Text style={{ fontSize: 13 }}>✏️</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => handleDeleteFlat(flat)}
                              style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                              <Text style={{ fontSize: 14 }}>🗑️</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </>
              )}
            </View>
          )}

          {/* Business Feature Tab: Building Members (Building Maintenance) */}
          {activeTab === 'building_members' && isBuildingBusiness && (
            <View>
              {!myBuilding ? (
                <Text style={styles.emptyStateText}>{t('bld_noBuildingYet')}</Text>
              ) : (
                <>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeading}>{t('bld_membersHeading')}</Text>
                    <Pressable onPress={handleOpenAddMember} style={styles.primaryPillBtn}>
                      <Text style={styles.primaryPillBtnText}>{t('bld_addMember')}</Text>
                    </Pressable>
                  </View>

                  <TextInput
                    value={memberSearchQuery}
                    onChangeText={setMemberSearchQuery}
                    placeholder={t('bld_searchMember')}
                    placeholderTextColor={colors.muted}
                    style={[styles.modalInput, { marginBottom: 10 }]}
                  />

                  <View style={styles.modePillRow}>
                    {[
                      { key: '', label: t('bld_allTypes') },
                      { key: 'Owner', label: 'Owner' },
                      { key: 'Tenant', label: 'Tenant' },
                      { key: 'Family Member', label: 'Family' },
                      { key: 'Other', label: 'Other' },
                    ].map(opt => (
                      <Pressable
                        key={opt.key || 'all'}
                        onPress={() => setMemberTypeFilter(opt.key)}
                        style={[styles.modePill, memberTypeFilter === opt.key && styles.modePillActive]}>
                        <Text style={[styles.modePillText, memberTypeFilter === opt.key && styles.modePillTextActive]}>{opt.label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {buildingMembers.length === 0 && (
                    <Text style={styles.emptyStateText}>{t('bld_emptyMembers')}</Text>
                  )}
                  {buildingMembers.map(member => (
                    <Pressable key={member.id} onPress={() => handleOpenMemberPassbook(member)} style={styles.dueCard}>
                      <View style={styles.dueInfoCol}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.dueName}>{member.fullName}</Text>
                          <View style={styles.invCategoryPill}>
                            <Text style={styles.invCategoryText}>{member.memberType}</Text>
                          </View>
                        </View>
                        <Text style={styles.duePhone}>{member.mobileNumber || '—'}{member.flatNumber ? ` • Flat ${member.flatNumber}` : ''}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable
                          onPress={() => handleOpenEditMember(member)}
                          style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                          <Text style={{ fontSize: 13 }}>✏️</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleDeleteMember(member)}
                          style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                          <Text style={{ fontSize: 14 }}>🗑️</Text>
                        </Pressable>
                      </View>
                    </Pressable>
                  ))}
                </>
              )}
            </View>
          )}

          {/* Business Feature Tab: Maintenance / Bills / Payments (Building Maintenance) */}
          {activeTab === 'building_maintenance' && isBuildingBusiness && (
            <View>
              {!myBuilding ? (
                <Text style={styles.emptyStateText}>{t('bld_noBuildingYet')}</Text>
              ) : (
                <>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeading}>{t('bld_navMaintenance')}</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable
                        onPress={handleOpenConfigModal}
                        style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', borderWidth: 1, width: 34, height: 34, borderRadius: 8 }}>
                        <Text style={{ fontSize: 15 }}>⚙️</Text>
                      </Pressable>
                      <Pressable onPress={handleOpenGenerateBills} style={styles.primaryPillBtn}>
                        <Text style={styles.primaryPillBtnText}>{t('bld_generateBills')}</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.modePillRow}>
                    {([
                      { key: 'bills' as const, label: t('bld_navBills') },
                      { key: 'payments' as const, label: t('bld_navPayments') },
                    ]).map(v => (
                      <Pressable
                        key={v.key}
                        onPress={() => setMaintenanceView(v.key)}
                        style={[styles.modePill, maintenanceView === v.key && styles.modePillActive]}>
                        <Text style={[styles.modePillText, maintenanceView === v.key && styles.modePillTextActive]}>{v.label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {maintenanceView === 'bills' && (
                    <>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable
                          onPress={openBillMonthPicker}
                          style={[styles.modalInput, { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                          <Text style={{ color: billMonthFilter ? colors.navy : colors.muted, fontSize: 14 }}>
                            {billMonthFilter
                              ? new Date(`${billMonthFilter}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                              : t('bld_billMonthFilter')}
                          </Text>
                          <Text style={{ fontSize: 15 }}>📅</Text>
                        </Pressable>
                        {!!billMonthFilter && (
                          <Pressable
                            onPress={() => setBillMonthFilter('')}
                            style={{ width: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.redBg, borderWidth: 1, borderColor: colors.redBorder }}>
                            <Text style={{ fontSize: 14, fontWeight: '800', color: colors.red }}>✕</Text>
                          </Pressable>
                        )}
                      </View>
                      <View style={styles.modePillRow}>
                        {[
                          { key: '', label: t('bld_allStatus') },
                          { key: 'Pending', label: 'Pending' },
                          { key: 'Partially Paid', label: 'Partial' },
                          { key: 'Paid', label: 'Paid' },
                          { key: 'Overdue', label: 'Overdue' },
                        ].map(opt => (
                          <Pressable
                            key={opt.key || 'all'}
                            onPress={() => setBillStatusFilter(opt.key)}
                            style={[styles.modePill, billStatusFilter === opt.key && styles.modePillActive]}>
                            <Text style={[styles.modePillText, billStatusFilter === opt.key && styles.modePillTextActive]}>{opt.label}</Text>
                          </Pressable>
                        ))}
                      </View>

                      {billsSummary && (
                        <View style={styles.kpiRow}>
                          <View style={styles.kpiCard}>
                            <Text style={styles.kpiLabel}>{t('bld_totalBilled')}</Text>
                            <Text style={styles.kpiValue}>₹{billsSummary.totalBilled.toLocaleString()}</Text>
                          </View>
                          <View style={styles.kpiCard}>
                            <Text style={styles.kpiLabel}>{t('bld_totalCollected')}</Text>
                            <Text style={[styles.kpiValue, styles.textPositive]}>₹{billsSummary.totalCollected.toLocaleString()}</Text>
                          </View>
                          <View style={styles.kpiCard}>
                            <Text style={styles.kpiLabel}>{t('bld_totalPending')}</Text>
                            <Text style={[styles.kpiValue, styles.textNegative]}>₹{billsSummary.totalPending.toLocaleString()}</Text>
                          </View>
                        </View>
                      )}

                      {buildingBills.length === 0 && (
                        <Text style={styles.emptyStateText}>{t('bld_emptyBills')}</Text>
                      )}
                      {buildingBills.map(bill => {
                        const statusColor =
                          bill.status === 'Paid' ? colors.green :
                          bill.status === 'Overdue' ? colors.red :
                          bill.status === 'Partially Paid' ? colors.amber :
                          bill.status === 'Cancelled' ? colors.muted : colors.brand;
                        return (
                          <View key={bill.id} style={styles.dueCard}>
                            <View style={styles.dueInfoCol}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={styles.dueName}>{bill.flatNumber}</Text>
                                <View style={[styles.invCategoryPill, { backgroundColor: statusColor + '22' }]}>
                                  <Text style={[styles.invCategoryText, { color: statusColor }]}>{bill.status}</Text>
                                </View>
                              </View>
                              <Text style={styles.duePhone}>{bill.billingMonth?.slice(0, 7)} • {t('bld_due')} {bill.dueDate}</Text>
                              <Text style={styles.duePhone}>₹{bill.totalAmount.toLocaleString()} {t('bld_totalAmount').toLowerCase()} • ₹{bill.paidAmount.toLocaleString()} {t('bld_paidAmount').toLowerCase()}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end', gap: 6 }}>
                              <Text style={[styles.dueAmountText, bill.balanceAmount > 0 ? styles.textNegative : styles.textPositive]}>
                                ₹{bill.balanceAmount.toLocaleString()}
                              </Text>
                              {bill.balanceAmount > 0 && bill.status !== 'Cancelled' && (
                                <Pressable onPress={() => handleOpenRecordPayment(bill)} style={styles.settleBtn}>
                                  <Text style={styles.settleBtnText}>{t('bld_recordPayment')}</Text>
                                </Pressable>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </>
                  )}

                  {maintenanceView === 'payments' && (
                    <>
                      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                        <Pressable onPress={() => setShowPaymentFlatDropdown(true)} style={[styles.selectBox, { flex: 1 }]}>
                          <Text style={paymentFlatFilter ? styles.selectBoxText : styles.selectBoxPlaceholder} numberOfLines={1}>
                            {paymentFlatFilter ? (buildingFlats.find(f => f.id === paymentFlatFilter)?.flatNumber || t('bld_allFlats')) : t('bld_allFlats')}
                          </Text>
                          <Text style={styles.selectBoxChevron}>▾</Text>
                        </Pressable>
                        <Pressable onPress={() => setShowPaymentMethodDropdown(true)} style={[styles.selectBox, { flex: 1 }]}>
                          <Text style={paymentMethodFilter ? styles.selectBoxText : styles.selectBoxPlaceholder} numberOfLines={1}>
                            {paymentMethodFilter || t('bld_allMethods')}
                          </Text>
                          <Text style={styles.selectBoxChevron}>▾</Text>
                        </Pressable>
                      </View>

                      {buildingPayments.length === 0 && (
                        <Text style={styles.emptyStateText}>{t('bld_emptyPayments')}</Text>
                      )}
                      {buildingPayments.map(payment => (
                        <View key={payment.id} style={styles.card}>
                          <View style={styles.complianceRow}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.invItemName}>{payment.flatNumber} {payment.memberName ? `• ${payment.memberName}` : ''}</Text>
                              <Text style={styles.complianceDesc}>{payment.paymentDate} • {payment.paymentMethod} • {payment.receiptNumber}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end', gap: 6 }}>
                              <Text style={[styles.tripFareText, styles.textPositive]}>+₹{payment.amount.toLocaleString()}</Text>
                              <Pressable onPress={() => handleViewMaintenanceReceipt(payment.id)}>
                                <Text style={{ fontSize: 11, color: colors.brand, fontWeight: '700' }}>{t('bld_viewReceipt')}</Text>
                              </Pressable>
                            </View>
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                </>
              )}
            </View>
          )}

          {/* Business Feature Tab: Complaints (Building Maintenance) */}
          {activeTab === 'building_complaints' && isBuildingBusiness && (
            <View>
              {!myBuilding ? (
                <Text style={styles.emptyStateText}>{t('bld_noBuildingYet')}</Text>
              ) : (
                <>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeading}>{t('bld_complaintsHeading')} {complaintsOpenCount > 0 ? `(${complaintsOpenCount} ${t('bld_openComplaints')})` : ''}</Text>
                    <Pressable onPress={handleOpenAddComplaint} style={styles.primaryPillBtn}>
                      <Text style={styles.primaryPillBtnText}>{t('bld_newComplaint')}</Text>
                    </Pressable>
                  </View>

                  <Pressable onPress={() => setShowComplaintStatusDropdown(true)} style={[styles.selectBox, { marginBottom: 10 }]}>
                    <Text style={complaintStatusFilter ? styles.selectBoxText : styles.selectBoxPlaceholder}>
                      {complaintStatusFilter || t('bld_allStatus')}
                    </Text>
                    <Text style={styles.selectBoxChevron}>▾</Text>
                  </Pressable>

                  {buildingComplaints.length === 0 && (
                    <Text style={styles.emptyStateText}>{t('bld_emptyComplaints')}</Text>
                  )}
                  {buildingComplaints.map(complaint => {
                    const priorityColor =
                      complaint.priority === 'Urgent' ? colors.red :
                      complaint.priority === 'High' ? colors.amber :
                      complaint.priority === 'Medium' ? colors.brand : colors.muted;
                    const statusColor =
                      complaint.status === 'Resolved' || complaint.status === 'Closed' ? colors.green :
                      complaint.status === 'Rejected' ? colors.red :
                      complaint.status === 'In Progress' ? colors.amber : colors.brand;
                    return (
                      <Pressable key={complaint.id} onPress={() => handleOpenEditComplaint(complaint)} style={styles.inventoryCard}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={styles.invItemName}>{complaint.title}</Text>
                            <View style={[styles.invCategoryPill, { backgroundColor: priorityColor + '22' }]}>
                              <Text style={[styles.invCategoryText, { color: priorityColor }]}>{complaint.priority}</Text>
                            </View>
                          </View>
                          <Text style={styles.invPriceText}>
                            {complaint.category}{complaint.flatNumber ? ` • Flat ${complaint.flatNumber}` : ''} • {complaint.complaintDate}
                          </Text>
                          {(complaint.assignedStaffName || complaint.assignedVendorName) && (
                            <Text style={styles.invPriceText}>
                              👷 {complaint.assignedStaffName || complaint.assignedVendorName}
                            </Text>
                          )}
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 6 }}>
                          <View style={[styles.stockBadge, { backgroundColor: statusColor + '22', borderColor: statusColor }]}>
                            <Text style={[styles.stockBadgeText, { color: statusColor }]}>{complaint.status}</Text>
                          </View>
                          <Pressable
                            onPress={() => handleDeleteComplaint(complaint)}
                            style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                            <Text style={{ fontSize: 14 }}>🗑️</Text>
                          </Pressable>
                        </View>
                      </Pressable>
                    );
                  })}
                </>
              )}
            </View>
          )}

          {/* Business Feature Tab: Staff (Building Maintenance) */}
          {activeTab === 'building_staff' && isBuildingBusiness && (
            <View>
              {!myBuilding ? (
                <Text style={styles.emptyStateText}>{t('bld_noBuildingYet')}</Text>
              ) : (
                <>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeading}>{t('bld_staffHeading')}</Text>
                    <Pressable onPress={handleOpenAddStaff} style={styles.primaryPillBtn}>
                      <Text style={styles.primaryPillBtnText}>{t('bld_addStaff')}</Text>
                    </Pressable>
                  </View>

                  {buildingStaffList.length === 0 && (
                    <Text style={styles.emptyStateText}>{t('bld_emptyStaff')}</Text>
                  )}
                  {buildingStaffList.map(staff => (
                    <View key={staff.id} style={styles.inventoryCard}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.invItemName}>{staff.fullName}</Text>
                          <View style={styles.invCategoryPill}>
                            <Text style={styles.invCategoryText}>{staff.jobType}</Text>
                          </View>
                        </View>
                        <Text style={styles.invPriceText}>{staff.mobileNumber || '—'} {staff.salary > 0 ? `• ₹${staff.salary.toLocaleString()}/mo` : ''}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable
                          onPress={() => handleOpenEditStaff(staff)}
                          style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                          <Text style={{ fontSize: 13 }}>✏️</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleDeleteStaff(staff)}
                          style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                          <Text style={{ fontSize: 14 }}>🗑️</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </View>
          )}

          {/* Business Feature Tab: Vendors (Building Maintenance) */}
          {activeTab === 'building_vendors' && isBuildingBusiness && (
            <View>
              {!myBuilding ? (
                <Text style={styles.emptyStateText}>{t('bld_noBuildingYet')}</Text>
              ) : (
                <>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionHeading}>{t('bld_vendorsHeading')}</Text>
                    <Pressable onPress={handleOpenAddVendor} style={styles.primaryPillBtn}>
                      <Text style={styles.primaryPillBtnText}>{t('bld_addVendor')}</Text>
                    </Pressable>
                  </View>

                  {buildingVendorsList.length === 0 && (
                    <Text style={styles.emptyStateText}>{t('bld_emptyVendors')}</Text>
                  )}
                  {buildingVendorsList.map(vendor => (
                    <View key={vendor.id} style={styles.inventoryCard}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={styles.invItemName}>{vendor.vendorName}</Text>
                          <View style={styles.invCategoryPill}>
                            <Text style={styles.invCategoryText}>{vendor.serviceType}</Text>
                          </View>
                        </View>
                        <Text style={styles.invPriceText}>
                          {vendor.contactPerson || '—'} {vendor.mobile ? `• ${vendor.mobile}` : ''}
                          {vendor.contractEndDate ? ` • Until ${vendor.contractEndDate}` : ''}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Pressable
                          onPress={() => handleOpenEditVendor(vendor)}
                          style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF2FF', borderColor: '#C7D2FE', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                          <Text style={{ fontSize: 13 }}>✏️</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleDeleteVendor(vendor)}
                          style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, width: 30, height: 30, borderRadius: 6 }}>
                          <Text style={{ fontSize: 14 }}>🗑️</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </View>
          )}

          {activeTab === 'plan' && (
            <View>
              {/* Active Plan Card */}
              <View style={styles.activePlanCard}>
                <View style={styles.activePlanTagRow}>
                  <View style={styles.planStatusPill}>
                    <Text style={styles.planStatusPillText}>{t('plan_activeSubscription')}</Text>
                  </View>
                  <Text style={styles.planRenewBadge}>{t('plan_autoRenewOn')}</Text>
                </View>

                <Text style={styles.planTitleName}>{user.activePlan || t('plan_standardPlan')}</Text>
                <Text style={styles.planSubInfo}>
                  {t('plan_billingCycle')} <Text style={styles.boldText}>{user.billingCycle.toUpperCase()}</Text>
                </Text>

                <View style={styles.planValidityBox}>
                  <View style={styles.validityCol}>
                    <Text style={styles.validityLabel}>{t('plan_memberStatus')}</Text>
                    <Text style={styles.validityValue}>{t('plan_verifiedCustomer')}</Text>
                  </View>
                  <View style={styles.validityCol}>
                    <Text style={styles.validityLabel}>{t('plan_tierAmount')}</Text>
                    <Text style={styles.validityValue}>
                      {user.planAmount > 0 ? `₹${user.planAmount} / ${user.billingCycle}` : t('plan_includedPlan')}
                    </Text>
                  </View>
                </View>

                <View style={styles.perksList}>
                  <Text style={styles.perksHeader}>{t('plan_includedInPlan')}</Text>
                  <Text style={styles.perkItem}>{t('plan_perk1')}</Text>
                  <Text style={styles.perkItem}>{t('plan_perk2')}</Text>
                  <Text style={styles.perkItem}>{t('plan_perk3')}</Text>
                  <Text style={styles.perkItem}>{t('plan_perk4')}</Text>
                </View>
              </View>

              {/* Available Plans Section */}
              <Text style={styles.sectionHeading}>{t('plan_exploreUpgrade')}</Text>
              {plansLoading ? (
                <Text style={styles.helperText}>{t('plan_loadingPlans')}</Text>
              ) : (
                availablePlans.map(plan => (
                  <View key={plan.id} style={[styles.planCard, plan.popular && styles.planCardPopular]}>
                    {plan.popular && (
                      <View style={styles.popularBadge}>
                        <Text style={styles.popularBadgeText}>{t('plan_mostPopular')}</Text>
                      </View>
                    )}
                    <View style={styles.planHeaderRow}>
                      <View>
                        <Text style={styles.planCardName}>{plan.name}</Text>
                        <Text style={styles.planCardDesc}>{plan.description || t('plan_fullLedgerSuite')}</Text>
                      </View>
                      <View style={styles.planCardPriceBox}>
                        <Text style={styles.planCardPrice}>₹{plan.monthlyAmount}</Text>
                        <Text style={styles.planCardCycle}>{t('plan_perMonth')}</Text>
                      </View>
                    </View>

                    <View style={styles.planFeatureList}>
                      {(plan.features || []).map((feat, idx) => (
                        <Text key={idx} style={styles.planFeatureText}>
                          • {feat}
                        </Text>
                      ))}
                    </View>

                    <Pressable
                      onPress={() =>
                        Alert.alert(
                          t('plan_ingestionTitle'),
                          t('plan_ingestionMsg', { plan: plan.name, amount: plan.monthlyAmount })
                        )
                      }
                      style={[
                        styles.planSelectBtn,
                        user.activePlan.toLowerCase() === plan.name.toLowerCase() && styles.planSelectBtnCurrent,
                      ]}>
                      <Text
                        style={[
                          styles.planSelectBtnText,
                          user.activePlan.toLowerCase() === plan.name.toLowerCase() && styles.planSelectBtnTextCurrent,
                        ]}>
                        {user.activePlan.toLowerCase() === plan.name.toLowerCase()
                          ? t('plan_currentActivePlan')
                          : t('plan_upgradeTo', { plan: plan.name })}
                      </Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          )}

          {activeTab === 'dues' && !isCollection && (
            <View>
              {/* Dues Summary Card */}
              <View style={styles.duesOverviewCard}>
                <View style={styles.duesOverviewCol}>
                  <Text style={styles.duesOverviewLabel}>YOU WILL GET (RECEIVABLE)</Text>
                  <Text style={[styles.duesOverviewAmount, styles.textPositive]}>
                    ₹{totalToCollect.toLocaleString()}
                  </Text>
                </View>
                <View style={styles.duesDivider} />
                <View style={styles.duesOverviewCol}>
                  <Text style={styles.duesOverviewLabel}>YOU WILL GIVE (PAYABLE)</Text>
                  <Text style={[styles.duesOverviewAmount, styles.textNegative]}>
                    ₹{totalToPay.toLocaleString()}
                  </Text>
                </View>
              </View>

              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>Khata Customers ({dues.length})</Text>
                <Pressable onPress={() => setShowAddDueModal(true)} style={styles.addDueBtnSmall}>
                  <Text style={styles.addDueBtnSmallText}>+ Add Due</Text>
                </Pressable>
              </View>

              {dues.map(due => (
                <View key={due.id} style={styles.dueCard}>
                  <View style={styles.dueInfoCol}>
                    <Text style={styles.dueName}>{due.name}</Text>
                    <Text style={styles.duePhone}>{due.phone}</Text>
                    <Text style={styles.dueUpdated}>Updated: {due.lastUpdated}</Text>
                  </View>
                  <View style={styles.dueAmountCol}>
                    <Text
                      style={[
                        styles.dueAmountText,
                        due.type === 'to_collect' ? styles.textPositive : styles.textNegative,
                      ]}>
                      {due.type === 'to_collect' ? `Get ₹${due.amount}` : `Give ₹${due.amount}`}
                    </Text>
                    <Pressable onPress={() => handleSettleDue(due.id)} style={styles.settleBtn}>
                      <Text style={styles.settleBtnText}>Settle / Paid</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          {activeTab === 'profile' && (
            <View>
              {/* Profile Card */}
              <View style={styles.profileCard}>
                <View style={styles.profileAvatarLarge}>
                  <Text style={styles.profileAvatarTextLarge}>{user.fullName.charAt(0)}</Text>
                </View>
                <Text style={styles.profileFullName}>{user.fullName}</Text>
                <View style={styles.profileBadge}>
                  <Text style={styles.profileBadgeText}>
                    {getBusinessIcon(user.businessType)} {user.businessType}
                  </Text>
                </View>

                <View style={styles.profileDetailsList}>
                  <View style={styles.profileRow}>
                    <Text style={styles.profileRowLabel}>{t('profile_customerId')}</Text>
                    <Text style={styles.profileRowVal}>#{user.id}</Text>
                  </View>
                  <View style={styles.profileRow}>
                    <Text style={styles.profileRowLabel}>{t('profile_registeredEmail')}</Text>
                    <Text style={styles.profileRowVal}>{user.email}</Text>
                  </View>
                  <View style={styles.profileRow}>
                    <Text style={styles.profileRowLabel}>{t('profile_dob')}</Text>
                    <Text style={styles.profileRowVal}>{user.dob || t('profile_registered')}</Text>
                  </View>
                  <View style={styles.profileRow}>
                    <Text style={styles.profileRowLabel}>{t('profile_currentPlan')}</Text>
                    <Text style={styles.profileRowVal}>{user.activePlan}</Text>
                  </View>
                  <View style={styles.profileRow}>
                    <Text style={styles.profileRowLabel}>{t('profile_accountStatus')}</Text>
                    <Text style={[styles.profileRowVal, styles.textPositive]}>{t('profile_activeCustomer')}</Text>
                  </View>
                </View>
              </View>

              {/* Support & Assistance Card */}
              <View style={styles.supportCard}>
                <Text style={styles.supportHeading}>{t('profile_supportHeading')}</Text>
                <Text style={styles.supportDesc}>
                  {t('profile_supportDesc')}
                </Text>
                <View style={styles.supportContactRow}>
                  <Text style={styles.supportContactText}>{t('profile_supportPhone')}</Text>
                  <Text style={styles.supportContactText}>{t('profile_supportEmail')}</Text>
                </View>
              </View>

              {/* PIN Login management */}
              <View style={styles.supportCard}>
                <Text style={styles.supportHeading}>🔐 {t('pin_profileHeading')}</Text>
                <Text style={styles.supportDesc}>
                  {pinLoginAvailable ? t('pin_profileEnabledDesc') : t('pin_profileDisabledDesc')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <Pressable
                    onPress={() => {
                      setSetupPinStep('enter');
                      setSetupPinValue('');
                      setSetupPinConfirmValue('');
                      setSetupPinError('');
                      setShowSetupPinModal(true);
                    }}
                    style={[styles.primaryPillBtn, { flex: 1, alignItems: 'center' }]}>
                    <Text style={styles.primaryPillBtnText}>{pinLoginAvailable ? t('pin_changeBtn') : t('pin_setupBtn')}</Text>
                  </Pressable>
                  {pinLoginAvailable && (
                    <Pressable
                      onPress={() =>
                        Alert.alert(t('pin_disableConfirmTitle'), t('pin_disableConfirmMsg'), [
                          { text: t('common_cancel'), style: 'cancel' },
                          { text: t('pin_disableBtn'), style: 'destructive', onPress: handleDisablePinLogin },
                        ])
                      }
                      style={{
                        flex: 1, backgroundColor: colors.redBg, borderWidth: 1, borderColor: colors.redBorder,
                        borderRadius: 8, paddingVertical: 9, alignItems: 'center', justifyContent: 'center',
                      }}>
                      <Text style={{ color: colors.red, fontSize: 12, fontWeight: '700' }}>{t('pin_disableBtn')}</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              {/* Log Out button in Profile tab */}
              <Pressable
                onPress={handleLogout}
                style={({ pressed }) => [styles.profileLogoutBtn, pressed && styles.profileLogoutBtnPressed]}>
                <Text style={styles.profileLogoutBtnText}>{t('profile_logout')}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>

        {/* Modal: Settle Collection Payment */}
        <Modal visible={showCollectModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>💵 Settle Collection Payment</Text>
                <Pressable onPress={() => setShowCollectModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {selectedCollectItem && (
                <>
                  <Text style={[styles.complianceDesc, { marginBottom: 6 }]}>
                    Customer: <Text style={styles.boldText}>{selectedCollectItem.customerName || selectedCollectItem.customer_name || selectedCollectItem.name}</Text> ({selectedCollectItem.accountNumber || selectedCollectItem.account_number || 'ACC-2026'})
                  </Text>
                  <Text style={[styles.complianceDesc, { marginBottom: 12 }]}>
                    Area: {selectedCollectItem.area || selectedCollectItem.area_name || 'Market Yard'} • Phone: {selectedCollectItem.mobile || selectedCollectItem.phone || '+91 98765 43210'}
                  </Text>

                  <Text style={styles.fieldLabel}>Amount Collected (₹) *</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder="e.g. 1000"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={collectAmount}
                    onChangeText={setCollectAmount}
                  />

                  <Text style={styles.fieldLabel}>Payment Mode *</Text>
                  <View style={styles.modePillRow}>
                    {(['Cash', 'UPI', 'Bank Transfer'] as const).map(mode => (
                      <Pressable
                        key={mode}
                        onPress={() => setCollectMethod(mode)}
                        style={[styles.modePill, collectMethod === mode && styles.modePillActive]}>
                        <Text style={[styles.modePillText, collectMethod === mode && styles.modePillTextActive]}>{mode}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {(collectMethod === 'UPI' || collectMethod === 'Bank Transfer') && (
                    <>
                      <Text style={styles.fieldLabel}>Transaction Ref / UTR *</Text>
                      <TextInput
                        placeholder="e.g. UPI-9988771122"
                        placeholderTextColor={colors.muted}
                        style={styles.modalInput}
                        value={collectRef}
                        onChangeText={setCollectRef}
                      />
                    </>
                  )}

                  <Text style={styles.fieldLabel}>Notes (Optional)</Text>
                  <TextInput
                    placeholder="e.g. Full instalment collected"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={collectNotes}
                    onChangeText={setCollectNotes}
                  />

                  <Pressable
                    onPress={submitCollectionPayment}
                    disabled={collectLoading}
                    style={[styles.modalSubmitBtn, collectLoading && { opacity: 0.6 }]}>
                    <Text style={styles.modalSubmitBtnText}>
                      {collectLoading ? 'Recording...' : 'Confirm & Issue Receipt'}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      setShowCollectModal(false);
                      handleOpenStatusModal(selectedCollectItem);
                    }}
                    style={{ marginTop: 14, alignItems: 'center', paddingVertical: 6 }}>
                    <Text style={{ color: colors.brand, fontSize: 13, fontWeight: '600' }}>
                      Customer didn't pay? Record visit outcome →
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* Modal: Record Customer Status */}
        <Modal visible={showStatusModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>⚠️ Record Visit Outcome</Text>
                <Pressable onPress={() => setShowStatusModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {selectedStatusItem && (
                <>
                  <Text style={[styles.complianceDesc, { marginBottom: 12 }]}>
                    Customer: <Text style={styles.boldText}>{selectedStatusItem.customerName || selectedStatusItem.customer_name || selectedStatusItem.name}</Text>
                  </Text>

                  <Text style={styles.fieldLabel}>Status *</Text>
                  <View style={styles.modePillRow}>
                    {(['NOT_AVAILABLE', 'RESCHEDULED', 'REFUSED', 'MISSED'] as const).map(st => (
                      <Pressable
                        key={st}
                        onPress={() => setStatusChoice(st)}
                        style={[styles.modePill, statusChoice === st && styles.modePillActive]}>
                        <Text style={[styles.modePillText, statusChoice === st && styles.modePillTextActive]}>
                          {st === 'NOT_AVAILABLE' ? 'Not Available' : st === 'RESCHEDULED' ? 'Reschedule' : st === 'REFUSED' ? 'Refused' : 'Missed'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>Reason / Remarks *</Text>
                  <TextInput
                    placeholder="e.g. Shop closed, out of town, refused payment..."
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={statusReason}
                    onChangeText={setStatusReason}
                  />

                  {statusChoice === 'RESCHEDULED' && (
                    <>
                      <Text style={styles.fieldLabel}>Next Follow-up Date *</Text>
                      <TextInput
                        placeholder="YYYY-MM-DD (e.g. 2026-09-08)"
                        placeholderTextColor={colors.muted}
                        style={styles.modalInput}
                        value={followupDate}
                        onChangeText={setFollowupDate}
                      />
                    </>
                  )}

                  <Pressable
                    onPress={submitStatusUpdate}
                    disabled={statusLoading}
                    style={[styles.modalSubmitBtn, statusLoading && { opacity: 0.6 }]}>
                    <Text style={styles.modalSubmitBtnText}>
                      {statusLoading ? 'Saving...' : 'Save Visit Status'}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* Modal: Official Receipt Voucher */}
        <Modal visible={!!receiptData} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🧾 Collection Receipt</Text>
                <Pressable onPress={() => setReceiptData(null)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {receiptData && (
                <View>
                  <View style={{ backgroundColor: colors.greenBg, padding: 12, borderRadius: 12, marginBottom: 14, alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, color: colors.greenDark, fontWeight: '700' }}>PAYMENT RECEIVED</Text>
                    <Text style={{ fontSize: 26, fontWeight: '800', color: colors.green, marginTop: 4 }}>
                      ₹{Number(receiptData.amount_paid).toLocaleString()}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>
                      Receipt #{receiptData.receipt_number}
                    </Text>
                  </View>

                  <View style={{ backgroundColor: colors.page, padding: 12, borderRadius: 10, marginBottom: 14, gap: 6 }}>
                    <Text style={styles.complianceDesc}>Customer: <Text style={styles.boldText}>{receiptData.customer_name}</Text></Text>
                    <Text style={styles.complianceDesc}>Account: {receiptData.customer_account}</Text>
                    <Text style={styles.complianceDesc}>Payment Mode: {receiptData.payment_method} {receiptData.transaction_ref ? `(${receiptData.transaction_ref})` : ''}</Text>
                    <Text style={styles.complianceDesc}>Collector: {receiptData.collector_name}</Text>
                    <Text style={styles.complianceDesc}>Remaining Outstanding: <Text style={{ color: colors.red, fontWeight: '700' }}>₹{Number(receiptData.updated_balance).toLocaleString()}</Text></Text>
                  </View>

                  <Pressable
                    onPress={() => handleShareReceipt(receiptData)}
                    style={[styles.modalSubmitBtn, { backgroundColor: colors.green }]}>
                    <Text style={styles.modalSubmitBtnText}>📤 Share Receipt (WhatsApp)</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </Modal>

        {/* Modal: End of Day Closing */}
        <Modal visible={showClosingModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🏁 End of Day Beat Closing</Text>
                <Pressable onPress={() => setShowClosingModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <Text style={[styles.complianceDesc, { marginBottom: 10 }]}>
                Reconcile your physical cash collected before branch handover.
              </Text>

              <View style={{ backgroundColor: colors.page, padding: 12, borderRadius: 10, marginBottom: 14, gap: 6 }}>
                <Text style={styles.complianceDesc}>Expected Cash in Bag: <Text style={{ fontWeight: '800', color: colors.green }}>₹{(collectionSummary?.cashAmount || 0).toLocaleString()}</Text></Text>
                <Text style={styles.complianceDesc}>Digital UPI/Bank: ₹{((collectionSummary?.upiAmount || 0) + (collectionSummary?.bankAmount || 0)).toLocaleString()}</Text>
                <Text style={styles.complianceDesc}>Total Collected: ₹{(collectionSummary?.totalCollectedAmount || 0).toLocaleString()}</Text>
              </View>

              <Text style={styles.fieldLabel}>Physical Cash Count in Hand (₹) *</Text>
              <TextInput
                keyboardType="numeric"
                placeholder={`e.g. ${collectionSummary?.cashAmount || 0}`}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={physicalCashCount}
                onChangeText={setPhysicalCashCount}
              />

              <Text style={styles.fieldLabel}>Closing Notes</Text>
              <TextInput
                placeholder="e.g. Beat completed, cash verified"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={closingNotes}
                onChangeText={setClosingNotes}
              />

              <Pressable
                onPress={submitDayClosing}
                disabled={closingLoading}
                style={[styles.modalSubmitBtn, closingLoading && { opacity: 0.6 }]}>
                <Text style={styles.modalSubmitBtnText}>
                  {closingLoading ? 'Closing...' : '🔒 Confirm & Reconcile Day'}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Comprehensive Agent Field Reports */}
        <Modal visible={showAgentReportsModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '90%' }]}>
              <View style={styles.modalHeaderRow}>
                <View>
                  <Text style={styles.modalHeading}>📊 Daily Collection Report</Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                    Agent: {user?.fullName || 'Riya N'} (Private Account)
                  </Text>
                </View>
                <Pressable onPress={() => setShowAgentReportsModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Privacy Badge */}
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1, borderRadius: 8, padding: 8, marginBottom: 14 }}>
                  <Text style={{ fontSize: 12, color: '#047857', fontWeight: '600' }}>
                    🔒 Data Protected: Only you can view your collection accounts & reports.
                  </Text>
                </View>

                {/* KPI Metrics */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                  <View style={{ flex: 1, minWidth: '45%', backgroundColor: colors.page, padding: 12, borderRadius: 10 }}>
                    <Text style={{ fontSize: 11, color: colors.muted, fontWeight: '600' }}>EXPECTED TARGET</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: colors.navy, marginTop: 4 }}>
                      ₹{Number(collectionSummary?.totalExpectedAmount ?? collectionSummary?.totalExpected ?? 56950).toLocaleString()}
                    </Text>
                  </View>

                  <View style={{ flex: 1, minWidth: '45%', backgroundColor: '#ECFDF5', padding: 12, borderRadius: 10 }}>
                    <Text style={{ fontSize: 11, color: '#047857', fontWeight: '600' }}>ACTUALLY COLLECTED</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#059669', marginTop: 4 }}>
                      ₹{Number(collectionSummary?.totalCollectedAmount ?? 3000).toLocaleString()}
                    </Text>
                  </View>

                  <View style={{ flex: 1, minWidth: '45%', backgroundColor: '#FFFBEB', padding: 12, borderRadius: 10 }}>
                    <Text style={{ fontSize: 11, color: '#B45309', fontWeight: '600' }}>REMAINING DUE</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#D97706', marginTop: 4 }}>
                      ₹{Number(collectionSummary?.totalRemainingAmount ?? collectionSummary?.totalPendingAmount ?? 53950).toLocaleString()}
                    </Text>
                  </View>

                  <View style={{ flex: 1, minWidth: '45%', backgroundColor: '#EEF2FF', padding: 12, borderRadius: 10 }}>
                    <Text style={{ fontSize: 11, color: '#3730A3', fontWeight: '600' }}>RECOVERY RATE</Text>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: colors.brand, marginTop: 4 }}>
                      {collectionSummary?.collectionRate ?? 5.3}%
                    </Text>
                  </View>
                </View>

                {/* Mode Breakdown */}
                <View style={{ backgroundColor: colors.page, padding: 14, borderRadius: 10, marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.navy, marginBottom: 10 }}>
                    💳 Payment Channels Breakdown
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ fontSize: 12, color: colors.slate }}>💵 Physical Cash (Handover):</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.greenDark }}>
                      ₹{Number(collectionSummary?.cashAmount ?? 3000).toLocaleString()}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ fontSize: 12, color: colors.slate }}>📱 Digital UPI / QR:</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.brand }}>
                      ₹{Number(collectionSummary?.upiAmount ?? 0).toLocaleString()}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                    <Text style={{ fontSize: 12, color: colors.slate }}>🏦 Bank Transfer:</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.slateDark }}>
                      ₹{Number(collectionSummary?.bankAmount ?? 0).toLocaleString()}
                    </Text>
                  </View>
                </View>

                {/* Visit Statistics */}
                <View style={{ backgroundColor: colors.page, padding: 14, borderRadius: 10, marginBottom: 18 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.navy, marginBottom: 10 }}>
                    📍 Beat Visit Statistics (Today)
                  </Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                    <Text style={{ fontSize: 12, color: colors.slate }}>Total Customers Assigned:</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700' }}>{collectionSchedule.length || 50}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                    <Text style={{ fontSize: 12, color: colors.slate }}>Collected / Settled:</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.greenDark }}>
                      {collectionSchedule.filter((c: any) => c.status === 'COLLECTED').length || 1}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                    <Text style={{ fontSize: 12, color: colors.slate }}>Pending Visits:</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.amber }}>
                      {collectionSchedule.filter((c: any) => !c.status || c.status === 'PENDING').length || 47}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                    <Text style={{ fontSize: 12, color: colors.slate }}>Not Available / Rescheduled:</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>
                      {collectionSchedule.filter((c: any) => c.status === 'NOT_AVAILABLE' || c.status === 'RESCHEDULED').length || 2}
                    </Text>
                  </View>
                </View>

                {/* Action Buttons */}
                <Pressable
                  onPress={handleShareReport}
                  style={[styles.modalSubmitBtn, { backgroundColor: colors.brand, marginBottom: 10 }]}>
                  <Text style={styles.modalSubmitBtnText}>📤 Share Daily Report (WhatsApp)</Text>
                </Pressable>

                <Pressable
                  onPress={() => setShowAgentReportsModal(false)}
                  style={[styles.actionBtnOutline, { borderColor: colors.border }]}>
                  <Text style={[styles.actionBtnOutlineText, { color: colors.slate }]}>Close</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Collection Charts */}
        <Modal visible={showChartsModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '85%' }]}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>📊 Collection Insights</Text>
                <Pressable onPress={() => setShowChartsModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.chartSectionTitle}>🏆 Collected Amount by Customer</Text>
                {(() => {
                  const totals: Record<string, number> = {};
                  (dashboardData?.customers || []).forEach((c: any) => {
                    const key = c.customerName || c.name || 'Customer';
                    totals[key] = (totals[key] || 0) + (c.collectedAmount || 0);
                  });
                  const rows = Object.entries(totals)
                    .filter(([, amt]) => amt > 0)
                    .sort((a, b) => b[1] - a[1]);
                  if (rows.length === 0) {
                    return (
                      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 20 }}>
                        No collections recorded yet for this period.
                      </Text>
                    );
                  }
                  const max = Math.max(...rows.map(r => r[1]), 1);
                  return (
                    <View style={{ marginBottom: 20 }}>
                      {rows.map(([name, amt]) => (
                        <View key={name} style={{ marginBottom: 10 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                            <Text style={{ fontSize: 12, fontWeight: '600', color: colors.slateDark }}>{name}</Text>
                            <Text style={{ fontSize: 12, fontWeight: '800', color: colors.greenDark }}>₹{amt.toLocaleString()}</Text>
                          </View>
                          <View style={{ height: 10, borderRadius: 5, backgroundColor: colors.page, overflow: 'hidden' }}>
                            <View
                              style={{
                                height: '100%',
                                width: `${Math.max((amt / max) * 100, 3)}%`,
                                backgroundColor: colors.brand,
                                borderRadius: 5,
                              }}
                            />
                          </View>
                        </View>
                      ))}
                    </View>
                  );
                })()}

                <Text style={styles.chartSectionTitle}>💳 Payment Method Split</Text>
                {(() => {
                  const cash = dashboardData?.paymentMethods?.cash || 0;
                  const upi = dashboardData?.paymentMethods?.upi || 0;
                  const bank = dashboardData?.paymentMethods?.bankTransfer || 0;
                  const total = cash + upi + bank;
                  if (total <= 0) {
                    return (
                      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
                        No payments recorded yet for this period.
                      </Text>
                    );
                  }
                  const rows = [
                    { label: 'Cash', value: cash, color: colors.green },
                    { label: 'UPI', value: upi, color: colors.brand },
                    { label: 'Bank Transfer', value: bank, color: colors.slateDark },
                  ];
                  return (
                    <View style={{ marginBottom: 10 }}>
                      <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', marginBottom: 12 }}>
                        {rows.map((row) => (
                          <View key={row.label} style={{ flex: Math.max(row.value, 0.001), backgroundColor: row.color }} />
                        ))}
                      </View>
                      {rows.map((row) => (
                        <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: row.color, marginRight: 6 }} />
                          <Text style={{ flex: 1, fontSize: 12, color: colors.slate }}>{row.label}</Text>
                          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.navy }}>₹{row.value.toLocaleString()}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted, marginLeft: 8, minWidth: 34, textAlign: 'right' }}>
                            {Math.round((row.value / total) * 100)}%
                          </Text>
                        </View>
                      ))}
                    </View>
                  );
                })()}

                <Text style={styles.chartSectionTitle}>⏰ Most Overdue Customers</Text>
                {(() => {
                  const overdueRows = collectionSchedule
                    .map((c: any) => ({
                      name: c.customerName || c.customer_name || c.name || 'Customer',
                      amount: Number(c.pendingAmount || c.pending_amount || 0),
                      days: Number(c.overdueDays || c.overdue_days_count || 0),
                    }))
                    .filter((r) => r.amount > 0)
                    .sort((a, b) => b.amount - a.amount);

                  if (overdueRows.length === 0) {
                    return (
                      <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
                        No customers are overdue right now. 🎉
                      </Text>
                    );
                  }

                  const total = overdueRows.reduce((acc, r) => acc + r.amount, 0);
                  const cx = 70;
                  const cy = 70;
                  const r = 70;
                  let cumulativeAngle = 0;
                  const slices = overdueRows.map((row, idx) => {
                    const angle = (row.amount / total) * 360;
                    const startAngle = cumulativeAngle;
                    const endAngle = cumulativeAngle + angle;
                    cumulativeAngle = endAngle;
                    return { ...row, startAngle, endAngle, color: PIE_CHART_PALETTE[idx % PIE_CHART_PALETTE.length] };
                  });

                  return (
                    <View style={{ marginBottom: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                        <Svg width={140} height={140} viewBox="0 0 140 140">
                          {slices.length === 1 ? (
                            <Path
                              d={`M ${cx - r},${cy} a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 -${r * 2},0`}
                              fill={slices[0].color}
                            />
                          ) : (
                            slices.map((s) => (
                              <Path key={s.name} d={describePieSlice(cx, cy, r, s.startAngle, s.endAngle)} fill={s.color} />
                            ))
                          )}
                        </Svg>
                        <View style={{ flex: 1 }}>
                          {slices.slice(0, 6).map((s) => (
                            <View key={s.name} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color, marginRight: 6 }} />
                              <Text style={{ flex: 1, fontSize: 11, color: colors.slate }} numberOfLines={1}>
                                {s.name}{s.days > 0 ? ` (${s.days}d)` : ''}
                              </Text>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.red }}>
                                ₹{s.amount.toLocaleString()}
                              </Text>
                            </View>
                          ))}
                        </View>
                      </View>
                    </View>
                  );
                })()}

                <Pressable
                  onPress={() => setShowChartsModal(false)}
                  style={[styles.actionBtnOutline, { borderColor: colors.border, marginTop: 8, marginBottom: 20 }]}>
                  <Text style={[styles.actionBtnOutlineText, { color: colors.slate }]}>Close</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Edit Collection Customer */}
        <Modal visible={showEditCustModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>✏️ Edit Customer</Text>
                <Pressable onPress={() => setShowEditCustModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.fieldLabel}>CUSTOMER FULL NAME *</Text>
                <TextInput
                  value={editCustName}
                  onChangeText={setEditCustName}
                  placeholder="Customer Name"
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                />

                <Text style={styles.fieldLabel}>MOBILE NUMBER *</Text>
                <TextInput
                  value={editCustMobile}
                  onChangeText={setEditCustMobile}
                  placeholder="Mobile Number"
                  placeholderTextColor={colors.muted}
                  keyboardType="phone-pad"
                  style={styles.modalInput}
                />

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>AREA / BEAT</Text>
                    <TextInput
                      value={editCustArea}
                      onChangeText={setEditCustArea}
                      placeholder="Area / Neighborhood"
                      placeholderTextColor={colors.muted}
                      style={styles.modalInput}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>EXPECTED AMOUNT (₹) *</Text>
                    <TextInput
                      value={editCustExpected}
                      onChangeText={setEditCustExpected}
                      placeholder="1000"
                      placeholderTextColor={colors.muted}
                      keyboardType="numeric"
                      style={styles.modalInput}
                    />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>TOTAL OUTSTANDING DUE (₹)</Text>
                <TextInput
                  value={editCustTotalDue}
                  onChangeText={setEditCustTotalDue}
                  placeholder="Total Due"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  style={styles.modalInput}
                />

                <Text style={styles.fieldLabel}>ANNUAL INTEREST RATE (%)</Text>
                <TextInput
                  value={editCustInterestRate}
                  onChangeText={setEditCustInterestRate}
                  placeholder="e.g. 12"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  style={styles.modalInput}
                />

                <Text style={styles.fieldLabel}>STREET ADDRESS</Text>
                <TextInput
                  value={editCustAddress}
                  onChangeText={setEditCustAddress}
                  placeholder="Address"
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                />

                <Pressable
                  onPress={handleSaveEditCustomer}
                  disabled={editCustLoading}
                  style={[styles.modalSubmitBtn, { backgroundColor: colors.brand, marginTop: 16, marginBottom: 10 }]}>
                  <Text style={styles.modalSubmitBtnText}>
                    {editCustLoading ? 'Updating Customer...' : '✓ Save Changes'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setShowEditCustModal(false)}
                  style={[styles.actionBtnOutline, { borderColor: colors.border }]}>
                  <Text style={[styles.actionBtnOutlineText, { color: colors.slate }]}>Cancel</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Customer Transaction Passbook / In-Out Ledger */}
        <Modal visible={showCustomerPassbookModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '90%' }]}>
              {/* Header */}
              <View style={styles.modalHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalHeading, { fontSize: 18, color: colors.navy }]}>
                    {selectedPassbookCustomer?.customerName || selectedPassbookCustomer?.name || 'Customer Passbook'}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                    📱 {selectedPassbookCustomer?.mobile || selectedPassbookCustomer?.phone || 'No phone'} • 🏷️ {selectedPassbookCustomer?.accountNumber || `ACC-${selectedPassbookCustomer?.customerId || selectedPassbookCustomer?.id || ''}`}
                  </Text>
                  {(selectedPassbookCustomer?.area || selectedPassbookCustomer?.address) ? (
                    <Text style={{ fontSize: 11, color: colors.slate, marginTop: 1 }}>
                      📍 {selectedPassbookCustomer?.area || selectedPassbookCustomer?.address}
                    </Text>
                  ) : null}
                </View>
                <Pressable onPress={() => setShowCustomerPassbookModal(false)} style={{ padding: 6 }}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Highlighted KPI Cards */}
                <View style={{ marginVertical: 10 }}>
                  {/* Total Paid Till Now - Prominently Displayed in Green per user requirement */}
                  <View style={{ backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', borderWidth: 1.5, borderRadius: 12, padding: 14, marginBottom: 10, alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#047857', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      ✓ Aata Priyant Kiti Paid Kela (Total Paid)
                    </Text>
                    <Text style={{ fontSize: 28, fontWeight: '800', color: '#047857', marginVertical: 4 }}>
                      ₹{(passbookData?.summary?.totalPaidTillNow ?? 0).toLocaleString()}
                    </Text>
                    <Text style={{ fontSize: 11, color: '#065F46' }}>
                      Total cash received & credited against this customer
                    </Text>
                  </View>

                  {/* Sub KPI Row: Total Given / Out & Current Due */}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1, backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 10, padding: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#B91C1C' }}>TOTAL GIVEN (OUT)</Text>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: '#DC2626', marginTop: 2 }}>
                        ₹{(passbookData?.summary?.totalGivenTillNow ?? 0).toLocaleString()}
                      </Text>
                      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>Advance / Given</Text>
                    </View>

                    <View style={{ flex: 1, backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1, borderRadius: 10, padding: 10 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: '#1D4ED8' }}>NET OUTSTANDING</Text>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: '#2563EB', marginTop: 2 }}>
                        ₹{(passbookData?.summary?.currentBalance ?? selectedPassbookCustomer?.totalDue ?? 0).toLocaleString()}
                      </Text>
                      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>Current balance</Text>
                    </View>
                  </View>
                </View>

                {/* In / Out Quick Action Buttons */}
                <View style={{ flexDirection: 'row', gap: 10, marginVertical: 6 }}>
                  <Pressable
                    onPress={() => handleOpenAddEntry('IN')}
                    style={{ flex: 1, backgroundColor: '#059669', paddingVertical: 12, borderRadius: 10, alignItems: 'center', shadowColor: '#059669', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 }}>
                    <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 14 }}>
                      + Cash In (Got ₹)
                    </Text>
                    <Text style={{ color: '#D1FAE5', fontSize: 10, marginTop: 1 }}>Customer paid you</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleOpenAddEntry('OUT')}
                    style={{ flex: 1, backgroundColor: '#DC2626', paddingVertical: 12, borderRadius: 10, alignItems: 'center', shadowColor: '#DC2626', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 3 }}>
                    <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 14 }}>
                      − Cash Out (Gave ₹)
                    </Text>
                    <Text style={{ color: '#FEE2E2', fontSize: 10, marginTop: 1 }}>You gave advance</Text>
                  </Pressable>
                </View>

                {/* Section Header */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 8 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.navy }}>
                    📜 Transaction Passbook Feed
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>
                    {passbookData?.transactions?.length ?? 0} entries
                  </Text>
                </View>

                {/* Transaction Feed */}
                {passbookLoading ? (
                  <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>Loading passbook records...</Text>
                  </View>
                ) : (!passbookData?.transactions || passbookData.transactions.length === 0) ? (
                  <View style={{ paddingVertical: 26, alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 16 }}>
                    <Text style={{ fontSize: 24, marginBottom: 6 }}>📭</Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.slate, textAlign: 'center' }}>No Transactions Yet</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'center', marginTop: 4 }}>
                      Tap '+ Cash In' when customer pays or '− Cash Out' when advance is given.
                    </Text>
                  </View>
                ) : (
                  passbookData.transactions.map((tx: any, idx: number) => {
                    const isTxIn = (tx.entryType || tx.entry_type || 'IN').toUpperCase() === 'IN';
                    const txDate = tx.paymentDate || tx.payment_date || tx.created_at || '';
                    const { date: formattedDate, time: formattedTime } = formatIndianDateTime(txDate);

                    return (
                      <View
                        key={tx.id || `tx-${idx}`}
                        style={{
                          backgroundColor: '#FFFFFF',
                          borderColor: isTxIn ? '#A7F3D0' : '#FECACA',
                          borderLeftWidth: 4,
                          borderTopWidth: 1,
                          borderRightWidth: 1,
                          borderBottomWidth: 1,
                          borderRadius: 8,
                          padding: 10,
                          marginBottom: 8,
                        }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{
                              backgroundColor: isTxIn ? '#ECFDF5' : '#FEF2F2',
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: 6,
                            }}>
                              <Text style={{
                                fontSize: 11,
                                fontWeight: '800',
                                color: isTxIn ? '#047857' : '#B91C1C',
                              }}>
                                {isTxIn ? '⬇️ Cash In' : '⬆️ Cash Out'}
                              </Text>
                            </View>
                            <Text style={{ fontSize: 11, color: colors.muted }}>
                              {formattedDate} {formattedTime ? `• ${formattedTime}` : ''}
                            </Text>
                          </View>
                          <Text style={{
                            fontSize: 15,
                            fontWeight: '800',
                            color: isTxIn ? '#059669' : '#DC2626',
                          }}>
                            {isTxIn ? `+ ₹${Number(tx.amount).toLocaleString()}` : `− ₹${Number(tx.amount).toLocaleString()}`}
                          </Text>
                        </View>

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                          <Text style={{ fontSize: 11, color: colors.slate }}>
                            Payment Mode: <Text style={{ fontWeight: '700' }}>{tx.paymentMethod || tx.payment_method || 'Cash'}</Text>
                          </Text>
                          {tx.receiptNumber ? (
                            <Text style={{ fontSize: 10, color: colors.brand, fontWeight: '700' }}>
                              🧾 {tx.receiptNumber}
                            </Text>
                          ) : null}
                        </View>

                        {tx.notes ? (
                          <Text style={{ fontSize: 11, color: colors.muted, fontStyle: 'italic', marginTop: 4, backgroundColor: '#F8FAFC', padding: 4, borderRadius: 4 }}>
                            "{tx.notes}"
                          </Text>
                        ) : null}

                        <Pressable
                          onPress={() => handleDeleteEntry(tx)}
                          style={{ alignSelf: 'flex-end', marginTop: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.red }}>🗑️ Delete this entry</Text>
                        </Pressable>
                      </View>
                    );
                  })
                )}

                <Pressable
                  onPress={() => handleOpenCloseAccount(selectedPassbookCustomer)}
                  style={{ backgroundColor: colors.redBg, borderColor: colors.redBorder, borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 16 }}>
                  <Text style={{ color: colors.red, fontWeight: '800', fontSize: 13 }}>🔒 Close Account (Final Settlement)</Text>
                </Pressable>

                <Pressable
                  onPress={() => setShowCustomerPassbookModal(false)}
                  style={[styles.actionBtnOutline, { marginTop: 10, marginBottom: 20, borderColor: colors.border }]}>
                  <Text style={[styles.actionBtnOutlineText, { color: colors.slate }]}>Close Passbook</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Customer Collection Calendar (standalone) */}
        <Modal visible={showCalendarModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalHeading, { fontSize: 17 }]}>
                    {calendarCustomer?.customerName || calendarCustomer?.customer_name || calendarCustomer?.name || 'Customer'}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                    📅 Collection Calendar
                  </Text>
                </View>
                <Pressable onPress={() => setShowCalendarModal(false)} style={{ padding: 6 }}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {calendarLoading ? (
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Loading calendar...</Text>
                </View>
              ) : (
                renderMonthCalendar(calendarScheduleDays)
              )}

              <Pressable
                onPress={() => setShowCalendarModal(false)}
                style={[styles.actionBtnOutline, { marginTop: 14, borderColor: colors.border }]}>
                <Text style={[styles.actionBtnOutlineText, { color: colors.slate }]}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Close Customer Account - final settlement summary */}
        <Modal visible={showCloseAccountModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '88%' }]}>
              <View style={styles.modalHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalHeading, { fontSize: 17, color: colors.red }]}>🔒 Close Account</Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                    {closingSummary?.customer?.name || 'Customer'} · Final Settlement Summary
                  </Text>
                </View>
                <Pressable onPress={() => setShowCloseAccountModal(false)} style={{ padding: 6 }}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {closingSummaryLoading || !closingSummary ? (
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <Text style={{ color: colors.muted, fontSize: 13 }}>Loading settlement summary...</Text>
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false}>
                  {/* Credit / Debit */}
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
                    <View style={{ flex: 1, backgroundColor: colors.greenBg, borderColor: colors.greenBorder, borderWidth: 1, borderRadius: 12, padding: 12 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: colors.greenDark, textTransform: 'uppercase' }}>Credit (Received)</Text>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: colors.greenDark, marginTop: 4 }}>
                        + ₹{Number(closingSummary.totalCredit).toLocaleString()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.redBg, borderColor: colors.redBorder, borderWidth: 1, borderRadius: 12, padding: 12 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: colors.red, textTransform: 'uppercase' }}>Debit (Given)</Text>
                      <Text style={{ fontSize: 20, fontWeight: '800', color: colors.red, marginTop: 4 }}>
                        − ₹{Number(closingSummary.totalDebit).toLocaleString()}
                      </Text>
                    </View>
                  </View>

                  <View style={{ backgroundColor: colors.page, borderRadius: 12, padding: 14, marginBottom: 12 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text style={{ fontSize: 12, color: colors.slate }}>Net Paid (Credit − Debit)</Text>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.navy }}>
                        ₹{Number(closingSummary.netPaid).toLocaleString()}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text style={{ fontSize: 12, color: colors.slate }}>Outstanding Principal</Text>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.navy }}>
                        ₹{Number(closingSummary.outstandingPrincipal).toLocaleString()}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text style={{ fontSize: 12, color: colors.slate }}>
                        Interest ({closingSummary.interestRate}% p.a. × {closingSummary.daysOutstanding} days)
                      </Text>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.amber }}>
                        + ₹{Number(closingSummary.interestAmount).toLocaleString()}
                      </Text>
                    </View>
                  </View>

                  <View style={{ backgroundColor: colors.brandBg, borderColor: colors.brand, borderWidth: 1.5, borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: closingSummary.finalSettlementAmount > 0 ? 8 : 16 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: colors.brandDark, textTransform: 'uppercase' }}>
                      Total Collected (Lifetime)
                    </Text>
                    <Text style={{ fontSize: 26, fontWeight: '800', color: colors.brandDark, marginTop: 4 }}>
                      ₹{Number(closingSummary.netPaid).toLocaleString()}
                    </Text>
                  </View>

                  {closingSummary.finalSettlementAmount > 0 && (
                    <View style={{ backgroundColor: colors.amberBg, borderColor: colors.amberBorder, borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 16 }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', color: colors.amber }}>
                        ⚠ ₹{Number(closingSummary.finalSettlementAmount).toLocaleString()} still outstanding (principal + interest). Closing now will write this off as uncollected.
                      </Text>
                    </View>
                  )}

                  <Text style={styles.fieldLabel}>CLOSING NOTES (OPTIONAL)</Text>
                  <TextInput
                    value={closeAccountNotes}
                    onChangeText={setCloseAccountNotes}
                    placeholder="e.g. Fully settled in person, waived interest, etc."
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    multiline
                  />

                  <Pressable
                    onPress={handleConfirmCloseAccount}
                    disabled={closeAccountSubmitting}
                    style={{ backgroundColor: colors.red, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 }}>
                    <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 14 }}>
                      {closeAccountSubmitting ? 'Closing Account...' : '🔒 Confirm & Close Account'}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setShowCloseAccountModal(false)}
                    style={[styles.actionBtnOutline, { marginTop: 10, marginBottom: 20, borderColor: colors.border }]}>
                    <Text style={[styles.actionBtnOutlineText, { color: colors.slate }]}>Cancel</Text>
                  </Pressable>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* Modal: Add Customer In/Out Transaction */}
        <Modal visible={showEntryModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <View>
                  <Text style={[styles.modalHeading, { color: entryType === 'IN' ? '#047857' : '#B91C1C' }]}>
                    {entryType === 'IN' ? '↓ Record Cash In (Got ₹)' : '↑ Record Cash Out (Gave ₹)'}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                    For: {selectedPassbookCustomer?.customerName || selectedPassbookCustomer?.name}
                  </Text>
                </View>
                <Pressable onPress={() => setShowEntryModal(false)} style={{ padding: 6 }}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Type Switcher */}
                <View style={{ flexDirection: 'row', gap: 8, marginVertical: 10 }}>
                  <Pressable
                    onPress={() => setEntryType('IN')}
                    style={[
                      { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, alignItems: 'center' },
                      entryType === 'IN'
                        ? { backgroundColor: '#ECFDF5', borderColor: '#059669' }
                        : { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
                    ]}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: entryType === 'IN' ? '#047857' : colors.muted }}>
                      ⬇️ Cash In (Got)
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setEntryType('OUT')}
                    style={[
                      { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, alignItems: 'center' },
                      entryType === 'OUT'
                        ? { backgroundColor: '#FEF2F2', borderColor: '#DC2626' }
                        : { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
                    ]}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: entryType === 'OUT' ? '#B91C1C' : colors.muted }}>
                      ⬆️ Cash Out (Gave)
                    </Text>
                  </Pressable>
                </View>

                {/* Amount Input */}
                <Text style={styles.fieldLabel}>AMOUNT (₹) *</Text>
                <TextInput
                  value={entryAmount}
                  onChangeText={setEntryAmount}
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                  keyboardType="numeric"
                  autoFocus
                  style={[styles.modalInput, { fontSize: 20, fontWeight: '700', textAlign: 'center' }]}
                />

                {/* Payment Method Pills */}
                <Text style={styles.fieldLabel}>PAYMENT METHOD</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {(['Cash', 'UPI', 'Bank Transfer'] as const).map(mode => (
                    <Pressable
                      key={mode}
                      onPress={() => setEntryPaymentMode(mode)}
                      style={[
                        { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
                        entryPaymentMode === mode
                          ? { backgroundColor: '#EEF2FF', borderColor: colors.brand }
                          : { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
                      ]}>
                      <Text style={{
                        fontSize: 12,
                        fontWeight: '700',
                        color: entryPaymentMode === mode ? colors.brand : colors.slate,
                      }}>
                        {mode === 'Cash' ? '💵 Cash' : mode === 'UPI' ? '⚡ UPI' : '🏦 Bank'}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Reference ID */}
                <Text style={styles.fieldLabel}>
                  TRANSACTION REFERENCE {(entryPaymentMode === 'UPI' || entryPaymentMode === 'Bank Transfer') ? '*' : '(OPTIONAL)'}
                </Text>
                <TextInput
                  value={entryRef}
                  onChangeText={setEntryRef}
                  placeholder="UPI ID, Cheque #, or Transfer Ref"
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                />

                {/* Notes / Purpose */}
                <Text style={styles.fieldLabel}>REMARKS / NOTES (OPTIONAL)</Text>
                <TextInput
                  value={entryNotes}
                  onChangeText={setEntryNotes}
                  placeholder={entryType === 'IN' ? 'e.g. Weekly payment, EMI paid' : 'e.g. Advance given, spare parts loan'}
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                />

                {/* Submit Button */}
                <Pressable
                  onPress={handleSaveCustomerEntry}
                  disabled={entrySubmitting}
                  style={[
                    styles.modalSubmitBtn,
                    { backgroundColor: entryType === 'IN' ? '#059669' : '#DC2626', marginTop: 14, marginBottom: 8 },
                  ]}>
                  <Text style={styles.modalSubmitBtnText}>
                    {entrySubmitting ? 'Saving Transaction...' : `✓ Save ${entryType === 'IN' ? 'Cash In' : 'Cash Out'}`}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setShowEntryModal(false)}
                  style={[styles.actionBtnOutline, { borderColor: colors.border }]}>
                  <Text style={[styles.actionBtnOutlineText, { color: colors.slate }]}>Cancel</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Add Daily Ledger Transaction */}
        <Modal visible={showAddModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>
                  {txType === 'in' ? 'Record Cash In (Received)' : 'Record Cash Out (Spent)'}
                </Text>
                <Pressable onPress={() => setShowAddModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {/* Type Switcher */}
              <View style={styles.modalTypeSwitch}>
                <Pressable
                  onPress={() => setTxType('in')}
                  style={[styles.modalTypeBtn, txType === 'in' && styles.modalTypeBtnActiveIn]}>
                  <Text style={[styles.modalTypeBtnText, txType === 'in' && styles.modalTypeBtnTextActive]}>
                    ↓ Cash In (Got)
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setTxType('out')}
                  style={[styles.modalTypeBtn, txType === 'out' && styles.modalTypeBtnActiveOut]}>
                  <Text style={[styles.modalTypeBtnText, txType === 'out' && styles.modalTypeBtnTextActive]}>
                    ↑ Cash Out (Spent)
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>Amount (₹)</Text>
              <TextInput
                keyboardType="numeric"
                placeholder="e.g. 250"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={txAmount}
                onChangeText={setTxAmount}
              />

              <Text style={styles.fieldLabel}>Party Name or Purpose</Text>
              <TextInput
                placeholder={txType === 'in' ? 'e.g. Ride fare, Ramesh shop' : 'e.g. Petrol, Spare parts, Lunch'}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={txParty}
                onChangeText={setTxParty}
              />

              <Text style={styles.fieldLabel}>Payment Mode</Text>
              <View style={styles.modePillRow}>
                {(['Cash', 'UPI', 'Card', 'Credit'] as const).map(mode => (
                  <Pressable
                    key={mode}
                    onPress={() => setTxMode(mode)}
                    style={[styles.modePill, txMode === mode && styles.modePillActive]}>
                    <Text style={[styles.modePillText, txMode === mode && styles.modePillTextActive]}>{mode}</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable onPress={handleAddTransaction} style={styles.modalSubmitBtn}>
                <Text style={styles.modalSubmitBtnText}>Save Entry to Ledger</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Add Customer Due */}
        <Modal visible={showAddDueModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>Add Khata Due</Text>
                <Pressable onPress={() => setShowAddDueModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <View style={styles.modalTypeSwitch}>
                <Pressable
                  onPress={() => setDueType('to_collect')}
                  style={[styles.modalTypeBtn, dueType === 'to_collect' && styles.modalTypeBtnActiveIn]}>
                  <Text style={[styles.modalTypeBtnText, dueType === 'to_collect' && styles.modalTypeBtnTextActive]}>
                    You Will Get
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setDueType('to_pay')}
                  style={[styles.modalTypeBtn, dueType === 'to_pay' && styles.modalTypeBtnActiveOut]}>
                  <Text style={[styles.modalTypeBtnText, dueType === 'to_pay' && styles.modalTypeBtnTextActive]}>
                    You Will Give
                  </Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>Customer / Merchant Name</Text>
              <TextInput
                placeholder="e.g. Mohan Lal"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={dueName}
                onChangeText={setDueName}
              />

              <Text style={styles.fieldLabel}>Due Amount (₹)</Text>
              <TextInput
                keyboardType="numeric"
                placeholder="e.g. 500"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={dueAmount}
                onChangeText={setDueAmount}
              />

              <Pressable onPress={handleAddDue} style={styles.modalSubmitBtn}>
                <Text style={styles.modalSubmitBtnText}>Add to Khata</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: New Bus Trip (Travels Bus Booking Online) */}
        <Modal visible={showNewTripModal} animationType="slide" transparent onRequestClose={() => setShowNewTripModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🚌 {t('trv_newTrip')}</Text>
                <Pressable onPress={() => setShowNewTripModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
              <Text style={styles.fieldLabel}>{t('trv_route')}</Text>
              <TextInput
                placeholder={t('trv_routePh')}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={tripRouteInput}
                onChangeText={setTripRouteInput}
              />
              {!!tripRouteInput.trim() && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.fieldLabel}>{t('trv_routeStops')}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: -4, marginBottom: 8 }}>
                    {t('trv_routeStopsHint')}
                  </Text>
                  {routeStopSuggestions.length > 0 && (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {routeStopSuggestions.map(loc => (
                        <View
                          key={loc}
                          style={{
                            flexDirection: 'row', alignItems: 'center', backgroundColor: colors.brandBg,
                            borderRadius: 14, paddingLeft: 10, paddingRight: 6, paddingVertical: 5, gap: 6,
                          }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: colors.brand }}>{loc}</Text>
                          <Pressable onPress={() => handleRemoveRouteStop(loc)} hitSlop={6}>
                            <Text style={{ fontSize: 11, fontWeight: '800', color: colors.brand }}>✕</Text>
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      placeholder={t('trv_addStopPh')}
                      placeholderTextColor={colors.muted}
                      style={[styles.modalInput, { flex: 1 }]}
                      value={newStopInput}
                      onChangeText={setNewStopInput}
                      onSubmitEditing={handleAddRouteStop}
                    />
                    <Pressable
                      onPress={handleAddRouteStop}
                      disabled={addingStop || !newStopInput.trim()}
                      style={[styles.primaryPillBtn, { justifyContent: 'center' }, (addingStop || !newStopInput.trim()) && { opacity: 0.5 }]}>
                      <Text style={styles.primaryPillBtnText}>{t('common_add')}</Text>
                    </Pressable>
                  </View>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('trv_travelDate')}</Text>
                  <Pressable onPress={openTripDatePicker} style={[styles.modalInput, { justifyContent: 'center' }]}>
                    <Text style={{ fontSize: 14, color: tripDateInput ? colors.navy : colors.muted }}>
                      {tripDateInput || '2026-09-25'}
                    </Text>
                  </Pressable>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('trv_departureTime')}</Text>
                  <TextInput
                    placeholder="22:00"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={tripTimeInput}
                    onChangeText={setTripTimeInput}
                  />
                </View>
              </View>
              <Text style={styles.fieldLabel}>{t('trv_busNumber')}</Text>
              {travelVehicles.length > 0 && (
                <Pressable
                  onPress={() => setShowTripBusDropdown(prev => !prev)}
                  style={[styles.modalInput, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
                  <Text style={{ fontSize: 14, color: tripBusNumberInput ? colors.navy : colors.muted, fontWeight: tripBusNumberInput ? '700' : '400' }}>
                    {tripBusNumberInput
                      ? `🚌 ${tripBusNumberInput}${travelVehicles.some(v => v.regNumber === tripBusNumberInput) ? `  ${vehicleTypeIconLabel(tripBusTypeInput)}` : ''}`
                      : t('trv_selectBusPlaceholder')}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted }}>{showTripBusDropdown ? '▲' : '▼'}</Text>
                </Pressable>
              )}
              {showTripBusDropdown && travelVehicles.length > 0 && (
                <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, marginTop: -8, marginBottom: 14, overflow: 'hidden' }}>
                  <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                    {travelVehicles.map(v => (
                      <Pressable
                        key={v.id}
                        onPress={() => handleSelectTripBus(v)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                          paddingVertical: 12, paddingHorizontal: 14,
                          backgroundColor: tripBusNumberInput === v.regNumber ? colors.brandBg : colors.panel,
                          borderTopWidth: 1, borderTopColor: colors.border,
                        }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 15 }}>🚌</Text>
                          <View>
                            <Text style={{ fontSize: 13, fontWeight: '800', color: colors.navy }}>{v.regNumber}</Text>
                            {!!v.model && <Text style={{ fontSize: 11, color: colors.muted }}>{v.model}</Text>}
                          </View>
                        </View>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.brand }}>
                          {vehicleTypeIconLabel(v.busType === 'sleeper' ? 'sleeper' : v.busType === 'ertiga' ? 'ertiga' : 'seater')}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}
              <TextInput
                placeholder={travelVehicles.length > 0 ? t('trv_busNumberManualPlaceholder') : 'MH12AB1234'}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={tripBusNumberInput}
                onChangeText={t => { setTripBusNumberInput(t); setShowTripBusDropdown(false); }}
              />
              <Text style={styles.fieldLabel}>{t('trv_busType')}</Text>
              <Pressable onPress={() => setShowTripBusTypeDropdown(true)} style={styles.selectBox}>
                <Text style={styles.selectBoxText}>{vehicleTypeIconLabel(tripBusTypeInput)}</Text>
                <Text style={styles.selectBoxChevron}>▾</Text>
              </Pressable>

              {tripBusTypeInput !== 'sleeper' ? (
                <>
                  <Text style={styles.fieldLabel}>💺 {t('trv_totalSeats')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <Pressable onPress={() => adjustSeatCount(tripSeaterCountInput, setTripSeaterCountInput, -1)} style={styles.seatStepperBtn}>
                      <Text style={styles.seatStepperBtnText}>−</Text>
                    </Pressable>
                    <TextInput
                      keyboardType="numeric"
                      value={tripSeaterCountInput}
                      onChangeText={v => setTripSeaterCountInput(v.replace(/[^0-9]/g, ''))}
                      style={[styles.modalInput, { flex: 1, textAlign: 'center', fontWeight: '800' }]}
                    />
                    <Pressable onPress={() => adjustSeatCount(tripSeaterCountInput, setTripSeaterCountInput, 1)} style={styles.seatStepperBtn}>
                      <Text style={styles.seatStepperBtnText}>+</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.fieldLabel}>💺 {t('trv_seaterSeatsLabel')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <Pressable onPress={() => adjustSeatCount(tripSeaterCountInput, setTripSeaterCountInput, -1)} style={styles.seatStepperBtn}>
                      <Text style={styles.seatStepperBtnText}>−</Text>
                    </Pressable>
                    <TextInput
                      keyboardType="numeric"
                      value={tripSeaterCountInput}
                      onChangeText={v => setTripSeaterCountInput(v.replace(/[^0-9]/g, ''))}
                      style={[styles.modalInput, { flex: 1, textAlign: 'center', fontWeight: '800' }]}
                    />
                    <Pressable onPress={() => adjustSeatCount(tripSeaterCountInput, setTripSeaterCountInput, 1)} style={styles.seatStepperBtn}>
                      <Text style={styles.seatStepperBtnText}>+</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.fieldLabel}>🛏️ {t('trv_sleeperSeatsLabel')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <Pressable onPress={() => adjustSeatCount(tripSleeperCountInput, setTripSleeperCountInput, -1)} style={styles.seatStepperBtn}>
                      <Text style={styles.seatStepperBtnText}>−</Text>
                    </Pressable>
                    <TextInput
                      keyboardType="numeric"
                      value={tripSleeperCountInput}
                      onChangeText={v => setTripSleeperCountInput(v.replace(/[^0-9]/g, ''))}
                      style={[styles.modalInput, { flex: 1, textAlign: 'center', fontWeight: '800' }]}
                    />
                    <Pressable onPress={() => adjustSeatCount(tripSleeperCountInput, setTripSleeperCountInput, 1)} style={styles.seatStepperBtn}>
                      <Text style={styles.seatStepperBtnText}>+</Text>
                    </Pressable>
                  </View>
                  <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 14 }}>
                    {t('trv_totalSeatsReadout', {
                      count: String((parseInt(tripSeaterCountInput, 10) || 0) + (parseInt(tripSleeperCountInput, 10) || 0)),
                    })}
                  </Text>
                </>
              )}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('trv_farePerSeat')}</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder="e.g. 500"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={tripFareInput}
                    onChangeText={setTripFareInput}
                  />
                </View>
              </View>

              <Pressable onPress={handleSaveNewTrip} disabled={newTripSaving} style={[styles.modalSubmitBtn, newTripSaving && { opacity: 0.6 }]}>
                <Text style={styles.modalSubmitBtnText}>{newTripSaving ? t('common_saving') : t('trv_saveTrip')}</Text>
              </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Trip Vehicle Type Dropdown (New Trip) */}
        <Modal visible={showTripBusTypeDropdown} animationType="slide" transparent onRequestClose={() => setShowTripBusTypeDropdown(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowTripBusTypeDropdown(false)}>
            <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>{t('trv_busType')}</Text>
                <Pressable onPress={() => setShowTripBusTypeDropdown(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.dropdownList}>
                {(['seater', 'sleeper', 'ertiga'] as const).map(opt => (
                  <Pressable
                    key={opt}
                    onPress={() => {
                      handleSelectBusType(opt);
                      setShowTripBusTypeDropdown(false);
                    }}
                    style={[styles.dropdownOption, tripBusTypeInput === opt && styles.dropdownOptionActive]}>
                    <Text style={[styles.dropdownOptionText, tripBusTypeInput === opt && styles.dropdownOptionTextActive]}>
                      {vehicleTypeIconLabel(opt)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Travel Date calendar picker (Travels Bus Booking Online) */}
        <Modal visible={showTripDatePicker} animationType="fade" transparent onRequestClose={() => setShowTripDatePicker(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowTripDatePicker(false)}>
            <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>📅 {t('trv_travelDate')}</Text>
                <Pressable onPress={() => setShowTripDatePicker(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {renderCalendarPicker(calendarMonth, tripDateInput, shiftCalendarMonth, (iso) => {
                setTripDateInput(iso);
                setShowTripDatePicker(false);
              })}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Trip List Date Filter (Travels Bus Booking Online) */}
        <Modal visible={showTripListDateFilter} animationType="fade" transparent onRequestClose={() => setShowTripListDateFilter(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowTripListDateFilter(false)}>
            <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>📅 {t('trv_filterByDate')}</Text>
                <Pressable onPress={() => setShowTripListDateFilter(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {renderCalendarPicker(filterCalendarMonth, tripListDateFilter, shiftFilterCalendarMonth, (iso) => {
                setTripListDateFilter(iso === tripListDateFilter ? '' : iso);
                setShowTripListDateFilter(false);
              })}
              {!!tripListDateFilter && (
                <Pressable
                  onPress={() => { setTripListDateFilter(''); setShowTripListDateFilter(false); }}
                  style={{ marginTop: 14, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: colors.brandBg }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand }}>{t('trv_clearDateFilter')}</Text>
                </Pressable>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Daily Collection - pick a date to view (Fruit Sellers / Retailers) */}
        <Modal visible={showDcCalendarPicker} animationType="fade" transparent onRequestClose={() => setShowDcCalendarPicker(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowDcCalendarPicker(false)}>
            <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>📅 {t('dc_pickDate')}</Text>
                <Pressable onPress={() => setShowDcCalendarPicker(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {renderCalendarPicker(dcCalendarMonth, dcSelectedDate, shiftDcCalendarMonth, (iso) => {
                setDcSelectedDate(iso);
                setShowDcCalendarPicker(false);
              })}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Daily Collection - Purchase details (Product, Qty, Date, Vendor) */}
        <Modal visible={showPurchaseDetailModal} animationType="slide" transparent onRequestClose={() => setShowPurchaseDetailModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>📥 {t('dc_purchaseDetailsTitle')}</Text>
                <Pressable onPress={() => setShowPurchaseDetailModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 12 }}>
                {dcSelectedDate === formatDateISO(new Date()) ? t('common_today') : formatDisplayDate(dcSelectedDate)}
              </Text>
              {(() => {
                const purchases = inventoryTransactions.filter((tx: any) => tx.type === 'PURCHASE');
                if (purchases.length === 0) {
                  return <Text style={styles.emptyStateText}>{t('dc_noPurchasesPeriod')}</Text>;
                }
                return (
                  <ScrollView style={{ maxHeight: 420 }}>
                    <View style={styles.txTableWrap}>
                      <View style={styles.txTableHeaderRow}>
                        <Text style={[styles.txTableHeaderText, { flex: 1.2 }]}>{t('dc_product')}</Text>
                        <Text style={[styles.txTableHeaderText, { flex: 0.8, textAlign: 'center' }]}>{t('dc_qty')}</Text>
                        <Text style={[styles.txTableHeaderText, { flex: 0.9, textAlign: 'center' }]}>{t('dc_date')}</Text>
                        <Text style={[styles.txTableHeaderText, { flex: 1.1, textAlign: 'right' }]}>{t('dc_vendor')}</Text>
                      </View>
                      {purchases.map((tx: any) => (
                        <View key={tx.id} style={styles.txTableRow}>
                          <Text style={[styles.txTableCellName, { flex: 1.2 }]} numberOfLines={1}>{tx.productName}</Text>
                          <Text style={[styles.txTableCell, { flex: 0.8, textAlign: 'center' }]}>{tx.quantity} {tx.unit}</Text>
                          <Text style={[styles.txTableCell, { flex: 0.9, textAlign: 'center' }]}>{tx.date}</Text>
                          {tx.note ? (
                            <Pressable
                              style={{ flex: 1.1 }}
                              onPress={() => {
                                setShowPurchaseDetailModal(false);
                                handleOpenVendorLedger(tx.note);
                              }}>
                              <Text style={[styles.txTableCell, { textAlign: 'right', color: colors.brand, fontWeight: '700', textDecorationLine: 'underline' }]} numberOfLines={1}>
                                {tx.note}
                              </Text>
                            </Pressable>
                          ) : (
                            <Text style={[styles.txTableCell, { flex: 1.1, textAlign: 'right' }]} numberOfLines={1}>{t('dc_vendorUnknown')}</Text>
                          )}
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                );
              })()}
            </View>
          </View>
        </Modal>

        {/* Modal: Add Vendor - proactively save a vendor's contact details */}
        <Modal visible={showAddVendorModal} animationType="slide" transparent onRequestClose={() => setShowAddVendorModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🏪 {t('dc_addVendorTitle')}</Text>
                <Pressable onPress={() => setShowAddVendorModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>{t('dc_vendorNameLabel')}</Text>
              <TextInput
                placeholder={t('dc_vendorNamePlaceholder')}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={newVendorName}
                onChangeText={setNewVendorName}
              />

              <Text style={styles.fieldLabel}>{t('dc_vendorMobileLabel')}</Text>
              <TextInput
                keyboardType="phone-pad"
                placeholder="e.g. 9876543210"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={newVendorMobile}
                onChangeText={setNewVendorMobile}
              />

              <Text style={styles.fieldLabel}>{t('dc_vendorEmailLabel')}</Text>
              <TextInput
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="e.g. rishi@example.com"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={newVendorEmail}
                onChangeText={setNewVendorEmail}
              />

              <Text style={styles.fieldLabel}>{t('dc_vendorAddressLabel')}</Text>
              <TextInput
                placeholder={t('dc_vendorAddressPlaceholder')}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={newVendorAddress}
                onChangeText={setNewVendorAddress}
              />

              <Pressable
                onPress={handleAddVendor}
                disabled={addVendorLoading}
                style={[styles.modalSubmitBtn, addVendorLoading && { opacity: 0.6 }]}>
                <Text style={styles.modalSubmitBtnText}>{addVendorLoading ? t('common_saving') : t('dc_addVendor')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Vendor Ledger - all purchases from + payments to one vendor, with running due */}
        <Modal visible={showVendorLedgerModal} animationType="slide" transparent onRequestClose={() => setShowVendorLedgerModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🏪 {vendorLedgerName}</Text>
                <Pressable onPress={() => setShowVendorLedgerModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {!!(vendorLedger?.mobileNumber || vendorLedger?.email) && (
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: -8, marginBottom: 10 }}>
                  {[vendorLedger?.mobileNumber, vendorLedger?.email].filter(Boolean).join(' · ')}
                </Text>
              )}

              {vendorLedgerLoading && !vendorLedger && (
                <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} />
              )}

              {vendorLedger && (
                <ScrollView style={{ maxHeight: 480 }}>
                  <View style={styles.kpiRow}>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>{t('dc_vendorTotalPurchased')}</Text>
                      <Text style={[styles.kpiValue, { color: colors.brand }]}>₹{(vendorLedger.totals?.totalCost || 0).toLocaleString()}</Text>
                    </View>
                    <View style={styles.kpiCard}>
                      <Text style={styles.kpiLabel}>{t('dc_vendorTotalPaid')}</Text>
                      <Text style={[styles.kpiValue, styles.textPositive]}>₹{(vendorLedger.totals?.totalPaid || 0).toLocaleString()}</Text>
                    </View>
                  </View>
                  <View style={styles.kpiRow}>
                    <View style={[styles.kpiCard, { flex: 1 }]}>
                      <Text style={styles.kpiLabel}>{t('dc_vendorTotalDue')}</Text>
                      <Text style={[styles.kpiValue, (vendorLedger.totals?.totalDue || 0) > 0 ? styles.textNegative : styles.textPositive]}>
                        ₹{(vendorLedger.totals?.totalDue || 0).toLocaleString()}
                      </Text>
                    </View>
                  </View>

                  {(vendorLedger.totals?.totalDue || 0) > 0 && (
                    <Pressable onPress={handleOpenPayVendor} style={[styles.primaryPillBtn, { alignItems: 'center', marginTop: 4, marginBottom: 16 }]}>
                      <Text style={styles.primaryPillBtnText}>💸 {t('dc_payVendorBtn')}</Text>
                    </Pressable>
                  )}

                  <Text style={styles.chartCardTitle}>📖 {t('dc_vendorPassbookTitle')}</Text>
                  {(() => {
                    type PassbookRow = { key: string; date: string; icon: string; label: string; sub: string; delta: number };
                    const rows: PassbookRow[] = [];
                    (vendorLedger.purchases || []).forEach((p: any) => {
                      rows.push({
                        key: `purchase-${p.id}`,
                        date: p.date,
                        icon: '📥',
                        label: `${t('dc_vendorGotEntry')}: ${p.productName}`,
                        sub: `${p.quantity} ${p.unit}`,
                        delta: p.totalCost,
                      });
                      if (p.amountPaid > 0) {
                        rows.push({
                          key: `purchase-paid-${p.id}`,
                          date: p.date,
                          icon: '💵',
                          label: t('dc_vendorGaveEntry'),
                          sub: t('dc_vendorPaidAtPurchase'),
                          delta: -p.amountPaid,
                        });
                      }
                    });
                    (vendorLedger.payments || []).forEach((p: any) => {
                      rows.push({
                        key: `payment-${p.id}`,
                        date: p.date,
                        icon: '💸',
                        label: t('dc_vendorGaveEntry'),
                        sub: p.note ? `${p.paymentMethod} · ${p.note}` : p.paymentMethod,
                        delta: -p.amount,
                      });
                    });
                    if (rows.length === 0) {
                      return <Text style={styles.emptyStateText}>{t('dc_noVendorActivity')}</Text>;
                    }
                    rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                    let running = 0;
                    const withBalance = rows.map(r => {
                      running += r.delta;
                      return { ...r, balance: running };
                    });
                    withBalance.reverse();
                    return (
                      <View style={{ marginTop: 8 }}>
                        {withBalance.map(r => (
                          <View key={r.key} style={{
                            flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                            borderBottomWidth: 1, borderBottomColor: colors.border,
                          }}>
                            <Text style={{ fontSize: 18, marginRight: 10 }}>{r.icon}</Text>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.navy }} numberOfLines={1}>{r.label}</Text>
                              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }} numberOfLines={1}>{r.sub} · {r.date}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <Text style={{ fontSize: 14, fontWeight: '800', color: r.delta >= 0 ? '#B45309' : colors.greenDark }}>
                                {r.delta >= 0 ? '+' : '−'}₹{Math.abs(r.delta).toLocaleString()}
                              </Text>
                              <Text style={{ fontSize: 10, color: colors.muted, marginTop: 1 }}>
                                {t('dc_vendorBalance')} ₹{r.balance.toLocaleString()}
                              </Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    );
                  })()}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* Modal: Pay Vendor - record a follow-up payment against a vendor's due balance */}
        <Modal visible={showPayVendorModal} animationType="slide" transparent onRequestClose={() => setShowPayVendorModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>💸 {t('dc_payVendorTitle', { vendor: vendorLedgerName })}</Text>
                <Pressable onPress={() => setShowPayVendorModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>{t('dc_amountLabel')}</Text>
              <TextInput
                keyboardType="numeric"
                placeholder="e.g. 500"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={payVendorAmount}
                onChangeText={setPayVendorAmount}
              />

              <Text style={styles.fieldLabel}>{t('dc_paymentMethod')}</Text>
              <View style={styles.modePillRow}>
                {([
                  { key: 'CASH' as const, label: t('common_cash') },
                  { key: 'UPI' as const, label: t('common_upi') },
                  { key: 'CREDIT' as const, label: t('common_credit') },
                ]).map(pm => (
                  <Pressable
                    key={pm.key}
                    onPress={() => setPayVendorMethod(pm.key)}
                    style={[styles.modePill, payVendorMethod === pm.key && styles.modePillActive]}>
                    <Text style={[styles.modePillText, payVendorMethod === pm.key && styles.modePillTextActive]}>
                      {pm.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>{t('dc_noteOptional')}</Text>
              <TextInput
                placeholder={t('dc_notePlaceholder')}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={payVendorNote}
                onChangeText={setPayVendorNote}
              />

              <Pressable
                onPress={handleRecordVendorPayment}
                disabled={payVendorLoading}
                style={[styles.modalSubmitBtn, payVendorLoading && { opacity: 0.6 }]}>
                <Text style={styles.modalSubmitBtnText}>{payVendorLoading ? t('common_saving') : t('dc_payVendorBtn')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Driver Reports - custom range "from" date */}
        <Modal visible={showReportStartPicker} animationType="fade" transparent onRequestClose={() => setShowReportStartPicker(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowReportStartPicker(false)}>
            <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>📅 {t('drv_reportsFrom')}</Text>
                <Pressable onPress={() => setShowReportStartPicker(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {renderCalendarPicker(reportStartCalendarMonth, reportCustomStart, shiftReportStartCalendarMonth, (iso) => {
                setReportCustomStart(iso);
                setShowReportStartPicker(false);
              })}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Driver Reports - custom range "to" date */}
        <Modal visible={showReportEndPicker} animationType="fade" transparent onRequestClose={() => setShowReportEndPicker(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowReportEndPicker(false)}>
            <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>📅 {t('drv_reportsTo')}</Text>
                <Pressable onPress={() => setShowReportEndPicker(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {renderCalendarPicker(reportEndCalendarMonth, reportCustomEnd, shiftReportEndCalendarMonth, (iso) => {
                setReportCustomEnd(iso);
                setShowReportEndPicker(false);
              })}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Book Seat (Travels Bus Booking Online) */}
        <Modal visible={showBookSeatModal} animationType="slide" transparent onRequestClose={() => setShowBookSeatModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>
                  💺 {selectedSeatNumbers.length > 1
                    ? t('trv_bookSeats', { seats: selectedSeatNumbers.slice().sort((a, b) => a - b).join(', ') })
                    : t('trv_bookSeat', { seat: String(selectedSeatNumbers[0] ?? '') })}
                </Text>
                <Pressable onPress={() => setShowBookSeatModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>{t('trv_passengerName')}</Text>
              <TextInput
                placeholder={t('trv_passengerNamePh')}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={bookPassengerName}
                onChangeText={setBookPassengerName}
                autoFocus
              />
              <Text style={styles.fieldLabel}>{t('trv_mobileNumber')}</Text>
              <TextInput
                keyboardType="phone-pad"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={bookMobile}
                onChangeText={setBookMobile}
              />

              {routeStopSuggestions.length > 0 ? (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('trv_pickupLocation')}</Text>
                    <Pressable onPress={() => setShowBookPickupDropdown(true)} style={styles.selectBox}>
                      <Text style={bookPickupLocation ? styles.selectBoxText : styles.selectBoxPlaceholder} numberOfLines={1}>
                        {bookPickupLocation || t('trv_selectLocation')}
                      </Text>
                      <Text style={styles.selectBoxChevron}>▾</Text>
                    </Pressable>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('trv_dropLocation')}</Text>
                    <Pressable onPress={() => setShowBookDropDropdown(true)} style={styles.selectBox}>
                      <Text style={bookDropLocation ? styles.selectBoxText : styles.selectBoxPlaceholder} numberOfLines={1}>
                        {bookDropLocation || t('trv_selectLocation')}
                      </Text>
                      <Text style={styles.selectBoxChevron}>▾</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: -8, marginBottom: 12 }}>
                  {t('trv_noRouteStopsHint')}
                </Text>
              )}

              <Text style={styles.fieldLabel}>
                {selectedSeatNumbers.length > 1 ? t('trv_farePerSeat') : t('trv_fare')}
              </Text>
              <TextInput
                keyboardType="numeric"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={bookFare}
                onChangeText={setBookFare}
              />
              {selectedSeatNumbers.length > 1 && (
                <Text style={{ fontSize: 12, color: colors.muted, marginTop: -10, marginBottom: 14 }}>
                  {t('trv_totalAmount')}: ₹{((parseFloat(bookFare) || 0) * selectedSeatNumbers.length).toLocaleString()}
                </Text>
              )}

              <Text style={styles.fieldLabel}>{t('trv_paymentMode')}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                {(['Cash', 'UPI', 'Online'] as const).map(mode => (
                  <Pressable
                    key={mode}
                    onPress={() => setBookPaymentMode(mode)}
                    style={{
                      flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
                      backgroundColor: bookPaymentMode === mode ? colors.brandBg : colors.page,
                      borderWidth: 1.5, borderColor: bookPaymentMode === mode ? colors.brand : colors.border,
                    }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: bookPaymentMode === mode ? colors.brand : colors.slate }}>
                      {mode}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>{t('trv_paymentStatus')}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                <Pressable
                  onPress={() => setBookPaymentStatus('paid')}
                  style={{
                    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    paddingVertical: 11, borderRadius: 10,
                    backgroundColor: bookPaymentStatus === 'paid' ? colors.greenBg : colors.page,
                    borderWidth: 1.5, borderColor: bookPaymentStatus === 'paid' ? colors.green : colors.border,
                  }}>
                  <Text style={{ fontSize: 13 }}>✅</Text>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: bookPaymentStatus === 'paid' ? colors.greenDark : colors.slate }}>
                    {t('trv_paidNow')}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setBookPaymentStatus('pending')}
                  style={{
                    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    paddingVertical: 11, borderRadius: 10,
                    backgroundColor: bookPaymentStatus === 'pending' ? colors.amberBg : colors.page,
                    borderWidth: 1.5, borderColor: bookPaymentStatus === 'pending' ? colors.amber : colors.border,
                  }}>
                  <Text style={{ fontSize: 13 }}>⏳</Text>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: bookPaymentStatus === 'pending' ? colors.amber : colors.slate }}>
                    {t('trv_payLater')}
                  </Text>
                </Pressable>
              </View>

              <Pressable onPress={handleConfirmBookSeat} disabled={bookSaving} style={[styles.modalSubmitBtn, bookSaving && { opacity: 0.6 }]}>
                <Text style={styles.modalSubmitBtnText}>{bookSaving ? t('common_saving') : t('trv_confirmBooking')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Booking Pickup Location Dropdown (Travels Bus Booking Online) */}
        <Modal visible={showBookPickupDropdown} animationType="slide" transparent onRequestClose={() => setShowBookPickupDropdown(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowBookPickupDropdown(false)}>
            <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>{t('trv_pickupLocation')}</Text>
                <Pressable onPress={() => setShowBookPickupDropdown(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.dropdownList}>
                {routeStopSuggestions.map((loc) => (
                  <Pressable
                    key={loc}
                    onPress={() => { setBookPickupLocation(loc); setShowBookPickupDropdown(false); }}
                    style={[styles.dropdownOption, bookPickupLocation === loc && styles.dropdownOptionActive]}>
                    <Text style={[styles.dropdownOptionText, bookPickupLocation === loc && styles.dropdownOptionTextActive]}>
                      {loc}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Booking Drop Location Dropdown (Travels Bus Booking Online) */}
        <Modal visible={showBookDropDropdown} animationType="slide" transparent onRequestClose={() => setShowBookDropDropdown(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowBookDropDropdown(false)}>
            <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>{t('trv_dropLocation')}</Text>
                <Pressable onPress={() => setShowBookDropDropdown(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.dropdownList}>
                {routeStopSuggestions.map((loc) => (
                  <Pressable
                    key={loc}
                    onPress={() => { setBookDropLocation(loc); setShowBookDropDropdown(false); }}
                    style={[styles.dropdownOption, bookDropLocation === loc && styles.dropdownOptionActive]}>
                    <Text style={[styles.dropdownOptionText, bookDropLocation === loc && styles.dropdownOptionTextActive]}>
                      {loc}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Seat Detail (Travels Bus Booking Online) */}
        <Modal visible={showSeatDetailModal} animationType="fade" transparent onRequestClose={() => setShowSeatDetailModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>💺 {t('trv_seatDetails', { seat: activeSeat?.seatNumber })}</Text>
                <Pressable onPress={() => setShowSeatDetailModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {activeSeat?.booking && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: colors.navy, marginBottom: 4 }}>{activeSeat.booking.passengerName}</Text>
                  {!!activeSeat.booking.mobileNumber && (
                    <Text style={{ fontSize: 13, color: colors.slate, marginBottom: 2 }}>📞 {activeSeat.booking.mobileNumber}</Text>
                  )}
                  {(!!activeSeat.booking.pickupLocation || !!activeSeat.booking.dropLocation) && (
                    <Text style={{ fontSize: 13, color: colors.slate, marginBottom: 2 }}>
                      🚏 {activeSeat.booking.pickupLocation || '—'} → {activeSeat.booking.dropLocation || '—'}
                    </Text>
                  )}
                  <Text style={{ fontSize: 13, color: colors.slate, marginBottom: 8 }}>
                    {t('trv_fare')}: <Text style={{ fontWeight: '700', color: colors.greenDark }}>₹{activeSeat.booking.fare.toLocaleString()}</Text>
                  </Text>

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <View
                      style={[
                        styles.modeBadge,
                        activeSeat.booking.paymentStatus === 'pending'
                          ? { backgroundColor: colors.amberBg }
                          : { backgroundColor: colors.greenBg },
                      ]}>
                      <Text
                        style={[
                          styles.modeBadgeText,
                          activeSeat.booking.paymentStatus === 'pending' ? { color: colors.amber } : { color: colors.greenDark },
                        ]}>
                        {activeSeat.booking.paymentStatus === 'pending' ? `⏳ ${t('trv_pending')}` : `✅ ${t('trv_paid')}`}
                      </Text>
                    </View>
                    <View style={[styles.modeBadge, { backgroundColor: colors.border }]}>
                      <Text style={[styles.modeBadgeText, { color: colors.slate }]}>{activeSeat.booking.paymentMode}</Text>
                    </View>
                  </View>

                  {activeSeat.booking.paymentStatus === 'pending' && (
                    <Pressable
                      onPress={() => handleUpdateSeatPayment({ paymentStatus: 'paid' })}
                      disabled={paymentUpdateSaving}
                      style={[
                        styles.modalSubmitBtn,
                        { backgroundColor: colors.green, marginBottom: 10 },
                        paymentUpdateSaving && { opacity: 0.6 },
                      ]}>
                      <Text style={styles.modalSubmitBtnText}>
                        {paymentUpdateSaving ? t('common_saving') : `✅ ${t('trv_markAsPaid')}`}
                      </Text>
                    </Pressable>
                  )}

                  {!!activeSeat.booking.mobileNumber && travelSelectedTrip && (
                    <Pressable
                      onPress={() =>
                        sendBookingWhatsApp(
                          activeSeat.booking.mobileNumber,
                          buildBookingWhatsAppMessage({
                            passengerName: activeSeat.booking.passengerName,
                            seatNumbers: [activeSeat.seatNumber],
                            trip: travelSelectedTrip,
                            totalFare: activeSeat.booking.fare,
                            paymentStatus: activeSeat.booking.paymentStatus,
                            ownerName: user?.fullName || '',
                            pickupLocation: activeSeat.booking.pickupLocation,
                            dropLocation: activeSeat.booking.dropLocation,
                          })
                        )
                      }
                      style={[styles.modalSubmitBtn, { backgroundColor: '#25D366', marginBottom: 10 }]}>
                      <Text style={styles.modalSubmitBtnText}>💬 {t('trv_sendWhatsAppConfirmation')}</Text>
                    </Pressable>
                  )}

                  {!!activeSeat.booking.mobileNumber && travelSelectedTrip && (
                    <Pressable
                      onPress={() => handleDraftReminder(travelSelectedTrip.id, activeSeat.seatNumber, activeSeat.booking.mobileNumber)}
                      disabled={draftingReminder}
                      style={[
                        styles.modalSubmitBtn,
                        { backgroundColor: colors.brand, marginBottom: 10 },
                        draftingReminder && { opacity: 0.6 },
                      ]}>
                      <Text style={styles.modalSubmitBtnText}>
                        {draftingReminder ? t('trv_reminderDrafting') : t('trv_remindBtn')}
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
              <Pressable onPress={handleCancelSeatBooking} style={[styles.modalSubmitBtn, { backgroundColor: colors.red }]}>
                <Text style={styles.modalSubmitBtnText}>{t('trv_cancelBooking')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: AI-Drafted Passenger Reminder */}
        <Modal visible={showReminderModal} animationType="fade" transparent onRequestClose={() => setShowReminderModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>📨 {t('trv_reminderDraftTitle')}</Text>
                <Pressable onPress={() => setShowReminderModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 12 }}>{t('trv_reminderDraftHint')}</Text>
              <TextInput
                multiline
                numberOfLines={5}
                style={[styles.modalInput, { minHeight: 110, textAlignVertical: 'top' }]}
                value={reminderDraftText}
                onChangeText={setReminderDraftText}
              />
              <Pressable
                onPress={() => {
                  sendBookingWhatsApp(reminderMobile, reminderDraftText);
                  setShowReminderModal(false);
                }}
                style={[styles.modalSubmitBtn, { backgroundColor: '#25D366', marginTop: 14 }]}>
                <Text style={styles.modalSubmitBtnText}>💬 {t('trv_reminderSendWhatsapp')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Driver UPI QR (enlarged for passengers to scan) */}
        <Modal visible={showQrModal} animationType="fade" transparent onRequestClose={() => setShowQrModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>📱 {t('drv_upiQrTitle')}</Text>
                <Pressable onPress={() => setShowQrModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {driverQr && (
                <View style={{ alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 14 }}>
                  <Image source={{ uri: driverQr }} style={{ width: '100%', aspectRatio: 1, maxWidth: 340 }} resizeMode="contain" />
                </View>
              )}
              <Pressable onPress={() => handleOpenQuickPayment('UPI')} style={styles.modalSubmitBtn}>
                <Text style={styles.modalSubmitBtnText}>{t('drv_recordUpiLong')}</Text>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <Pressable onPress={handlePickQr} style={[styles.actionBtnOutline, { flex: 1 }]}>
                  <Text style={styles.actionBtnOutlineText}>{t('drv_replaceQr')}</Text>
                </Pressable>
                <Pressable onPress={handleRemoveQr} style={[styles.actionBtnOutline, { flex: 1, borderColor: colors.redBorder }]}>
                  <Text style={[styles.actionBtnOutlineText, { color: colors.red }]}>{t('drv_removeQr')}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Modal: Record Cash / UPI Payment (Auto Driver) */}
        <Modal visible={showQuickPaymentModal} animationType="fade" transparent onRequestClose={() => setShowQuickPaymentModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>
                  {quickPaymentMode === 'Cash' ? `💵 ${t('drv_recordCash')}` : `💳 ${t('drv_recordUpi')}`}
                </Text>
                <Pressable onPress={() => setShowQuickPaymentModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 12 }}>
                {quickPaymentMode === 'UPI' ? t('drv_confirmUpiHint') : t('drv_confirmCashHint')}
              </Text>
              {!!voiceTranscript && (
                <View style={{ backgroundColor: colors.brandBg, borderRadius: 10, padding: 10, marginBottom: 12 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.brand, marginBottom: 2 }}>
                    🎤 {t('drv_voiceHeard')}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.slate, fontStyle: 'italic' }}>"{voiceTranscript}"</Text>
                </View>
              )}
              <Text style={styles.fieldLabel}>{t('drv_cashAmount')}</Text>
              <TextInput
                autoFocus={!voiceTranscript}
                keyboardType="numeric"
                placeholder={t('drv_cashAmountPh')}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={quickPaymentAmount}
                onChangeText={setQuickPaymentAmount}
              />
              {!!voiceTranscript && (
                <Pressable
                  onPress={() => setVoiceConfirmed(v => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <View style={{
                    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
                    borderColor: voiceConfirmed ? colors.brand : colors.border,
                    backgroundColor: voiceConfirmed ? colors.brand : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {voiceConfirmed && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text>}
                  </View>
                  <Text style={{ fontSize: 12, color: colors.slate, flex: 1 }}>{t('drv_voiceConfirmCheckbox')}</Text>
                </Pressable>
              )}
              <Pressable
                onPress={handleSaveQuickPayment}
                disabled={quickPaymentSaving || (!!voiceTranscript && !voiceConfirmed)}
                style={[
                  styles.modalSubmitBtn, { marginTop: 16 },
                  (quickPaymentSaving || (!!voiceTranscript && !voiceConfirmed)) && { opacity: 0.5 },
                ]}>
                <Text style={styles.modalSubmitBtnText}>{quickPaymentSaving ? t('common_saving') : t('common_save')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Add Fuel Fill */}
        <Modal visible={showAddFuelModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>⛽ {t('fuel_addFuel')}</Text>
                <Pressable onPress={() => setShowAddFuelModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {!isTravelBusiness && !!fuelVoiceTranscript && (
                <View style={{ backgroundColor: colors.brandBg, borderRadius: 10, padding: 10, marginBottom: 12 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.brand, marginBottom: 2 }}>
                    🎤 {t('drv_voiceHeard')}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.slate, fontStyle: 'italic' }}>"{fuelVoiceTranscript}"</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>{t('fuel_type')}</Text>
              <View style={styles.modePillRow}>
                {(['CNG', 'Petrol', 'Diesel'] as const).map(ft => (
                  <Pressable
                    key={ft}
                    onPress={() => setFuelTypeChoice(ft)}
                    style={[styles.modePill, fuelTypeChoice === ft && styles.modePillActive]}>
                    <Text style={[styles.modePillText, fuelTypeChoice === ft && styles.modePillTextActive]}>
                      {ft}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('fuel_quantity')} ({fuelTypeChoice === 'CNG' ? t('fuel_kg') : t('fuel_litres')})</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder="e.g. 5.5"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={fuelQty}
                    onChangeText={setFuelQty}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('fuel_rate')}</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder="85"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={fuelRate}
                    onChangeText={setFuelRate}
                  />
                </View>
              </View>

              {!isTravelBusiness && (
                <>
                  <Text style={styles.fieldLabel}>{t('fuel_totalOverride')}</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder={t('fuel_totalOverridePh')}
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={fuelTotalOverride}
                    onChangeText={setFuelTotalOverride}
                  />
                </>
              )}

              <Text style={styles.fieldLabel}>{t('fuel_currentOdometer')}</Text>
              <TextInput
                keyboardType="numeric"
                placeholder={String(vehicle.totalKm)}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={fuelOdometer}
                onChangeText={setFuelOdometer}
              />

              <Text style={styles.fieldLabel}>{t('fuel_stationName')}</Text>
              <TextInput
                placeholder="e.g. GAIL Gas Indiranagar"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={fuelStationName}
                onChangeText={setFuelStationName}
              />

              {isTravelBusiness && (
                <>
                  <Text style={styles.fieldLabel}>{t('trv_selectTrip')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                    <Pressable
                      onPress={() => setSelectedTripForFuel('NONE')}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
                        backgroundColor: selectedTripForFuel === 'NONE' ? colors.brandBg : colors.page,
                        borderWidth: 1.5, borderColor: selectedTripForFuel === 'NONE' ? colors.brand : colors.border,
                      }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: selectedTripForFuel === 'NONE' ? colors.brand : colors.slate }}>
                        {t('trv_noTripAssigned')}
                      </Text>
                    </Pressable>
                    {travelTrips.map(trip => (
                      <Pressable
                        key={trip.id}
                        onPress={() => setSelectedTripForFuel(String(trip.id))}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, maxWidth: 200,
                          backgroundColor: selectedTripForFuel === String(trip.id) ? colors.brandBg : colors.page,
                          borderWidth: 1.5, borderColor: selectedTripForFuel === String(trip.id) ? colors.brand : colors.border,
                        }}>
                        <Text
                          numberOfLines={1}
                          style={{ fontSize: 12, fontWeight: '700', color: selectedTripForFuel === String(trip.id) ? colors.brand : colors.slate }}>
                          {trip.route}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={styles.fieldLabel}>{t('trv_billNumber')}</Text>
                  <TextInput
                    placeholder="e.g. INV-2026-001"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={fuelBillNumber}
                    onChangeText={setFuelBillNumber}
                  />
                </>
              )}

              {!isTravelBusiness && !!fuelVoiceTranscript && (
                <Pressable
                  onPress={() => setFuelVoiceConfirmed(v => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 12 }}>
                  <View style={{
                    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
                    borderColor: fuelVoiceConfirmed ? colors.brand : colors.border,
                    backgroundColor: fuelVoiceConfirmed ? colors.brand : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {fuelVoiceConfirmed && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text>}
                  </View>
                  <Text style={{ fontSize: 12, color: colors.slate, flex: 1 }}>{t('drv_voiceConfirmCheckbox')}</Text>
                </Pressable>
              )}

              <Pressable
                onPress={handleAddFuel}
                disabled={!isTravelBusiness && !!fuelVoiceTranscript && !fuelVoiceConfirmed}
                style={[
                  styles.modalSubmitBtn, { backgroundColor: colors.red },
                  (!isTravelBusiness && !!fuelVoiceTranscript && !fuelVoiceConfirmed) && { opacity: 0.5 },
                ]}>
                <Text style={styles.modalSubmitBtnText}>{t('fuel_saveFuelLog')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Edit Vehicle Details (Auto Driver, single vehicle) */}
        <Modal visible={showEditVehicleModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🛺 {t('veh_editVehicle')}</Text>
                <Pressable onPress={() => setShowEditVehicleModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>{t('veh_regNumber')}</Text>
              <TextInput
                placeholder="e.g. KA-04-E-4589"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={editVehReg}
                onChangeText={setEditVehReg}
              />

              <Text style={styles.fieldLabel}>{t('veh_model')}</Text>
              <TextInput
                placeholder="e.g. Bajaj Compact RE CNG"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={editVehModel}
                onChangeText={setEditVehModel}
              />

              <Text style={styles.fieldLabel}>{t('veh_insuranceExpiry')} (YYYY-MM-DD)</Text>
              <TextInput
                placeholder="e.g. 2026-11-20"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={editVehInsurance}
                onChangeText={setEditVehInsurance}
              />

              <Text style={styles.fieldLabel}>{t('veh_fitnessExpiry')} (YYYY-MM-DD)</Text>
              <TextInput
                placeholder="e.g. 2027-02-22"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={editVehFitness}
                onChangeText={setEditVehFitness}
              />

              <Text style={styles.fieldLabel}>{t('veh_pucExpiry')} (YYYY-MM-DD)</Text>
              <TextInput
                placeholder="e.g. 2026-10-10"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={editVehPuc}
                onChangeText={setEditVehPuc}
              />

              <Pressable onPress={handleSaveVehicle} style={styles.modalSubmitBtn}>
                <Text style={styles.modalSubmitBtnText}>{t('veh_saveVehicle')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Add/Edit Bus (Travels Bus Booking Online fleet) */}
        <Modal visible={showAddVehicleModal} animationType="slide" transparent onRequestClose={() => setShowAddVehicleModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>
                  🚌 {editingVehicleId ? t('veh_editVehicle') : t('trv_addVehicle')}
                </Text>
                <Pressable onPress={() => setShowAddVehicleModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 8 }}>
              <Text style={styles.fieldLabel}>{t('veh_regNumber')}</Text>
              <TextInput
                placeholder="e.g. MH-12-AB-1234"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={vehRegInput}
                onChangeText={setVehRegInput}
              />

              <Text style={styles.fieldLabel}>{t('veh_model')}</Text>
              <TextInput
                placeholder="e.g. Volvo 9400 Multi-Axle"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={vehModelInput}
                onChangeText={setVehModelInput}
              />

              <Text style={styles.fieldLabel}>{t('trv_busType')}</Text>
              <Pressable onPress={() => setShowVehBusTypeDropdown(true)} style={styles.selectBox}>
                <Text style={styles.selectBoxText}>{vehicleTypeIconLabel(vehBusTypeInput)}</Text>
                <Text style={styles.selectBoxChevron}>▾</Text>
              </Pressable>

              <Text style={styles.fieldLabel}>{t('fuel_type')}</Text>
              <View style={styles.modePillRow}>
                {(['Diesel', 'CNG', 'Petrol', 'Electric'] as const).map(ft => (
                  <Pressable
                    key={ft}
                    onPress={() => setVehFuelTypeInput(ft)}
                    style={[styles.modePill, vehFuelTypeInput === ft && styles.modePillActive]}>
                    <Text style={[styles.modePillText, vehFuelTypeInput === ft && styles.modePillTextActive]}>{ft}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('veh_reg')} (YYYY-MM-DD)</Text>
                  <TextInput
                    placeholder="e.g. 2022-05-10"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={vehRegDateInput}
                    onChangeText={setVehRegDateInput}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('veh_totalDistance')} (KM)</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder="e.g. 125000"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={vehTotalKmInput}
                    onChangeText={setVehTotalKmInput}
                  />
                </View>
              </View>

              <Text style={styles.fieldLabel}>{t('veh_insuranceExpiry')} (YYYY-MM-DD)</Text>
              <TextInput
                placeholder="e.g. 2026-11-15"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={vehInsuranceExpiryInput}
                onChangeText={setVehInsuranceExpiryInput}
              />

              <Text style={styles.fieldLabel}>{t('veh_fitnessCert')} (YYYY-MM-DD)</Text>
              <TextInput
                placeholder="e.g. 2027-02-22"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={vehFitnessExpiryInput}
                onChangeText={setVehFitnessExpiryInput}
              />

              <Text style={styles.fieldLabel}>{t('veh_pucCert')} (YYYY-MM-DD)</Text>
              <TextInput
                placeholder="e.g. 2026-10-10"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={vehPucExpiryInput}
                onChangeText={setVehPucExpiryInput}
              />

              <Pressable
                onPress={handleSaveTravelVehicle}
                disabled={vehSaving}
                style={[styles.modalSubmitBtn, vehSaving && { opacity: 0.6 }]}>
                <Text style={styles.modalSubmitBtnText}>{vehSaving ? t('common_saving') : t('veh_saveVehicle')}</Text>
              </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Vehicle Type Dropdown (Add Vehicle) */}
        <Modal visible={showVehBusTypeDropdown} animationType="slide" transparent onRequestClose={() => setShowVehBusTypeDropdown(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowVehBusTypeDropdown(false)}>
            <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>{t('trv_busType')}</Text>
                <Pressable onPress={() => setShowVehBusTypeDropdown(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.dropdownList}>
                {(['seater', 'sleeper', 'ertiga'] as const).map(opt => (
                  <Pressable
                    key={opt}
                    onPress={() => {
                      setVehBusTypeInput(opt);
                      setShowVehBusTypeDropdown(false);
                    }}
                    style={[styles.dropdownOption, vehBusTypeInput === opt && styles.dropdownOptionActive]}>
                    <Text style={[styles.dropdownOptionText, vehBusTypeInput === opt && styles.dropdownOptionTextActive]}>
                      {vehicleTypeIconLabel(opt)}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Add Product (Fruit Sellers / Retailers) */}
        <Modal visible={showAddProductModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🍎 {t('inv_addProductTitle')}</Text>
                <Pressable onPress={() => setShowAddProductModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {!!inventoryVoiceTranscript && (
                <View style={{ backgroundColor: colors.brandBg, borderRadius: 10, padding: 10, marginBottom: 12 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.brand, marginBottom: 2 }}>
                    🎤 {t('drv_voiceHeard')}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.slate, fontStyle: 'italic' }}>"{inventoryVoiceTranscript}"</Text>
                </View>
              )}

              <Text style={styles.fieldLabel}>{t('inv_productName')}</Text>
              <TextInput
                placeholder={t('inv_productNamePlaceholder')}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={newProductName}
                onChangeText={setNewProductName}
              />

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('inv_category')}</Text>
                  <TextInput
                    placeholder={t('inv_categoryPlaceholder')}
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={newProductCategory}
                    onChangeText={setNewProductCategory}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('inv_unit')}</Text>
                  <TextInput
                    placeholder={t('inv_unitPlaceholder')}
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={newProductUnit}
                    onChangeText={setNewProductUnit}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('inv_openingStock')}</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder="e.g. 50"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={newProductStockQty}
                    onChangeText={setNewProductStockQty}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('inv_lowStockAlert')}</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder="e.g. 5"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={newProductLowStock}
                    onChangeText={setNewProductLowStock}
                  />
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('inv_sellingPriceLabel')}</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder="e.g. 120"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={newProductSellingPrice}
                    onChangeText={setNewProductSellingPrice}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>{t('inv_costPrice')}</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder="e.g. 90"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={newProductCostPrice}
                    onChangeText={setNewProductCostPrice}
                  />
                </View>
              </View>

              {!!inventoryVoiceTranscript && (
                <Pressable
                  onPress={() => setInventoryVoiceConfirmed(v => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 12 }}>
                  <View style={{
                    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
                    borderColor: inventoryVoiceConfirmed ? colors.brand : colors.border,
                    backgroundColor: inventoryVoiceConfirmed ? colors.brand : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {inventoryVoiceConfirmed && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text>}
                  </View>
                  <Text style={{ fontSize: 12, color: colors.slate, flex: 1 }}>{t('drv_voiceConfirmCheckbox')}</Text>
                </Pressable>
              )}

              <Pressable
                onPress={handleAddProduct}
                disabled={addProductLoading || (!!inventoryVoiceTranscript && !inventoryVoiceConfirmed)}
                style={[
                  styles.modalSubmitBtn,
                  (addProductLoading || (!!inventoryVoiceTranscript && !inventoryVoiceConfirmed)) && { opacity: 0.6 },
                ]}>
                <Text style={styles.modalSubmitBtnText}>{addProductLoading ? t('common_saving') : t('inv_saveProduct')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Record Daily Sale/Transaction (Fruit Sellers / Retailers) */}
        <Modal visible={showRecordSaleModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>
                  {saleType === 'WASTAGE' ? `🗑️ ${t('dc_recordWastageTitle')}` : saleType === 'PURCHASE' ? `📥 ${t('dc_recordPurchaseTitle')}` : `🧾 ${t('dc_recordSaleTitle')}`}
                </Text>
                <Pressable onPress={() => setShowRecordSaleModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {!!inventoryVoiceTranscript && (
                <View style={{ backgroundColor: colors.brandBg, borderRadius: 10, padding: 10, marginBottom: 12 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.brand, marginBottom: 2 }}>
                    🎤 {t('drv_voiceHeard')}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.slate, fontStyle: 'italic' }}>"{inventoryVoiceTranscript}"</Text>
                </View>
              )}

              <View style={styles.modePillRow}>
                {(['SALE', 'PURCHASE', 'WASTAGE'] as const).map(st => (
                  <Pressable
                    key={st}
                    onPress={() => setSaleType(st)}
                    style={[styles.modePill, saleType === st && styles.modePillActive]}>
                    <Text style={[styles.modePillText, saleType === st && styles.modePillTextActive]} numberOfLines={1}>
                      {st === 'SALE' ? `🧾 ${t('dc_sale')}` : st === 'PURCHASE' ? `📥 ${t('dc_purchase')}` : `🗑️ ${t('dc_wastage')}`}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>{t('inv_product')}</Text>
              <Pressable
                onPress={() => setShowProductPicker(prev => !prev)}
                style={[styles.modalInput, { justifyContent: 'center' }]}>
                <Text style={{ color: saleProductId ? colors.navy : colors.muted }}>
                  {inventory.find(p => p.id === saleProductId)?.name || t('dc_selectProduct')}
                </Text>
              </Pressable>
              {showProductPicker && (
                <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: -6, marginBottom: 10, overflow: 'hidden' }}>
                  {inventory.map(p => (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        setSaleProductId(p.id);
                        setShowProductPicker(false);
                      }}
                      style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: p.id === saleProductId ? '#EEF2FF' : '#fff' }}>
                      <Text style={{ color: colors.navy }}>{p.name} <Text style={{ color: colors.muted, fontSize: 12 }}>({p.unit})</Text></Text>
                    </Pressable>
                  ))}
                  {inventory.length === 0 && (
                    <Text style={[styles.emptyStateText, { paddingVertical: 10 }]}>{t('dc_addProductFirst')}</Text>
                  )}
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>
                    {saleType === 'WASTAGE' ? t('dc_quantityWasted') : saleType === 'PURCHASE' ? t('dc_quantityPurchased') : t('dc_quantityOptional')}
                  </Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder="e.g. 5"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={saleQuantity}
                    onChangeText={setSaleQuantity}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>
                    {saleType === 'WASTAGE' ? t('dc_lossValueOptional') : saleType === 'PURCHASE' ? t('dc_totalCost') : t('dc_amountLabel')}
                  </Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder={saleType === 'WASTAGE' ? t('dc_autoFromCost') : saleType === 'PURCHASE' ? 'e.g. 1000' : 'e.g. 600'}
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={saleAmount}
                    onChangeText={setSaleAmount}
                  />
                </View>
              </View>
              {saleType === 'WASTAGE' && (
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: -6, marginBottom: 10 }}>
                  {t('dc_lossValueHint')}
                </Text>
              )}

              {saleType === 'PURCHASE' && (
                <>
                  <Text style={styles.fieldLabel}>{t('dc_paidNow')}</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder={saleAmount ? saleAmount : 'e.g. 1000'}
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={salePaidNow}
                    onChangeText={setSalePaidNow}
                  />
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: -6, marginBottom: 10 }}>
                    {t('dc_paidNowHint')}
                  </Text>
                </>
              )}

              {saleType === 'SALE' && (
                <>
                  <Text style={styles.fieldLabel}>{t('dc_paymentMethod')}</Text>
                  <View style={styles.modePillRow}>
                    {([
                      { key: 'CASH' as const, label: t('common_cash') },
                      { key: 'UPI' as const, label: t('common_upi') },
                      { key: 'CREDIT' as const, label: t('common_credit') },
                    ]).map(pm => (
                      <Pressable
                        key={pm.key}
                        onPress={() => setSalePaymentMethod(pm.key)}
                        style={[styles.modePill, salePaymentMethod === pm.key && styles.modePillActive]}>
                        <Text style={[styles.modePillText, salePaymentMethod === pm.key && styles.modePillTextActive]}>
                          {pm.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.fieldLabel}>
                {saleType === 'WASTAGE' ? t('dc_reasonOptional') : saleType === 'PURCHASE' ? t('dc_vendorNameLabel') : t('dc_noteOptional')}
              </Text>
              {saleType === 'PURCHASE' ? (
                <>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TextInput
                      placeholder={t('dc_vendorNamePlaceholder')}
                      placeholderTextColor={colors.muted}
                      style={[styles.modalInput, { flex: 1 }]}
                      value={saleNote}
                      onChangeText={text => { setSaleNote(text); setShowVendorPicker(true); }}
                      onFocus={() => setShowVendorPicker(true)}
                    />
                    <Pressable
                      onPress={() => setShowVendorPicker(prev => !prev)}
                      style={{
                        width: 46, height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: colors.brandBg, borderWidth: 1, borderColor: '#C7D2FE',
                      }}>
                      <Text style={{ fontSize: 14, color: colors.brand }}>{showVendorPicker ? '▲' : '▼'}</Text>
                    </Pressable>
                  </View>
                  {showVendorPicker && (() => {
                    const query = saleNote.trim().toLowerCase();
                    const matches = vendors.filter((v: any) => !query || v.vendorName.toLowerCase().includes(query));
                    if (matches.length === 0) return null;
                    return (
                      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: 6, marginBottom: 10, overflow: 'hidden' }}>
                        {matches.map((v: any) => (
                          <Pressable
                            key={v.vendorName}
                            onPress={() => { setSaleNote(v.vendorName); setShowVendorPicker(false); }}
                            style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: v.vendorName === saleNote ? '#EEF2FF' : '#fff' }}>
                            <Text style={{ color: colors.navy }}>🏪 {v.vendorName}</Text>
                          </Pressable>
                        ))}
                      </View>
                    );
                  })()}
                </>
              ) : (
                <TextInput
                  placeholder={saleType === 'WASTAGE' ? t('dc_reasonPlaceholder') : t('dc_notePlaceholder')}
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                  value={saleNote}
                  onChangeText={setSaleNote}
                />
              )}

              {!!inventoryVoiceTranscript && (
                <Pressable
                  onPress={() => setInventoryVoiceConfirmed(v => !v)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 12 }}>
                  <View style={{
                    width: 20, height: 20, borderRadius: 5, borderWidth: 1.5,
                    borderColor: inventoryVoiceConfirmed ? colors.brand : colors.border,
                    backgroundColor: inventoryVoiceConfirmed ? colors.brand : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {inventoryVoiceConfirmed && <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text>}
                  </View>
                  <Text style={{ fontSize: 12, color: colors.slate, flex: 1 }}>{t('drv_voiceConfirmCheckbox')}</Text>
                </Pressable>
              )}

              <Pressable
                onPress={handleRecordSale}
                disabled={recordSaleLoading || (!!inventoryVoiceTranscript && !inventoryVoiceConfirmed)}
                style={[
                  styles.modalSubmitBtn,
                  saleType === 'WASTAGE' && { backgroundColor: colors.red },
                  saleType === 'PURCHASE' && { backgroundColor: '#D97706' },
                  (recordSaleLoading || (!!inventoryVoiceTranscript && !inventoryVoiceConfirmed)) && { opacity: 0.6 },
                ]}>
                <Text style={styles.modalSubmitBtnText}>
                  {recordSaleLoading ? t('common_saving') : saleType === 'WASTAGE' ? t('dc_saveWastage') : saleType === 'PURCHASE' ? t('dc_savePurchase') : t('dc_saveTransaction')}
                </Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Edit Stock / Restock Low-Stock Product */}
        <Modal visible={showEditStockModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>✏️ {t('inv_updateStock')}</Text>
                <Pressable onPress={() => setShowEditStockModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {editStockProduct && (
                <>
                  <Text style={styles.fieldLabel}>{t('inv_product')}</Text>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.navy, marginBottom: 10 }}>
                    {editStockProduct.name} <Text style={{ fontSize: 12, fontWeight: '400', color: colors.muted }}>
                      ({t('inv_current')} {editStockProduct.stockQty} {editStockProduct.unit})
                    </Text>
                  </Text>

                  <Text style={styles.fieldLabel}>{t('inv_quantityToAdd', { unit: editStockProduct.unit })}</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholder="e.g. 20"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={editStockAddQty}
                    onChangeText={setEditStockAddQty}
                    autoFocus
                  />

                  <Pressable
                    onPress={handleSaveEditStock}
                    disabled={editStockLoading}
                    style={[styles.modalSubmitBtn, editStockLoading && { opacity: 0.6 }]}>
                    <Text style={styles.modalSubmitBtnText}>{editStockLoading ? t('common_updating') : t('inv_updateStock')}</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* Floating AI Assistant Button */}
        <Pressable
          onPress={handleOpenChat}
          style={[styles.chatFab, { bottom: Math.max(insets.bottom + 20, 24) }]}>
          <Text style={styles.chatFabIcon}>💬</Text>
        </Pressable>

        {/* Modal: AI Assistant Chatbot */}
        <Modal visible={showChatModal} animationType="slide" transparent onRequestClose={() => setShowChatModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '80%', paddingHorizontal: 0 }]}>
              <View style={[styles.modalHeaderRow, { paddingHorizontal: 20 }]}>
                <Text style={styles.modalHeading}>🤖 AI Assistant</Text>
                <Pressable onPress={() => setShowChatModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView
                style={{ maxHeight: 380 }}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
                showsVerticalScrollIndicator={false}>
                {chatMessages.map((msg, idx) => (
                  <View
                    key={idx}
                    style={[
                      styles.chatBubble,
                      msg.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleBot,
                    ]}>
                    <Text style={msg.role === 'user' ? styles.chatBubbleUserText : styles.chatBubbleBotText}>
                      {msg.text}
                    </Text>
                  </View>
                ))}
                {(chatLoading || chatVoiceProcessing) && (
                  <View style={[styles.chatBubble, styles.chatBubbleBot]}>
                    <Text style={styles.chatBubbleBotText}>
                      {chatVoiceProcessing ? t('drv_voiceProcessing') : 'Thinking...'}
                    </Text>
                  </View>
                )}
              </ScrollView>
              {voiceRecorderState.isRecording && (
                <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'center', paddingBottom: 6 }}>
                  {t('drv_voiceListeningHint')}
                </Text>
              )}
              <View style={styles.chatInputRow}>
                <TextInput
                  placeholder="Ask about your collection, sales, stock..."
                  placeholderTextColor={colors.muted}
                  style={styles.chatInput}
                  value={chatInput}
                  onChangeText={setChatInput}
                  onSubmitEditing={handleSendChatMessage}
                  editable={!chatLoading && !chatVoiceProcessing}
                  returnKeyType="send"
                />
                <Pressable
                  onPress={voiceRecorderState.isRecording ? handleStopChatVoiceRecording : handleStartChatVoiceRecording}
                  disabled={chatLoading || chatVoiceProcessing}
                  style={[
                    styles.chatSendBtn,
                    { backgroundColor: voiceRecorderState.isRecording ? colors.red : colors.brand, marginRight: 8 },
                    (chatLoading || chatVoiceProcessing) && { opacity: 0.5 },
                  ]}>
                  <Text style={styles.chatSendBtnText}>{voiceRecorderState.isRecording ? '■' : '🎤'}</Text>
                </Pressable>
                <Pressable
                  onPress={handleSendChatMessage}
                  disabled={chatLoading || chatVoiceProcessing || !chatInput.trim()}
                  style={[styles.chatSendBtn, (chatLoading || chatVoiceProcessing || !chatInput.trim()) && { opacity: 0.5 }]}>
                  <Text style={styles.chatSendBtnText}>➤</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Modal: Set up PIN login (offered once after a full email+DOB login) */}
        <Modal visible={showSetupPinModal} animationType="fade" transparent onRequestClose={handleSkipSetupPin}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🔐 {t('pin_setupTitle')}</Text>
                <Pressable onPress={handleSkipSetupPin}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 14 }}>
                {setupPinStep === 'enter' ? t('pin_setupHint') : t('pin_setupConfirmHint')}
              </Text>
              <TextInput
                autoFocus
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                placeholder="••••"
                placeholderTextColor={colors.muted}
                style={[styles.modalInput, { textAlign: 'center', fontSize: 24, letterSpacing: 10 }]}
                value={setupPinStep === 'enter' ? setupPinValue : setupPinConfirmValue}
                onChangeText={(v) => {
                  const digits = v.replace(/[^0-9]/g, '');
                  if (setupPinStep === 'enter') setSetupPinValue(digits);
                  else setSetupPinConfirmValue(digits);
                  setSetupPinError('');
                }}
                onSubmitEditing={handleSaveSetupPin}
              />
              {!!setupPinError && (
                <Text style={{ fontSize: 12, color: colors.red, marginTop: 8 }}>⚠️ {setupPinError}</Text>
              )}
              <Pressable
                onPress={handleSaveSetupPin}
                disabled={setupPinSaving || (setupPinStep === 'enter' ? setupPinValue.length < 4 : setupPinConfirmValue.length < 4)}
                style={[
                  styles.modalSubmitBtn, { marginTop: 16 },
                  (setupPinSaving || (setupPinStep === 'enter' ? setupPinValue.length < 4 : setupPinConfirmValue.length < 4)) && { opacity: 0.5 },
                ]}>
                <Text style={styles.modalSubmitBtnText}>
                  {setupPinSaving ? t('common_saving') : setupPinStep === 'enter' ? t('common_next') : t('pin_setupSave')}
                </Text>
              </Pressable>
              <Pressable onPress={handleSkipSetupPin} style={{ marginTop: 12, alignItems: 'center' }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: colors.muted }}>{t('pin_setupSkip')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Language Picker */}
        <Modal visible={showLanguageModal} animationType="fade" transparent onRequestClose={() => setShowLanguageModal(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowLanguageModal(false)}>
            <View style={[styles.modalContent, { paddingBottom: 20 }]}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🌐 {t('header_language')}</Text>
                <Pressable onPress={() => setShowLanguageModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {(Object.keys(LANGUAGE_LABELS) as Language[]).map(lang => (
                <Pressable
                  key={lang}
                  onPress={() => handleSelectLanguage(lang)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingVertical: 14,
                    paddingHorizontal: 4,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}>
                  <Text style={{ fontSize: 15, fontWeight: language === lang ? '800' : '500', color: language === lang ? colors.brand : colors.navy }}>
                    {LANGUAGE_LABELS[lang]}
                  </Text>
                  {language === lang && <Text style={{ fontSize: 16, color: colors.brand }}>✓</Text>}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>

        {/* Modal: Building Setup Form (Building Maintenance) */}
        <Modal visible={showBuildingFormModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '85%' }]}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🏢 {myBuilding ? t('bld_editBuilding') : t('bld_createBuilding')}</Text>
                <Pressable onPress={() => setShowBuildingFormModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.fieldLabel}>{t('bld_buildingName')}</Text>
                <TextInput
                  placeholder={t('bld_buildingNamePh')}
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                  value={bldName}
                  onChangeText={setBldName}
                />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_buildingCode')}</Text>
                    <TextInput
                      placeholder={t('bld_buildingCodePh')}
                      placeholderTextColor={colors.muted}
                      style={styles.modalInput}
                      value={bldCode}
                      onChangeText={setBldCode}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_buildingType')}</Text>
                    <View style={styles.modePillRow}>
                      {(['Residential', 'Commercial', 'Mixed'] as const).map(bt => (
                        <Pressable
                          key={bt}
                          onPress={() => setBldBuildingType(bt)}
                          style={[styles.modePill, bldBuildingType === bt && styles.modePillActive]}>
                          <Text style={[styles.modePillText, bldBuildingType === bt && styles.modePillTextActive]}>{bt}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </View>

                <Text style={styles.fieldLabel}>{t('bld_address')}</Text>
                <TextInput
                  placeholder={t('bld_addressPh')}
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                  value={bldAddress}
                  onChangeText={setBldAddress}
                />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_area')}</Text>
                    <TextInput style={styles.modalInput} value={bldArea} onChangeText={setBldArea} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_city')}</Text>
                    <TextInput style={styles.modalInput} value={bldCity} onChangeText={setBldCity} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_state')}</Text>
                    <TextInput style={styles.modalInput} value={bldState} onChangeText={setBldState} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_pincode')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={bldPincode} onChangeText={setBldPincode} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_numFloors')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={bldNumFloors} onChangeText={setBldNumFloors} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_numFlats')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={bldNumFlats} onChangeText={setBldNumFlats} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_constructionYear')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={bldConstructionYear} onChangeText={setBldConstructionYear} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_contactNumber')}</Text>
                    <TextInput keyboardType="phone-pad" style={styles.modalInput} value={bldContactNumber} onChangeText={setBldContactNumber} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>{t('bld_emergencyContact')}</Text>
                <TextInput keyboardType="phone-pad" style={styles.modalInput} value={bldEmergencyContact} onChangeText={setBldEmergencyContact} placeholderTextColor={colors.muted} />

                <Text style={styles.fieldLabel}>{t('bld_description')}</Text>
                <TextInput style={styles.modalInput} value={bldDescription} onChangeText={setBldDescription} placeholderTextColor={colors.muted} />

                <Text style={styles.fieldLabel}>{t('bld_notes')}</Text>
                <TextInput style={styles.modalInput} value={bldNotes} onChangeText={setBldNotes} placeholderTextColor={colors.muted} />

                <Pressable
                  onPress={handleSaveBuilding}
                  disabled={bldSaving}
                  style={[styles.modalSubmitBtn, bldSaving && { opacity: 0.6 }, { marginBottom: 20 }]}>
                  <Text style={styles.modalSubmitBtnText}>{bldSaving ? t('common_saving') : t('bld_saveBuilding')}</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Add Floor (Building Maintenance) */}
        <Modal visible={showFloorModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🏗️ {t('bld_addFloor')}</Text>
                <Pressable onPress={() => setShowFloorModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>{t('bld_floorNumber')}</Text>
              <TextInput
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={floorNumber}
                onChangeText={setFloorNumber}
              />

              <Text style={styles.fieldLabel}>{t('bld_floorName')}</Text>
              <TextInput
                placeholder={t('bld_floorNamePh')}
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={floorName}
                onChangeText={setFloorName}
              />

              <Text style={styles.fieldLabel}>{t('bld_numFlats')}</Text>
              <TextInput
                keyboardType="numeric"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={floorNumFlats}
                onChangeText={setFloorNumFlats}
              />

              <Pressable
                onPress={handleSaveFloor}
                disabled={floorSaving}
                style={[styles.modalSubmitBtn, floorSaving && { opacity: 0.6 }]}>
                <Text style={styles.modalSubmitBtnText}>{floorSaving ? t('common_saving') : t('common_save')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Add/Edit Flat (Building Maintenance) */}
        <Modal visible={showFlatModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '85%' }]}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🚪 {editingFlat ? t('common_edit') : t('bld_addFlat')}</Text>
                <Pressable onPress={() => setShowFlatModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_flatNumber')}</Text>
                    <TextInput
                      placeholder={t('bld_flatNumberPh')}
                      placeholderTextColor={colors.muted}
                      style={styles.modalInput}
                      value={flatNumber}
                      onChangeText={setFlatNumber}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_flatType')}</Text>
                    <TextInput
                      placeholder={t('bld_flatTypePh')}
                      placeholderTextColor={colors.muted}
                      style={styles.modalInput}
                      value={flatType}
                      onChangeText={setFlatType}
                    />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>{t('bld_floor')}</Text>
                <Pressable
                  onPress={() => setShowFlatFloorPicker(prev => !prev)}
                  style={[styles.modalInput, { justifyContent: 'center' }]}>
                  <Text style={{ color: flatFloorId ? colors.navy : colors.muted }}>
                    {buildingFloors.find(f => f.id === flatFloorId)?.floorName || buildingFloors.find(f => f.id === flatFloorId)?.floorNumber || t('bld_selectFloor')}
                  </Text>
                </Pressable>
                {showFlatFloorPicker && (
                  <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: -6, marginBottom: 10, overflow: 'hidden' }}>
                    {buildingFloors.map(f => (
                      <Pressable
                        key={f.id}
                        onPress={() => { setFlatFloorId(f.id); setShowFlatFloorPicker(false); }}
                        style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: f.id === flatFloorId ? '#EEF2FF' : '#fff' }}>
                        <Text style={{ color: colors.navy }}>{f.floorName || `Floor ${f.floorNumber}`}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                <Text style={styles.fieldLabel}>{t('bld_occupancyStatus')}</Text>
                <View style={styles.modePillRow}>
                  {(['Vacant', 'Occupied', 'Rented', 'Under Maintenance'] as const).map(st => (
                    <Pressable
                      key={st}
                      onPress={() => setFlatOccupancyStatus(st)}
                      style={[styles.modePill, flatOccupancyStatus === st && styles.modePillActive]}>
                      <Text style={[styles.modePillText, flatOccupancyStatus === st && styles.modePillTextActive]} numberOfLines={1}>{st}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_ownerName')}</Text>
                    <TextInput style={styles.modalInput} value={flatOwnerName} onChangeText={setFlatOwnerName} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_tenantName')}</Text>
                    <TextInput style={styles.modalInput} value={flatTenantName} onChangeText={setFlatTenantName} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>{t('bld_primaryMobile')}</Text>
                <TextInput keyboardType="phone-pad" style={styles.modalInput} value={flatPrimaryMobile} onChangeText={setFlatPrimaryMobile} placeholderTextColor={colors.muted} />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_parkingSlot')}</Text>
                    <TextInput style={styles.modalInput} value={flatParkingSlot} onChangeText={setFlatParkingSlot} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_maintenanceAmount')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={flatMaintenanceAmount} onChangeText={setFlatMaintenanceAmount} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <Pressable
                  onPress={handleSaveFlat}
                  disabled={flatSaving}
                  style={[styles.modalSubmitBtn, flatSaving && { opacity: 0.6 }, { marginBottom: 20 }]}>
                  <Text style={styles.modalSubmitBtnText}>{flatSaving ? t('common_saving') : t('bld_saveFlat')}</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Add/Edit Building Member (Building Maintenance) */}
        <Modal visible={showMemberModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '85%' }]}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>👤 {editingMember ? t('common_edit') : t('bld_addMember')}</Text>
                <Pressable onPress={() => setShowMemberModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.fieldLabel}>{t('bld_fullName')}</Text>
                <TextInput
                  placeholder={t('bld_fullNamePh')}
                  placeholderTextColor={colors.muted}
                  style={styles.modalInput}
                  value={memberFullName}
                  onChangeText={setMemberFullName}
                />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_mobileNumber')}</Text>
                    <TextInput keyboardType="phone-pad" style={styles.modalInput} value={memberMobileNumber} onChangeText={setMemberMobileNumber} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_email')}</Text>
                    <TextInput keyboardType="email-address" autoCapitalize="none" style={styles.modalInput} value={memberEmail} onChangeText={setMemberEmail} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>{t('bld_memberType')}</Text>
                <View style={styles.modePillRow}>
                  {(['Owner', 'Tenant', 'Family Member', 'Other'] as const).map(mt => (
                    <Pressable
                      key={mt}
                      onPress={() => setMemberType(mt)}
                      style={[styles.modePill, memberType === mt && styles.modePillActive]}>
                      <Text style={[styles.modePillText, memberType === mt && styles.modePillTextActive]} numberOfLines={1}>{mt}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>{t('bld_navFlats')}</Text>
                <Pressable
                  onPress={() => setShowMemberFlatPicker(prev => !prev)}
                  style={[styles.modalInput, { justifyContent: 'center' }]}>
                  <Text style={{ color: memberFlatId ? colors.navy : colors.muted }}>
                    {buildingFlats.find(f => f.id === memberFlatId)?.flatNumber || t('bld_selectFloor')}
                  </Text>
                </Pressable>
                {showMemberFlatPicker && (
                  <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: -6, marginBottom: 10, overflow: 'hidden' }}>
                    {buildingFlats.map(f => (
                      <Pressable
                        key={f.id}
                        onPress={() => { setMemberFlatId(f.id); setShowMemberFlatPicker(false); }}
                        style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: f.id === memberFlatId ? '#EEF2FF' : '#fff' }}>
                        <Text style={{ color: colors.navy }}>{f.flatNumber}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                <Text style={styles.fieldLabel}>{t('bld_emergencyContact')}</Text>
                <TextInput keyboardType="phone-pad" style={styles.modalInput} value={memberEmergencyContact} onChangeText={setMemberEmergencyContact} placeholderTextColor={colors.muted} />

                <Text style={styles.fieldLabel}>{t('bld_vehicleNumber')}</Text>
                <TextInput style={styles.modalInput} value={memberVehicleNumber} onChangeText={setMemberVehicleNumber} placeholderTextColor={colors.muted} />

                <Pressable
                  onPress={handleSaveMember}
                  disabled={memberSaving}
                  style={[styles.modalSubmitBtn, memberSaving && { opacity: 0.6 }, { marginBottom: 20 }]}>
                  <Text style={styles.modalSubmitBtnText}>{memberSaving ? t('common_saving') : t('bld_saveMember')}</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Member Passbook (Building Maintenance) */}
        <Modal visible={showMemberPassbookModal} animationType="slide" transparent onRequestClose={() => setShowMemberPassbookModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '90%' }]}>
              <View style={styles.modalHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.modalHeading, { fontSize: 18 }]}>
                    {passbookMember?.fullName || t('bld_memberPassbook')}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                    {passbookMember?.mobileNumber || '—'}{passbookMember?.flatNumber ? ` • Flat ${passbookMember.flatNumber}` : ''}
                  </Text>
                </View>
                <Pressable onPress={() => setShowMemberPassbookModal(false)} style={{ padding: 6 }}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false}>
                {!passbookMember?.flatId ? (
                  <Text style={[styles.emptyStateText, { marginTop: 20 }]}>{t('bld_noFlatAssigned')}</Text>
                ) : memberPassbookLoading ? (
                  <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                    <Text style={{ color: colors.muted, fontSize: 13 }}>{t('common_loading')}</Text>
                  </View>
                ) : (() => {
                  const totalBilled = memberPassbookBills.reduce((sum: number, b: any) => sum + (b.totalAmount || 0), 0);
                  const totalPaid = memberPassbookBills.reduce((sum: number, b: any) => sum + (b.paidAmount || 0), 0);
                  const totalPending = memberPassbookBills.reduce((sum: number, b: any) => sum + (b.balanceAmount || 0), 0);

                  const monthLabel = (iso?: string) => {
                    if (!iso) return '';
                    const d = new Date(`${iso}T00:00:00`);
                    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                  };

                  const entries = memberPassbookBills
                    .filter((b: any) => b.status === 'Paid' || b.status === 'Overdue')
                    .sort((a: any, b: any) => String(b.dueDate || '').localeCompare(String(a.dueDate || '')));

                  return (
                    <>
                      <View style={{ flexDirection: 'row', gap: 10, marginVertical: 10 }}>
                        <View style={{ flex: 1, backgroundColor: colors.brandBg, borderRadius: 10, padding: 10 }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.brand }}>{t('bld_totalBilled')}</Text>
                          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.brand, marginTop: 2 }}>₹{totalBilled.toLocaleString()}</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: colors.greenBg, borderRadius: 10, padding: 10 }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.greenDark }}>{t('bld_totalCollected')}</Text>
                          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.greenDark, marginTop: 2 }}>₹{totalPaid.toLocaleString()}</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: colors.redBg, borderRadius: 10, padding: 10 }}>
                          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.red }}>{t('bld_totalPending')}</Text>
                          <Text style={{ fontSize: 15, fontWeight: '800', color: colors.red, marginTop: 2 }}>₹{totalPending.toLocaleString()}</Text>
                        </View>
                      </View>

                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.navy, marginTop: 10, marginBottom: 8 }}>
                        📜 {t('bld_transactionHistory')}
                      </Text>

                      {entries.length === 0 ? (
                        <Text style={styles.emptyStateText}>{t('bld_noTransactionsYet')}</Text>
                      ) : (
                        entries.map((bill: any) => {
                          const isPaid = bill.status === 'Paid';
                          const statusColor = isPaid ? colors.green : colors.red;
                          return (
                            <View
                              key={bill.id}
                              style={{
                                backgroundColor: '#FFFFFF', borderLeftWidth: 4, borderLeftColor: statusColor,
                                borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border,
                                borderRadius: 8, padding: 10, marginBottom: 8,
                              }}>
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  <View style={{ backgroundColor: statusColor + '1A', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                                    <Text style={{ fontSize: 11, fontWeight: '800', color: statusColor }}>
                                      {isPaid ? `✓ ${t('trv_paid')}` : `⚠ ${t('bld_overdue')}`}
                                    </Text>
                                  </View>
                                  <Text style={{ fontSize: 12, color: colors.slate, fontWeight: '600' }}>{monthLabel(bill.billingMonth)}</Text>
                                </View>
                                <Text style={{ fontSize: 15, fontWeight: '800', color: statusColor }}>
                                  {isPaid ? '+' : '−'} ₹{Number(isPaid ? bill.paidAmount : bill.balanceAmount).toLocaleString()}
                                </Text>
                              </View>
                              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>
                                {t('bld_maintenanceBill')} • {t('bld_due')} {bill.dueDate}
                              </Text>
                            </View>
                          );
                        })
                      )}
                    </>
                  );
                })()}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Bill Month Filter Picker (Building Maintenance) */}
        <Modal visible={showBillMonthPicker} animationType="fade" transparent onRequestClose={() => setShowBillMonthPicker(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowBillMonthPicker(false)}>
            <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>📅 {t('bld_billMonthFilter')}</Text>
                <Pressable onPress={() => setShowBillMonthPicker(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {renderMonthYearPicker(
                billMonthPickerYear,
                billMonthFilter,
                (delta) => setBillMonthPickerYear(y => y + delta),
                (yyyyMM) => {
                  setBillMonthFilter(yyyyMM === billMonthFilter ? '' : yyyyMM);
                  setShowBillMonthPicker(false);
                }
              )}
              {!!billMonthFilter && (
                <Pressable
                  onPress={() => { setBillMonthFilter(''); setShowBillMonthPicker(false); }}
                  style={{ marginTop: 6, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: colors.brandBg }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand }}>{t('trv_clearDateFilter')}</Text>
                </Pressable>
              )}
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Payment Flat Filter Dropdown (Building Maintenance) */}
        <Modal visible={showPaymentFlatDropdown} animationType="slide" transparent onRequestClose={() => setShowPaymentFlatDropdown(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowPaymentFlatDropdown(false)}>
            <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>{t('bld_allFlats')}</Text>
                <Pressable onPress={() => setShowPaymentFlatDropdown(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.dropdownList}>
                {[{ id: '', flatNumber: t('bld_allFlats') }, ...buildingFlats].map((f) => (
                  <Pressable
                    key={f.id || 'all'}
                    onPress={() => { setPaymentFlatFilter(f.id); setShowPaymentFlatDropdown(false); }}
                    style={[styles.dropdownOption, paymentFlatFilter === f.id && styles.dropdownOptionActive]}>
                    <Text style={[styles.dropdownOptionText, paymentFlatFilter === f.id && styles.dropdownOptionTextActive]}>
                      {f.flatNumber}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Payment Method Filter Dropdown (Building Maintenance) */}
        <Modal visible={showPaymentMethodDropdown} animationType="slide" transparent onRequestClose={() => setShowPaymentMethodDropdown(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowPaymentMethodDropdown(false)}>
            <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>{t('bld_allMethods')}</Text>
                <Pressable onPress={() => setShowPaymentMethodDropdown(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.dropdownList}>
                {[
                  { key: '', label: t('bld_allMethods') },
                  { key: 'Cash', label: 'Cash' },
                  { key: 'UPI', label: 'UPI' },
                  { key: 'Bank Transfer', label: 'Bank Transfer' },
                  { key: 'Card', label: 'Card' },
                ].map((opt) => (
                  <Pressable
                    key={opt.key || 'all'}
                    onPress={() => { setPaymentMethodFilter(opt.key); setShowPaymentMethodDropdown(false); }}
                    style={[styles.dropdownOption, paymentMethodFilter === opt.key && styles.dropdownOptionActive]}>
                    <Text style={[styles.dropdownOptionText, paymentMethodFilter === opt.key && styles.dropdownOptionTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Complaint Status Filter Dropdown (Building Maintenance) */}
        <Modal visible={showComplaintStatusDropdown} animationType="slide" transparent onRequestClose={() => setShowComplaintStatusDropdown(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowComplaintStatusDropdown(false)}>
            <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>{t('bld_allStatus')}</Text>
                <Pressable onPress={() => setShowComplaintStatusDropdown(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.dropdownList}>
                {[
                  { key: '', label: t('bld_allStatus') },
                  { key: 'New', label: 'New' },
                  { key: 'Assigned', label: 'Assigned' },
                  { key: 'In Progress', label: 'In Progress' },
                  { key: 'Resolved', label: 'Resolved' },
                  { key: 'Closed', label: 'Closed' },
                  { key: 'Rejected', label: 'Rejected' },
                ].map((opt) => (
                  <Pressable
                    key={opt.key || 'all'}
                    onPress={() => { setComplaintStatusFilter(opt.key); setShowComplaintStatusDropdown(false); }}
                    style={[styles.dropdownOption, complaintStatusFilter === opt.key && styles.dropdownOptionActive]}>
                    <Text style={[styles.dropdownOptionText, complaintStatusFilter === opt.key && styles.dropdownOptionTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Complaint Category Dropdown (Building Maintenance) */}
        <Modal visible={showComplaintCategoryDropdown} animationType="slide" transparent onRequestClose={() => setShowComplaintCategoryDropdown(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowComplaintCategoryDropdown(false)}>
            <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>{t('bld_complaintCategory')}</Text>
                <Pressable onPress={() => setShowComplaintCategoryDropdown(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.dropdownList}>
                {(['Plumbing', 'Electrical', 'Water', 'Lift', 'Cleaning', 'Security', 'Parking', 'Common Area', 'Generator', 'CCTV', 'Other'] as const).map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => { setComplaintCategory(c); setShowComplaintCategoryDropdown(false); }}
                    style={[styles.dropdownOption, complaintCategory === c && styles.dropdownOptionActive]}>
                    <Text style={[styles.dropdownOptionText, complaintCategory === c && styles.dropdownOptionTextActive]}>
                      {c}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Staff Job Type Dropdown (Building Maintenance) */}
        <Modal visible={showStaffJobTypeDropdown} animationType="slide" transparent onRequestClose={() => setShowStaffJobTypeDropdown(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowStaffJobTypeDropdown(false)}>
            <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>{t('bld_jobType')}</Text>
                <Pressable onPress={() => setShowStaffJobTypeDropdown(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.dropdownList}>
                {(['Security Guard', 'Cleaner', 'Electrician', 'Plumber', 'Maintenance Worker', 'Gardener', 'Other'] as const).map((jt) => (
                  <Pressable
                    key={jt}
                    onPress={() => { setStaffJobType(jt); setShowStaffJobTypeDropdown(false); }}
                    style={[styles.dropdownOption, staffJobType === jt && styles.dropdownOptionActive]}>
                    <Text style={[styles.dropdownOptionText, staffJobType === jt && styles.dropdownOptionTextActive]}>
                      {jt}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Vendor Service Type Dropdown (Building Maintenance) */}
        <Modal visible={showVendorServiceTypeDropdown} animationType="slide" transparent onRequestClose={() => setShowVendorServiceTypeDropdown(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowVendorServiceTypeDropdown(false)}>
            <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>{t('bld_serviceType')}</Text>
                <Pressable onPress={() => setShowVendorServiceTypeDropdown(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.dropdownList}>
                {(['Electrician', 'Plumber', 'Lift Service', 'Pest Control', 'CCTV Vendor', 'Cleaning Vendor', 'Generator Service', 'Fire Safety Vendor', 'Other'] as const).map((st) => (
                  <Pressable
                    key={st}
                    onPress={() => { setVendorServiceType(st); setShowVendorServiceTypeDropdown(false); }}
                    style={[styles.dropdownOption, vendorServiceType === st && styles.dropdownOptionActive]}>
                    <Text style={[styles.dropdownOptionText, vendorServiceType === st && styles.dropdownOptionTextActive]}>
                      {st}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Modal: Maintenance Charges Config (Building Maintenance) */}
        <Modal visible={showConfigModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '85%' }]}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>⚙️ {t('bld_configHeading')}</Text>
                <Pressable onPress={() => setShowConfigModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>{t('bld_configDesc')}</Text>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_waterCharges')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={cfgWater} onChangeText={setCfgWater} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_parkingCharges')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={cfgParking} onChangeText={setCfgParking} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_commonElectricity')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={cfgElectricity} onChangeText={setCfgElectricity} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_securityCharges')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={cfgSecurity} onChangeText={setCfgSecurity} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_cleaningCharges')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={cfgCleaning} onChangeText={setCfgCleaning} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_liftCharges')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={cfgLift} onChangeText={setCfgLift} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_otherCharges')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={cfgOther} onChangeText={setCfgOther} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_latePaymentCharges')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={cfgLateFee} onChangeText={setCfgLateFee} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_discount')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={cfgDiscount} onChangeText={setCfgDiscount} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_dueDayOfMonth')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={cfgDueDay} onChangeText={setCfgDueDay} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <Pressable
                  onPress={handleSaveConfig}
                  disabled={cfgSaving}
                  style={[styles.modalSubmitBtn, cfgSaving && { opacity: 0.6 }, { marginBottom: 20 }]}>
                  <Text style={styles.modalSubmitBtnText}>{cfgSaving ? t('common_saving') : t('bld_saveConfig')}</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Generate Monthly Bills (Building Maintenance) */}
        <Modal visible={showGenerateBillsModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🧾 {t('bld_generateBillsTitle')}</Text>
                <Pressable onPress={() => setShowGenerateBillsModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              <Text style={styles.fieldLabel}>{t('bld_billingMonth')}</Text>
              <TextInput
                placeholder="2026-10"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={genBillingMonth}
                onChangeText={setGenBillingMonth}
              />

              <Text style={styles.fieldLabel}>{t('bld_targetFlats')}</Text>
              <View style={styles.modePillRow}>
                {([
                  { key: 'entire' as const, label: t('bld_entireBuilding') },
                  { key: 'specific' as const, label: t('bld_specificFlats') },
                ]).map(opt => (
                  <Pressable
                    key={opt.key}
                    onPress={() => setGenTargetMode(opt.key)}
                    style={[styles.modePill, genTargetMode === opt.key && styles.modePillActive]}>
                    <Text style={[styles.modePillText, genTargetMode === opt.key && styles.modePillTextActive]}>{opt.label}</Text>
                  </Pressable>
                ))}
              </View>

              {genTargetMode === 'specific' && (
                <ScrollView style={{ maxHeight: 220, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginBottom: 12 }}>
                  {buildingFlats.map(f => {
                    const selected = genSelectedFlatIds.includes(f.id);
                    return (
                      <Pressable
                        key={f.id}
                        onPress={() => setGenSelectedFlatIds(prev => selected ? prev.filter(id => id !== f.id) : [...prev, f.id])}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: selected ? '#EEF2FF' : '#fff' }}>
                        <Text style={{ color: colors.navy }}>{f.flatNumber}</Text>
                        {selected && <Text style={{ color: colors.brand, fontWeight: '700' }}>✓</Text>}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}

              <Pressable
                onPress={handleGenerateBills}
                disabled={genSaving}
                style={[styles.modalSubmitBtn, genSaving && { opacity: 0.6 }]}>
                <Text style={styles.modalSubmitBtnText}>{genSaving ? t('common_saving') : t('bld_generate')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* Modal: Record Maintenance Payment (Building Maintenance) */}
        <Modal visible={showRecordPaymentModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>💵 {t('bld_recordPayment')}</Text>
                <Pressable onPress={() => setShowRecordPaymentModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>

              {payingBill && (
                <>
                  <Text style={[styles.complianceDesc, { marginBottom: 10 }]}>
                    {t('bld_flatNumber')}: <Text style={styles.boldText}>{payingBill.flatNumber}</Text> • {t('bld_balanceAmount')}: <Text style={styles.boldText}>₹{payingBill.balanceAmount.toLocaleString()}</Text>
                  </Text>

                  <Text style={styles.fieldLabel}>{t('bld_amount')}</Text>
                  <TextInput
                    keyboardType="numeric"
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={payAmount}
                    onChangeText={setPayAmount}
                  />

                  <Text style={styles.fieldLabel}>{t('bld_paymentDate')}</Text>
                  <TextInput
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={payDate}
                    onChangeText={setPayDate}
                  />

                  <Text style={styles.fieldLabel}>{t('bld_paymentMethod')}</Text>
                  <View style={styles.modePillRow}>
                    {(['Cash', 'UPI', 'Bank Transfer', 'Card', 'Other'] as const).map(pm => (
                      <Pressable
                        key={pm}
                        onPress={() => setPayMethod(pm)}
                        style={[styles.modePill, payMethod === pm && styles.modePillActive]}>
                        <Text style={[styles.modePillText, payMethod === pm && styles.modePillTextActive]} numberOfLines={1}>{pm}</Text>
                      </Pressable>
                    ))}
                  </View>

                  {(payMethod === 'UPI' || payMethod === 'Bank Transfer' || payMethod === 'Card') && (
                    <>
                      <Text style={styles.fieldLabel}>{t('bld_transactionRef')}</Text>
                      <TextInput
                        placeholderTextColor={colors.muted}
                        style={styles.modalInput}
                        value={payTransactionRef}
                        onChangeText={setPayTransactionRef}
                      />
                    </>
                  )}

                  <Text style={styles.fieldLabel}>{t('common_note')}</Text>
                  <TextInput
                    placeholderTextColor={colors.muted}
                    style={styles.modalInput}
                    value={payNotes}
                    onChangeText={setPayNotes}
                  />

                  <Pressable
                    onPress={handleSavePayment}
                    disabled={paySaving}
                    style={[styles.modalSubmitBtn, paySaving && { opacity: 0.6 }]}>
                    <Text style={styles.modalSubmitBtnText}>{paySaving ? t('common_saving') : t('bld_savePayment')}</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* Modal: Payment Receipt (Building Maintenance) */}
        <Modal visible={showReceiptModal} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🧾 {t('bld_receiptTitle')}</Text>
                <Pressable onPress={() => setShowReceiptModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              {activeReceipt && (
                <View>
                  <Text style={{ fontSize: 16, fontWeight: '800', color: colors.navy, textAlign: 'center', marginBottom: 2 }}>{activeReceipt.buildingName}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted, textAlign: 'center', marginBottom: 14 }}>{activeReceipt.buildingAddress}</Text>

                  <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 10, marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={styles.complianceDesc}>{t('bld_receiptFrom')}</Text>
                      <Text style={styles.boldText}>{activeReceipt.memberName || activeReceipt.flatNumber}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={styles.complianceDesc}>{t('bld_receiptFlat')}</Text>
                      <Text style={styles.boldText}>{activeReceipt.flatNumber}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={styles.complianceDesc}>{t('bld_receiptMonth')}</Text>
                      <Text style={styles.boldText}>{activeReceipt.billingMonth?.slice(0, 7)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={styles.complianceDesc}>{t('bld_paymentMethod')}</Text>
                      <Text style={styles.boldText}>{activeReceipt.paymentMethod}{activeReceipt.transactionReference ? ` (${activeReceipt.transactionReference})` : ''}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.complianceDesc}>{activeReceipt.paymentDate}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{activeReceipt.receiptNumber}</Text>
                    </View>
                  </View>

                  <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center' }}>{t('common_success')}</Text>
                  <Text style={{ fontSize: 28, fontWeight: '800', color: colors.greenDark, textAlign: 'center', marginVertical: 6 }}>₹{activeReceipt.amount.toLocaleString()}</Text>
                  {activeReceipt.balanceAfterPayment > 0 && (
                    <Text style={{ fontSize: 12, color: colors.red, textAlign: 'center', marginBottom: 10 }}>
                      {t('bld_receiptBalance')}: ₹{activeReceipt.balanceAfterPayment.toLocaleString()}
                    </Text>
                  )}

                  <Pressable onPress={() => setShowReceiptModal(false)} style={[styles.modalSubmitBtn, { marginTop: 10 }]}>
                    <Text style={styles.modalSubmitBtnText}>{t('common_close')}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        </Modal>

        {/* Modal: Add/Edit Staff (Building Maintenance) */}
        <Modal visible={showStaffModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '85%' }]}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🧑‍🔧 {editingStaff ? t('common_edit') : t('bld_addStaff')}</Text>
                <Pressable onPress={() => setShowStaffModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.fieldLabel}>{t('bld_fullName')}</Text>
                <TextInput placeholder={t('bld_fullNamePh')} placeholderTextColor={colors.muted} style={styles.modalInput} value={staffFullName} onChangeText={setStaffFullName} />

                <Text style={styles.fieldLabel}>{t('bld_jobType')}</Text>
                <Pressable onPress={() => setShowStaffJobTypeDropdown(true)} style={styles.selectBox}>
                  <Text style={styles.selectBoxText}>{staffJobType}</Text>
                  <Text style={styles.selectBoxChevron}>▾</Text>
                </Pressable>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_mobileNumber')}</Text>
                    <TextInput keyboardType="phone-pad" style={styles.modalInput} value={staffMobile} onChangeText={setStaffMobile} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_salary')}</Text>
                    <TextInput keyboardType="numeric" style={styles.modalInput} value={staffSalary} onChangeText={setStaffSalary} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>{t('bld_joiningDate')}</Text>
                <TextInput style={styles.modalInput} value={staffJoiningDate} onChangeText={setStaffJoiningDate} placeholderTextColor={colors.muted} />

                <Text style={styles.fieldLabel}>{t('bld_address')}</Text>
                <TextInput style={styles.modalInput} value={staffAddress} onChangeText={setStaffAddress} placeholderTextColor={colors.muted} />

                <Text style={styles.fieldLabel}>{t('bld_emergencyContact')}</Text>
                <TextInput keyboardType="phone-pad" style={styles.modalInput} value={staffEmergencyContact} onChangeText={setStaffEmergencyContact} placeholderTextColor={colors.muted} />

                <Text style={styles.fieldLabel}>{t('bld_notes')}</Text>
                <TextInput style={styles.modalInput} value={staffNotes} onChangeText={setStaffNotes} placeholderTextColor={colors.muted} />

                <Pressable
                  onPress={handleSaveStaff}
                  disabled={staffSaving}
                  style={[styles.modalSubmitBtn, staffSaving && { opacity: 0.6 }, { marginBottom: 20 }]}>
                  <Text style={styles.modalSubmitBtnText}>{staffSaving ? t('common_saving') : t('bld_saveStaff')}</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Add/Edit Vendor (Building Maintenance) */}
        <Modal visible={showVendorModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '85%' }]}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>🧰 {editingVendor ? t('common_edit') : t('bld_addVendor')}</Text>
                <Pressable onPress={() => setShowVendorModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.fieldLabel}>{t('bld_vendorName')}</Text>
                <TextInput style={styles.modalInput} value={vendorName} onChangeText={setVendorName} placeholderTextColor={colors.muted} />

                <Text style={styles.fieldLabel}>{t('bld_serviceType')}</Text>
                <Pressable onPress={() => setShowVendorServiceTypeDropdown(true)} style={styles.selectBox}>
                  <Text style={styles.selectBoxText}>{vendorServiceType}</Text>
                  <Text style={styles.selectBoxChevron}>▾</Text>
                </Pressable>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_contactPerson')}</Text>
                    <TextInput style={styles.modalInput} value={vendorContactPerson} onChangeText={setVendorContactPerson} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_mobileNumber')}</Text>
                    <TextInput keyboardType="phone-pad" style={styles.modalInput} value={vendorMobile} onChangeText={setVendorMobile} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>{t('bld_email')}</Text>
                <TextInput keyboardType="email-address" autoCapitalize="none" style={styles.modalInput} value={vendorEmail} onChangeText={setVendorEmail} placeholderTextColor={colors.muted} />

                <Text style={styles.fieldLabel}>{t('bld_address')}</Text>
                <TextInput style={styles.modalInput} value={vendorAddress} onChangeText={setVendorAddress} placeholderTextColor={colors.muted} />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_contractStart')}</Text>
                    <TextInput style={styles.modalInput} value={vendorContractStart} onChangeText={setVendorContractStart} placeholderTextColor={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>{t('bld_contractEnd')}</Text>
                    <TextInput style={styles.modalInput} value={vendorContractEnd} onChangeText={setVendorContractEnd} placeholderTextColor={colors.muted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>{t('bld_notes')}</Text>
                <TextInput style={styles.modalInput} value={vendorNotes} onChangeText={setVendorNotes} placeholderTextColor={colors.muted} />

                <Pressable
                  onPress={handleSaveVendor}
                  disabled={vendorSaving}
                  style={[styles.modalSubmitBtn, vendorSaving && { opacity: 0.6 }, { marginBottom: 20 }]}>
                  <Text style={styles.modalSubmitBtnText}>{vendorSaving ? t('common_saving') : t('bld_saveVendor')}</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Modal: Add/Edit Complaint (Building Maintenance) */}
        <Modal visible={showComplaintModal} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxHeight: '85%' }]}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalHeading}>📢 {editingComplaint ? t('bld_updateStatus') : t('bld_newComplaint')}</Text>
                <Pressable onPress={() => setShowComplaintModal(false)}>
                  <Text style={styles.modalCloseText}>✕</Text>
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.fieldLabel}>{t('bld_complaintTitle')}</Text>
                <TextInput placeholder={t('bld_complaintTitlePh')} placeholderTextColor={colors.muted} style={styles.modalInput} value={complaintTitle} onChangeText={setComplaintTitle} />

                <Text style={styles.fieldLabel}>{t('bld_complaintCategory')}</Text>
                <Pressable onPress={() => setShowComplaintCategoryDropdown(true)} style={styles.selectBox}>
                  <Text style={styles.selectBoxText}>{complaintCategory}</Text>
                  <Text style={styles.selectBoxChevron}>▾</Text>
                </Pressable>

                <Text style={styles.fieldLabel}>{t('bld_complaintDescription')}</Text>
                <TextInput style={styles.modalInput} value={complaintDescription} onChangeText={setComplaintDescription} placeholderTextColor={colors.muted} />

                <Text style={styles.fieldLabel}>{t('bld_complaintPriority')}</Text>
                <View style={styles.modePillRow}>
                  {(['Low', 'Medium', 'High', 'Urgent'] as const).map(p => (
                    <Pressable
                      key={p}
                      onPress={() => setComplaintPriority(p)}
                      style={[styles.modePill, complaintPriority === p && styles.modePillActive]}>
                      <Text style={[styles.modePillText, complaintPriority === p && styles.modePillTextActive]}>{p}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.fieldLabel}>{t('bld_assignStaff')}</Text>
                <Pressable
                  onPress={() => setShowComplaintStaffPicker(prev => !prev)}
                  style={[styles.modalInput, { justifyContent: 'center' }]}>
                  <Text style={{ color: complaintAssignedStaffId ? colors.navy : colors.muted }}>
                    {buildingStaffList.find(s => s.id === complaintAssignedStaffId)?.fullName || t('bld_none')}
                  </Text>
                </Pressable>
                {showComplaintStaffPicker && (
                  <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: -6, marginBottom: 10, overflow: 'hidden' }}>
                    <Pressable onPress={() => { setComplaintAssignedStaffId(''); setShowComplaintStaffPicker(false); }} style={{ paddingVertical: 10, paddingHorizontal: 12 }}>
                      <Text style={{ color: colors.muted }}>{t('bld_none')}</Text>
                    </Pressable>
                    {buildingStaffList.map(s => (
                      <Pressable
                        key={s.id}
                        onPress={() => { setComplaintAssignedStaffId(s.id); setShowComplaintStaffPicker(false); }}
                        style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: s.id === complaintAssignedStaffId ? '#EEF2FF' : '#fff' }}>
                        <Text style={{ color: colors.navy }}>{s.fullName} ({s.jobType})</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                <Text style={styles.fieldLabel}>{t('bld_assignVendor')}</Text>
                <Pressable
                  onPress={() => setShowComplaintVendorPicker(prev => !prev)}
                  style={[styles.modalInput, { justifyContent: 'center' }]}>
                  <Text style={{ color: complaintAssignedVendorId ? colors.navy : colors.muted }}>
                    {buildingVendorsList.find(v => v.id === complaintAssignedVendorId)?.vendorName || t('bld_none')}
                  </Text>
                </Pressable>
                {showComplaintVendorPicker && (
                  <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginTop: -6, marginBottom: 10, overflow: 'hidden' }}>
                    <Pressable onPress={() => { setComplaintAssignedVendorId(''); setShowComplaintVendorPicker(false); }} style={{ paddingVertical: 10, paddingHorizontal: 12 }}>
                      <Text style={{ color: colors.muted }}>{t('bld_none')}</Text>
                    </Pressable>
                    {buildingVendorsList.map(v => (
                      <Pressable
                        key={v.id}
                        onPress={() => { setComplaintAssignedVendorId(v.id); setShowComplaintVendorPicker(false); }}
                        style={{ paddingVertical: 10, paddingHorizontal: 12, backgroundColor: v.id === complaintAssignedVendorId ? '#EEF2FF' : '#fff' }}>
                        <Text style={{ color: colors.navy }}>{v.vendorName} ({v.serviceType})</Text>
                      </Pressable>
                    ))}
                  </View>
                )}

                {editingComplaint && (
                  <>
                    <Text style={styles.fieldLabel}>{t('bld_updateStatus')}</Text>
                    <View style={styles.modePillRow}>
                      {(['New', 'Assigned', 'In Progress', 'Resolved', 'Closed', 'Rejected'] as const).map(st => (
                        <Pressable
                          key={st}
                          onPress={() => setComplaintStatus(st)}
                          style={[styles.modePill, complaintStatus === st && styles.modePillActive]}>
                          <Text style={[styles.modePillText, complaintStatus === st && styles.modePillTextActive]} numberOfLines={1}>{st}</Text>
                        </Pressable>
                      ))}
                    </View>

                    <Text style={styles.fieldLabel}>{t('bld_resolutionNotes')}</Text>
                    <TextInput style={styles.modalInput} value={complaintResolutionNotes} onChangeText={setComplaintResolutionNotes} placeholderTextColor={colors.muted} />
                  </>
                )}

                <Pressable
                  onPress={handleSaveComplaint}
                  disabled={complaintSaving}
                  style={[styles.modalSubmitBtn, complaintSaving && { opacity: 0.6 }, { marginBottom: 20 }]}>
                  <Text style={styles.modalSubmitBtnText}>{complaintSaving ? t('common_saving') : t('bld_saveComplaint')}</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // Otherwise, render Customer Authentication / Sign-In Screen
  return (
    <SafeAreaView style={[styles.authScreen, isDarkMode && styles.authScreenDark]}>
      <ScrollView contentContainerStyle={styles.authScrollContent} keyboardShouldPersistTaps="handled">
        {/* Brand Header */}
        <View style={styles.authBrandCard}>
          <View style={styles.brandIconBox}>
            <Text style={styles.brandIconGlyph}>📖</Text>
          </View>
          <Text style={styles.brandTitle}>BizPilot</Text>
          <View style={styles.customerPortalPill}>
            <Text style={styles.customerPortalPillText}>CUSTOMER MOBILE PORTAL</Text>
          </View>
          <Text style={styles.brandTagline}>
            Smart digital khata & subscription companion for drivers, merchants, and local businesses.
          </Text>
        </View>

        {pinLoginAvailable ? (
          /* Two-way login: PIN or Email & DOB, chosen via a visible toggle */
          <View style={styles.authFormCard}>
            <View style={styles.modePillRow}>
              <Pressable
                onPress={() => {
                  setShowPinScreen(true);
                  setPinError('');
                }}
                style={[styles.modePill, showPinScreen && styles.modePillActive]}>
                <Text style={[styles.modePillText, showPinScreen && styles.modePillTextActive]}>{t('pin_loginMethodPin')}</Text>
              </Pressable>
              <Pressable onPress={handleUseFullLoginInstead} style={[styles.modePill, !showPinScreen && styles.modePillActive]}>
                <Text style={[styles.modePillText, !showPinScreen && styles.modePillTextActive]}>{t('pin_loginMethodCredentials')}</Text>
              </Pressable>
            </View>

            {showPinScreen ? (
              <>
                <Text style={styles.formTitle}>
                  {pinLoginName ? t('pin_welcomeBack', { name: pinLoginName.split(' ')[0] }) : t('pin_welcomeBackGeneric')}
                </Text>
                <Text style={styles.formSubtitle}>{t('pin_enterHint')}</Text>

                <TextInput
                  autoFocus
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={6}
                  placeholder="••••"
                  placeholderTextColor={colors.muted}
                  style={[styles.authInput, { textAlign: 'center', fontSize: 28, letterSpacing: 12 }]}
                  value={pinInput}
                  onChangeText={(v) => {
                    setPinInput(v.replace(/[^0-9]/g, ''));
                    setPinError('');
                  }}
                  onSubmitEditing={handlePinSubmit}
                />

                {!!pinError && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>⚠️ {pinError}</Text>
                  </View>
                )}

                <Pressable
                  onPress={handlePinSubmit}
                  disabled={pinUnlocking || pinInput.length < 4}
                  style={[styles.signInButton, (pinUnlocking || pinInput.length < 4) && { opacity: 0.6 }]}>
                  <Text style={styles.signInButtonText}>{pinUnlocking ? t('common_loading') : t('pin_unlock')}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.formTitle}>Sign In to Your Ledger</Text>
                <Text style={styles.formSubtitle}>Enter your registered email and date of birth to access your account.</Text>

                <Text style={styles.fieldLabel}>Registered Email</Text>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder="e.g. prem@gmail.com"
                  placeholderTextColor={colors.muted}
                  style={styles.authInput}
                  value={email}
                  onChangeText={setEmail}
                />

                <Text style={styles.fieldLabel}>Date of Birth (YYYY-MM-DD)</Text>
                <TextInput
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                  placeholder="e.g. 1992-09-01"
                  placeholderTextColor={colors.muted}
                  style={styles.authInput}
                  value={dob}
                  onChangeText={setDob}
                />

                {!!errorMessage && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
                  </View>
                )}

                {!!adminNotice && (
                  <View style={styles.adminNoticeBox}>
                    <Text style={styles.adminNoticeTitle}>🛡️ Administrator Notice</Text>
                    <Text style={styles.adminNoticeText}>{adminNotice}</Text>
                  </View>
                )}

                <Pressable onPress={() => handleLogin()} disabled={loading} style={styles.signInButton}>
                  <Text style={styles.signInButtonText}>{loading ? 'Signing In...' : 'Access My Account'}</Text>
                </Pressable>
              </>
            )}

            <Text style={styles.authFooterBadge}>🔒 Secure 256-bit Encrypted Customer Ledger</Text>
          </View>
        ) : authMode === 'login' ? (
          /* Login Form Card */
          <View style={styles.authFormCard}>
            <Text style={styles.formTitle}>Sign In to Your Ledger</Text>
            <Text style={styles.formSubtitle}>Enter your registered email and date of birth to access your account.</Text>

            <Text style={styles.fieldLabel}>Registered Email</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="e.g. prem@gmail.com"
              placeholderTextColor={colors.muted}
              style={styles.authInput}
              value={email}
              onChangeText={setEmail}
            />

            <Text style={styles.fieldLabel}>Date of Birth (YYYY-MM-DD)</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              placeholder="e.g. 1992-09-01"
              placeholderTextColor={colors.muted}
              style={styles.authInput}
              value={dob}
              onChangeText={setDob}
            />

            {!!errorMessage && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
              </View>
            )}

            {!!adminNotice && (
              <View style={styles.adminNoticeBox}>
                <Text style={styles.adminNoticeTitle}>🛡️ Administrator Notice</Text>
                <Text style={styles.adminNoticeText}>{adminNotice}</Text>
              </View>
            )}

            <Pressable onPress={() => handleLogin()} disabled={loading} style={styles.signInButton}>
              <Text style={styles.signInButtonText}>{loading ? 'Signing In...' : 'Access My Account'}</Text>
            </Pressable>

            <Text style={styles.authFooterBadge}>🔒 Secure 256-bit Encrypted Customer Ledger</Text>
          </View>
        ) : (
          /* Registration Form Card */
          <View style={styles.authFormCard}>
            <Text style={styles.formTitle}>Create Your Account</Text>
            <Text style={styles.formSubtitle}>Register once to start using your digital khata & subscription ledger.</Text>

            <Text style={styles.fieldLabel}>Full Name</Text>
            <TextInput
              placeholder="e.g. Prem Naik"
              placeholderTextColor={colors.muted}
              style={styles.authInput}
              value={regFullName}
              onChangeText={setRegFullName}
            />

            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="e.g. prem@gmail.com"
              placeholderTextColor={colors.muted}
              style={styles.authInput}
              value={regEmail}
              onChangeText={setRegEmail}
            />

            <Text style={styles.fieldLabel}>Date of Birth (YYYY-MM-DD)</Text>
            <TextInput
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              placeholder="e.g. 1992-09-01"
              placeholderTextColor={colors.muted}
              style={styles.authInput}
              value={regDob}
              onChangeText={setRegDob}
            />
            <Text style={styles.regFieldHint}>This also acts as your login password — you'll sign in with this email + date of birth.</Text>

            <Text style={styles.fieldLabel}>Business Type</Text>
            <Pressable
              onPress={() => setShowBusinessTypeDropdown(true)}
              disabled={businessTypesLoading}
              style={styles.selectBox}>
              <Text style={regBusinessType ? styles.selectBoxText : styles.selectBoxPlaceholder}>
                {businessTypesLoading
                  ? 'Loading business types...'
                  : regBusinessType
                    ? `${getBusinessIcon(regBusinessType)} ${regBusinessType}`
                    : 'Select business type'}
              </Text>
              <Text style={styles.selectBoxChevron}>▾</Text>
            </Pressable>

            <Text style={styles.fieldLabel}>Subscription Plan</Text>
            <Pressable
              onPress={() => setShowPlanDropdown(true)}
              disabled={plansLoading}
              style={styles.selectBox}>
              <Text style={regPlan ? styles.selectBoxText : styles.selectBoxPlaceholder}>
                {plansLoading
                  ? 'Loading plans...'
                  : regPlan
                    ? `${regPlan} · ₹${availablePlans.find((p) => p.name === regPlan)?.monthlyAmount ?? 0}/mo`
                    : 'Select subscription plan'}
              </Text>
              <Text style={styles.selectBoxChevron}>▾</Text>
            </Pressable>

            {!!regError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>⚠️ {regError}</Text>
              </View>
            )}

            <Pressable onPress={handleRegister} disabled={regLoading} style={styles.signInButton}>
              <Text style={styles.signInButtonText}>{regLoading ? 'Creating Account...' : 'Create Account'}</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setRegError('');
                setAuthMode('login');
              }}
              style={styles.switchAuthModeBtn}>
              <Text style={styles.switchAuthModeText}>Already have an account? <Text style={styles.switchAuthModeTextBold}>Sign in</Text></Text>
            </Pressable>

            <Text style={styles.authFooterBadge}>🔒 Secure 256-bit Encrypted Customer Ledger</Text>
          </View>
        )}
      </ScrollView>

      {/* Business Type Dropdown */}
      <Modal visible={showBusinessTypeDropdown} animationType="slide" transparent onRequestClose={() => setShowBusinessTypeDropdown(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowBusinessTypeDropdown(false)}>
          <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeading}>Select Business Type</Text>
              <Pressable onPress={() => setShowBusinessTypeDropdown(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.dropdownList}>
              {businessTypes.map((bt) => (
                <Pressable
                  key={bt.id}
                  onPress={() => {
                    setRegBusinessType(bt.name);
                    setShowBusinessTypeDropdown(false);
                  }}
                  style={[styles.dropdownOption, regBusinessType === bt.name && styles.dropdownOptionActive]}>
                  <Text style={[styles.dropdownOptionText, regBusinessType === bt.name && styles.dropdownOptionTextActive]}>
                    {getBusinessIcon(bt.name)} {bt.name}
                  </Text>
                  {!!bt.description && <Text style={styles.dropdownOptionDesc}>{bt.description}</Text>}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Subscription Plan Dropdown */}
      <Modal visible={showPlanDropdown} animationType="slide" transparent onRequestClose={() => setShowPlanDropdown(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowPlanDropdown(false)}>
          <Pressable style={styles.dropdownModalContent} onPress={() => {}}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeading}>Select Subscription Plan</Text>
              <Pressable onPress={() => setShowPlanDropdown(false)}>
                <Text style={styles.modalCloseText}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.dropdownList}>
              {availablePlans.map((plan) => (
                <Pressable
                  key={plan.id}
                  onPress={() => {
                    setRegPlan(plan.name);
                    setShowPlanDropdown(false);
                  }}
                  style={[styles.dropdownOption, regPlan === plan.name && styles.dropdownOptionActive]}>
                  <Text style={[styles.dropdownOptionText, regPlan === plan.name && styles.dropdownOptionTextActive]}>
                    {plan.name} · ₹{plan.monthlyAmount}/mo
                  </Text>
                  {!!plan.description && <Text style={styles.dropdownOptionDesc}>{plan.description}</Text>}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function getBusinessIcon(type?: string) {
  if (!type) return '💼';
  const lower = type.toLowerCase();
  if (lower.includes('travel') || lower.includes('bus')) return '🚌';
  if (lower.includes('auto') || lower.includes('driver')) return '🛺';
  if (lower.includes('vegetable')) return '🥦';
  if (lower.includes('fruit')) return '🍎';
  if (lower.includes('mechanic')) return '🔧';
  if (lower.includes('retail') || lower.includes('store')) return '🏪';
  if (lower.includes('collection')) return '📊';
  return '💼';
}

function getGreetingKey(): 'header_goodMorning' | 'header_goodAfternoon' | 'header_goodEvening' | 'header_goodNight' {
  const hour = new Date().getHours();
  if (hour < 5) return 'header_goodNight';
  if (hour < 12) return 'header_goodMorning';
  if (hour < 17) return 'header_goodAfternoon';
  if (hour < 21) return 'header_goodEvening';
  return 'header_goodNight';
}

function renderHomeCardGrid(cards: { icon: string; label: string; value: string; color: string }[]) {
  return (
    <View style={styles.homeCardGrid}>
      {cards.map((card, idx) => (
        <View key={idx} style={styles.homeCard}>
          <View style={[styles.homeCardIconWrap, { backgroundColor: card.color + '1A' }]}>
            <Text style={styles.homeCardIcon}>{card.icon}</Text>
          </View>
          <Text style={styles.homeCardLabel}>{card.label.toUpperCase()}</Text>
          <Text style={[styles.homeCardValue, { color: card.color }]}>{card.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Screens
  authScreen: {
    flex: 1,
    backgroundColor: colors.page,
  },
  authScreenDark: {
    backgroundColor: colors.pageDark,
  },
  authScrollContent: {
    padding: 20,
    justifyContent: 'center',
    flexGrow: 1,
  },
  mainScreen: {
    flex: 1,
    backgroundColor: colors.page,
  },
  mainScreenDark: {
    backgroundColor: colors.pageDark,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // Auth Branding
  authBrandCard: {
    alignItems: 'center',
    marginBottom: 20,
  },
  brandIconBox: {
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  brandIconGlyph: {
    fontSize: 28,
  },
  brandTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.navy,
    letterSpacing: 0.5,
  },
  customerPortalPill: {
    backgroundColor: colors.brandBg,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 6,
  },
  customerPortalPillText: {
    color: colors.brand,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  brandTagline: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
    maxWidth: 320,
  },

  // Auth Form
  authFormCard: {
    backgroundColor: colors.panel,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.navy,
    marginBottom: 4,
  },
  formSubtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 18,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.slate,
    marginTop: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  authInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.navy,
  },
  signInButton: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  signInButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: colors.redBg,
    borderColor: colors.redBorder,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 14,
  },
  errorText: {
    color: colors.red,
    fontSize: 13,
  },
  adminNoticeBox: {
    backgroundColor: colors.amberBg,
    borderColor: colors.amberBorder,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  adminNoticeTitle: {
    color: colors.amber,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  adminNoticeText: {
    color: colors.slate,
    fontSize: 12,
    lineHeight: 17,
  },
  demoSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  demoSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  demoPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  demoAccountChip: {
    backgroundColor: colors.brandBg,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flex: 1,
    alignItems: 'center',
  },
  demoAccountChipText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '700',
  },
  authFooterBadge: {
    color: colors.muted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 18,
  },
  switchAuthModeBtn: {
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 4,
  },
  switchAuthModeText: {
    color: colors.muted,
    fontSize: 13,
  },
  switchAuthModeTextBold: {
    color: colors.brand,
    fontWeight: '700',
  },
  regFieldHint: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 4,
  },
  selectBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  selectBoxText: {
    color: colors.navy,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  selectBoxPlaceholder: {
    color: colors.muted,
    fontSize: 14,
    flex: 1,
  },
  selectBoxChevron: {
    color: colors.muted,
    fontSize: 14,
    marginLeft: 8,
  },
  dropdownModalContent: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    maxHeight: '75%',
  },
  dropdownList: {
    maxHeight: '100%',
  },
  dropdownOption: {
    paddingVertical: 13,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownOptionActive: {
    backgroundColor: colors.brandBg,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  dropdownOptionText: {
    color: colors.navy,
    fontSize: 14,
    fontWeight: '600',
  },
  dropdownOptionTextActive: {
    color: colors.brandDark,
    fontWeight: '800',
  },
  dropdownOptionDesc: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },

  // Main Header & Nav
  topHeader: {
    paddingTop: Platform.OS === 'ios' ? 44 : 16,
    paddingHorizontal: 16,
    paddingBottom: 4,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: colors.brandDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  headerUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  avatarText: {
    color: colors.brand,
    fontSize: 18,
    fontWeight: '800',
  },
  userInfoCol: {
    flex: 1,
  },
  userTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  greetingText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    flexShrink: 1,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  activeBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#4ADE80',
  },
  activeBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  businessCategoryText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 2,
    fontWeight: '500',
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  logoutBtn: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutBtnPressed: {
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  logoutBtnText: {
    color: colors.red,
    fontSize: 12,
    fontWeight: '700',
  },
  profileLogoutBtn: {
    backgroundColor: colors.redBg,
    borderColor: colors.redBorder,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  profileLogoutBtnPressed: {
    backgroundColor: '#FEE2E2',
    opacity: 0.8,
  },
  profileLogoutBtnText: {
    color: colors.red,
    fontSize: 15,
    fontWeight: '700',
  },
  navTabContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  navTab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  navTabActive: {
    backgroundColor: '#FFFFFF',
  },
  navTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
  },
  navTabTextActive: {
    color: colors.brand,
    fontWeight: '800',
  },

  // Home / Welcome Dashboard
  homeBannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.brandBg,
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  homeBannerIcon: {
    fontSize: 30,
  },
  homeBannerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.navy,
  },
  homeBannerSubtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    fontWeight: '600',
  },
  homeCardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 18,
  },
  homeCard: {
    width: '48%',
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  homeCardIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  homeCardIcon: {
    fontSize: 16,
  },
  homeCardLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.4,
    marginBottom: 3,
  },
  homeCardValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  homeQuickActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10,
  },
  homeQuickActionCard: {
    width: '31%',
    minWidth: 96,
    alignItems: 'center',
    backgroundColor: colors.brandBg,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 6,
  },
  homeQuickActionIcon: {
    fontSize: 22,
    marginBottom: 6,
  },
  homeQuickActionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.navy,
    textAlign: 'center',
  },

  // Daily Ledger Tab
  balanceCard: {
    backgroundColor: colors.panel,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  balanceHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 1,
  },
  dateChip: {
    backgroundColor: colors.page,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  dateChipText: {
    fontSize: 11,
    color: colors.slate,
    fontWeight: '600',
  },
  balanceMainAmount: {
    fontSize: 32,
    fontWeight: '800',
    marginVertical: 10,
  },
  balanceSplitRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  splitBox: {
    flex: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  splitBoxGreen: {
    backgroundColor: colors.greenBg,
    borderColor: colors.greenBorder,
  },
  splitBoxRed: {
    backgroundColor: colors.redBg,
    borderColor: colors.redBorder,
  },
  splitBoxLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.slate,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  splitBoxValue: {
    fontSize: 17,
    fontWeight: '800',
  },
  quickActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  quickAddBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  quickAddBtnIn: {
    backgroundColor: colors.green,
  },
  quickAddBtnOut: {
    backgroundColor: colors.red,
  },
  quickAddBtnTextIn: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  quickAddBtnTextOut: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },

  // Transactions Section
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.navy,
  },
  filterPillsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  filterPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
  },
  filterPillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  txCard: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  txIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  txIconBoxIn: {
    backgroundColor: colors.greenBg,
  },
  txIconBoxOut: {
    backgroundColor: colors.redBg,
  },
  txIconSymbol: {
    fontSize: 18,
    fontWeight: '800',
  },
  txDetailsCol: {
    flex: 1,
  },
  txPartyName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.navy,
  },
  txMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  txCategoryTag: {
    fontSize: 11,
    color: colors.muted,
  },
  txBullet: {
    fontSize: 10,
    color: colors.muted,
  },
  txModeTag: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.slate,
    backgroundColor: colors.page,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  txTime: {
    fontSize: 11,
    color: colors.muted,
  },
  txAmountCol: {
    alignItems: 'flex-end',
  },
  txAmountText: {
    fontSize: 15,
    fontWeight: '800',
  },

  // Plan Tab
  activePlanCard: {
    backgroundColor: colors.panel,
    borderRadius: 20,
    padding: 20,
    borderWidth: 2,
    borderColor: colors.brand,
    marginBottom: 24,
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  activePlanTagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  planStatusPill: {
    backgroundColor: colors.brandBg,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  planStatusPillText: {
    color: colors.brand,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  planRenewBadge: {
    fontSize: 11,
    color: colors.green,
    fontWeight: '700',
  },
  planTitleName: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.navy,
  },
  planSubInfo: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
  },
  boldText: {
    fontWeight: '700',
    color: colors.navy,
  },
  planValidityBox: {
    flexDirection: 'row',
    backgroundColor: colors.page,
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  validityCol: {
    flex: 1,
  },
  validityLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    marginBottom: 2,
  },
  validityValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.navy,
  },
  perksList: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  perksHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.slate,
    marginBottom: 8,
  },
  perkItem: {
    fontSize: 12,
    color: colors.slate,
    marginBottom: 4,
  },
  planCard: {
    backgroundColor: colors.panel,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
  },
  planCardPopular: {
    borderColor: colors.brand,
    borderWidth: 2,
  },
  popularBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.brand,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 6,
  },
  popularBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  planHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  planCardName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.navy,
  },
  planCardDesc: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  planCardPriceBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  planCardPrice: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.brand,
  },
  planCardCycle: {
    fontSize: 12,
    color: colors.muted,
  },
  planFeatureList: {
    marginTop: 10,
    marginBottom: 12,
  },
  planFeatureText: {
    fontSize: 12,
    color: colors.slate,
    marginBottom: 2,
  },
  planSelectBtn: {
    backgroundColor: colors.brandBg,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  planSelectBtnCurrent: {
    backgroundColor: colors.greenBg,
  },
  planSelectBtnText: {
    color: colors.brandDark,
    fontSize: 13,
    fontWeight: '700',
  },
  planSelectBtnTextCurrent: {
    color: colors.greenDark,
  },

  // Dues Tab
  duesOverviewCard: {
    backgroundColor: colors.panel,
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  duesOverviewCol: {
    flex: 1,
    alignItems: 'center',
  },
  duesDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  duesOverviewLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    textAlign: 'center',
    marginBottom: 4,
  },
  duesOverviewAmount: {
    fontSize: 20,
    fontWeight: '800',
  },
  addDueBtnSmall: {
    backgroundColor: colors.brandBg,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  addDueBtnSmallText: {
    color: colors.brand,
    fontSize: 12,
    fontWeight: '700',
  },
  dueCard: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  dueInfoCol: {
    flex: 1,
  },
  dueName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.navy,
  },
  duePhone: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  dueUpdated: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
  },
  overdueBadge: {
    backgroundColor: colors.redBg,
    borderColor: colors.redBorder,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  overdueBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.red,
  },
  remainingPendingText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.red,
    marginTop: 2,
    textAlign: 'right',
  },
  dueAmountCol: {
    alignItems: 'flex-end',
  },
  dueAmountText: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  settleBtn: {
    backgroundColor: colors.page,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settleBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.slate,
  },

  // Profile Tab
  profileCard: {
    backgroundColor: colors.panel,
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  profileAvatarLarge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  profileAvatarTextLarge: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
  },
  profileFullName: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.navy,
  },
  profileBadge: {
    backgroundColor: colors.brandBg,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 6,
    marginBottom: 16,
  },
  profileBadgeText: {
    color: colors.brandDark,
    fontSize: 12,
    fontWeight: '700',
  },
  profileDetailsList: {
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 14,
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  profileRowLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  profileRowVal: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.navy,
  },
  supportCard: {
    backgroundColor: colors.panel,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  supportHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.navy,
    marginBottom: 6,
  },
  supportDesc: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 18,
    marginBottom: 12,
  },
  supportContactRow: {
    backgroundColor: colors.page,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  supportContactText: {
    fontSize: 12,
    color: colors.slate,
    fontWeight: '600',
  },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 22,
    maxHeight: '90%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.navy,
  },
  modalCloseText: {
    fontSize: 18,
    color: colors.muted,
    fontWeight: '700',
    padding: 4,
  },
  modalTypeSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.page,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  modalTypeBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  modalTypeBtnActiveIn: {
    backgroundColor: colors.green,
  },
  modalTypeBtnActiveOut: {
    backgroundColor: colors.red,
  },
  modalTypeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
  },
  modalTypeBtnTextActive: {
    color: '#FFFFFF',
  },
  modalInput: {
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.navy,
    marginBottom: 10,
  },
  modePillRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  modePill: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.page,
  },
  modePillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  modePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.slate,
  },
  modePillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  modalSubmitBtn: {
    backgroundColor: colors.brand,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalSubmitBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  seatStepperBtn: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.brandBg,
    borderWidth: 1.5,
    borderColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seatStepperBtnText: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.brand,
    lineHeight: 24,
  },

  // Helpers
  textPositive: {
    color: colors.green,
  },
  textNegative: {
    color: colors.red,
  },
  helperText: {
    fontSize: 13,
    color: colors.muted,
  },

  // Business Hero & Shared Cards
  businessHeroCard: {
    backgroundColor: colors.panel,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  businessHeroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  businessIconBadge: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  businessHeroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.navy,
  },
  businessHeroSubtitle: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
    fontWeight: '500',
  },
  pillRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  featureMiniPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  featureMiniPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.slate,
  },
  vehicleOdoBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vehicleOdoLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.5,
  },
  vehicleOdoValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.navy,
    marginVertical: 4,
  },
  vehicleOdoSub: {
    fontSize: 11,
    color: colors.muted,
  },
  actionBtnOutline: {
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 14,
    backgroundColor: colors.brandBg,
  },
  actionBtnOutlineText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: '700',
  },
  complianceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  complianceIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  complianceTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.navy,
  },
  complianceDesc: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  cardDivider: {
    height: 1,
    backgroundColor: colors.border,
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  seatMapCard: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 18,
  },
  customerGridHeaderText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.4,
  },

  // KPI Metrics Grid
  kpiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: colors.panel,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  kpiLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.navy,
  },
  kpiSub: {
    fontSize: 10,
    color: colors.muted,
    marginTop: 2,
  },
  primaryPillBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  primaryPillBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },

  // Trips Tab
  tripCard: {
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripLeftCol: {
    flex: 1,
    marginRight: 10,
  },
  tripRouteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tripRoutePin: {
    fontSize: 13,
  },
  tripRouteText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.navy,
  },
  tripMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  tripMetricText: {
    fontSize: 12,
    color: colors.muted,
  },
  bulletDot: {
    fontSize: 12,
    color: colors.muted,
  },
  tripTimeText: {
    fontSize: 11,
    color: colors.muted,
  },
  tripRightCol: {
    alignItems: 'flex-end',
  },
  tripFareText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.green,
  },
  modeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  modeBadgeUpi: {
    backgroundColor: '#E0E7FF',
  },
  modeBadgeCash: {
    backgroundColor: '#FEF3C7',
  },
  modeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  modeBadgeTextUpi: {
    color: '#3730A3',
  },
  modeBadgeTextCash: {
    color: '#92400E',
  },

  // Fuel Tab
  fuelCard: {
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fuelLeftCol: {
    flex: 1,
    marginRight: 10,
  },
  fuelStationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fuelStationIcon: {
    fontSize: 14,
  },
  fuelStationName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.navy,
  },
  fuelDetailText: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 3,
  },
  fuelDateText: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  fuelRightCol: {
    alignItems: 'flex-end',
  },
  fuelAmountText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.red,
  },
  fuelTypePill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
  },
  fuelTypePillText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.slate,
  },

  // Inventory Tab
  inventoryCard: {
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  invItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.navy,
  },
  invCategoryPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  invCategoryText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
  },
  invPriceText: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 4,
  },
  emptyStateText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
    paddingVertical: 16,
  },
  txTableWrap: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  txTableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  txTableHeaderText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    letterSpacing: 0.4,
  },
  txTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  txTableCellName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.navy,
  },
  wastageTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginTop: 2,
  },
  wastageTagText: {
    fontSize: 8,
    fontWeight: '800',
    color: colors.red,
    letterSpacing: 0.3,
  },
  chatFab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  chatFabIcon: {
    fontSize: 24,
  },
  chatBubble: {
    maxWidth: '82%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },
  chatBubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: colors.brand,
    borderBottomRightRadius: 3,
  },
  chatBubbleBot: {
    alignSelf: 'flex-start',
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 3,
  },
  chatBubbleUserText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
  },
  chatBubbleBotText: {
    color: colors.navy,
    fontSize: 13,
    lineHeight: 18,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  chatInput: {
    flex: 1,
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.navy,
  },
  chatSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSendBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  dailySummaryBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  dailySummaryIcon: {
    fontSize: 20,
  },
  dailySummaryTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.brandDark,
    marginBottom: 4,
  },
  dailySummaryText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.slateDark,
  },
  dailySummaryClose: {
    fontSize: 14,
    color: colors.muted,
    fontWeight: '700',
    paddingLeft: 4,
  },
  restockCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  restockCardSoon: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  restockCardCritical: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  restockUrgencyTag: {
    backgroundColor: '#FDE68A',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  restockUrgencyTagCritical: {
    backgroundColor: '#FECACA',
  },
  restockUrgencyTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#92400E',
    letterSpacing: 0.3,
  },
  restockUrgencyTagTextCritical: {
    color: colors.red,
  },
  restockBuyText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.navy,
    marginTop: 4,
  },
  restockReasonText: {
    fontSize: 12,
    color: colors.slate,
    marginTop: 2,
  },
  restockWastageNote: {
    fontSize: 11,
    color: colors.red,
    marginTop: 4,
    fontWeight: '600',
  },
  restockPurchaseBtn: {
    marginTop: 10,
    backgroundColor: '#D97706',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  restockPurchaseBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  txTableCell: {
    fontSize: 12,
    color: colors.slate,
  },
  txTableCellAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.green,
  },
  chartCard: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  chartCardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  chartCardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.navy,
  },
  chartCardBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.brand,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    overflow: 'hidden',
  },
  chartStatText: {
    fontSize: 11,
    color: colors.muted,
  },
  chartStatValue: {
    fontWeight: '800',
    color: colors.navy,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#fff',
  },
  rankProductName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.slateDark,
  },
  rankAmount: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.greenDark,
  },
  rankTrack: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.page,
    overflow: 'hidden',
  },
  rankFill: {
    height: '100%',
    borderRadius: 6,
    overflow: 'hidden',
  },
  rankFillSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  rankPct: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
    minWidth: 30,
    textAlign: 'right',
  },
  barValueChip: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.navy,
    marginBottom: 6,
  },
  barPill: {
    width: 22,
    borderRadius: 11,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  barPillSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '30%',
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  chartBaseline: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: 2,
    marginBottom: 8,
  },
  barLabel: {
    fontSize: 9,
    color: colors.muted,
    fontWeight: '500',
  },
  barLabelActive: {
    color: colors.navy,
    fontWeight: '800',
  },
  stockBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  stockBadgeOk: {
    backgroundColor: colors.greenBg,
    borderWidth: 1,
    borderColor: colors.greenBorder,
  },
  stockBadgeLow: {
    backgroundColor: colors.redBg,
    borderWidth: 1,
    borderColor: colors.redBorder,
  },
  stockBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  stockBadgeTextOk: {
    color: colors.green,
  },
  stockBadgeTextLow: {
    color: colors.red,
  },

  // Mechanic Service Jobs
  serviceJobCard: {
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  serviceJobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serviceJobId: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
  },
  serviceJobCustomer: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.navy,
    marginTop: 1,
  },
  serviceJobVehicleRow: {
    marginTop: 6,
  },
  serviceJobVehicleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.slate,
  },
  serviceJobComplaintText: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
  },
  serviceJobFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  serviceJobEstLabel: {
    fontSize: 12,
    color: colors.muted,
  },
  serviceJobEstVal: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.brand,
  },
  jobStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  jobStatusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  jobStatusReady: {
    backgroundColor: colors.greenBg,
  },
  jobStatusReadyText: {
    color: colors.green,
    fontSize: 10,
    fontWeight: '700',
  },
  jobStatusInProgress: {
    backgroundColor: colors.amberBg,
  },
  jobStatusInProgressText: {
    color: colors.amber,
    fontSize: 10,
    fontWeight: '700',
  },
  jobStatusDelivered: {
    backgroundColor: '#F1F5F9',
  },
  jobStatusDeliveredText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
  },

  // Collections Tab
  collectionCard: {
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  // Collection Dashboard Styles
  dashHeaderCard: {
    backgroundColor: '#1E1B4B',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#312E81',
  },
  dashHeaderTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  dashHeaderSubtitle: {
    fontSize: 12,
    color: '#A5B4FC',
    marginTop: 3,
    fontWeight: '600',
  },
  dashRefreshBtn: {
    backgroundColor: '#3730A3',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4F46E5',
  },
  dashChartIconBtn: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashChartIconBtnText: {
    fontSize: 16,
  },
  chartSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.navy,
    marginBottom: 12,
  },
  dashRefreshBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  dashPeriodSegment: {
    flexDirection: 'row',
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    padding: 3,
    marginBottom: 10,
  },
  dashPeriodTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
  },
  dashPeriodTabActive: {
    backgroundColor: colors.brand,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  dashPeriodTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.slate,
  },
  dashPeriodTabTextActive: {
    color: '#FFFFFF',
  },
  dashChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  dashChip: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  dashChipActive: {
    backgroundColor: colors.brandBg,
    borderColor: colors.brand,
  },
  dashChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.slate,
  },
  dashChipTextActive: {
    color: colors.brand,
    fontWeight: '700',
  },
  dashTargetCard: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  dashTargetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  dashTargetLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.slateDark,
  },
  dashTargetValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.navy,
  },
  dashCollectedLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.green,
  },
  dashCollectedValue: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.green,
  },
  dashRemainingLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.amber,
  },
  dashRemainingValue: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.amber,
  },
  dashProgressTrack: {
    height: 10,
    backgroundColor: '#F1F5F9',
    borderRadius: 5,
    overflow: 'hidden',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dashProgressBar: {
    height: '100%',
    backgroundColor: colors.green,
    borderRadius: 5,
  },
  dashProgressMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  dashCard: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 14,
  },
  dashCardSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.slateDark,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dashPeopleGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  dashPeopleBox: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  dashPeopleBoxActive: {
    backgroundColor: colors.brandBg,
    borderColor: colors.brand,
  },
  dashPeopleCount: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.slateDark,
    marginTop: 3,
  },
  dashPeopleLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
    marginTop: 2,
    textAlign: 'center',
  },
  dashActionsCol: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dashActionBtn: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  dashActionBtnActiveGreen: {
    backgroundColor: colors.green,
    borderColor: colors.greenDark,
  },
  dashActionBtnActiveRed: {
    backgroundColor: colors.red,
    borderColor: colors.redDark,
  },
  dashActionBtnActiveBlue: {
    backgroundColor: colors.brand,
    borderColor: colors.brandDark,
  },
  dashActionBtnActiveTeal: {
    backgroundColor: '#0D9488',
    borderColor: '#0F766E',
  },
  dashActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.slateDark,
    textAlign: 'center',
  },
  dashActionBtnTextActive: {
    color: '#FFFFFF',
  },
  dashSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  dashSearchInput: {
    flex: 1,
    height: 42,
    fontSize: 13,
    color: colors.slateDark,
  },
  dashSearchClear: {
    padding: 6,
  },
  dashEmptyBox: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    alignItems: 'center',
  },
  dashCustomerCard: {
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dashCustomerName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.slateDark,
  },
  dashAccBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  dashAccText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.muted,
  },
  dashCustomerMeta: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 3,
  },
  dashMissedReasonBox: {
    backgroundColor: colors.redBg,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 4,
    alignSelf: 'flex-start',
    borderWidth: 0.5,
    borderColor: colors.redBorder,
  },
  dashMissedReasonText: {
    fontSize: 11,
    color: colors.red,
    fontWeight: '600',
  },
  dashCustomerAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.navy,
  },
  dashStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  dashStatusText: {
    fontSize: 10,
    fontWeight: '800',
  },
  dashDailyReportCard: {
    backgroundColor: colors.panel,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  dashDailyReportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dashDailyReportDate: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.slateDark,
  },
  dashDailyReportCollected: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.green,
  },
  dashDailyReportStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
});

export default App;
