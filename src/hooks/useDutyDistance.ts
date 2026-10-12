/**
 * useDutyDistance.ts
 * Automatic distance for auto drivers: while "on duty", GPS fixes are chained into a
 * running distance that is added to the server's total for the day.
 *
 * Runs in the foreground only (the app must be open). After the app has been in the
 * background, the gap is bridged with a straight line between the last and the next
 * fix, so short stints away are still counted approximately.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

const MIN_STEP_KM = 0.015; // ignore GPS jitter while standing still
const MAX_ACCURACY_M = 50; // ignore poor fixes
const MAX_SPEED_KMH = 110; // faster than this is a GPS jump, not an auto
const MAX_BRIDGE_MS = 30 * 60 * 1000; // do not bridge a gap longer than this
const FLUSH_EVERY_MS = 60 * 1000;
const FLUSH_AT_KM = 0.5;

type ApiFetch = (path: string, options?: RequestInit) => Promise<Response>;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useDutyDistance(ownerId: number | undefined, enabled: boolean, apiFetch: ApiFetch) {
  const [onDuty, setOnDuty] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [todayKm, setTodayKm] = useState(0);
  const savedKm = useRef(0); // today's total already on the server
  const pendingKm = useRef(0); // tracked but not yet sent
  const lastFix = useRef<{ lat: number; lon: number; at: number } | null>(null);
  const flushing = useRef(false);

  const dutyKey = `dutyOn_${ownerId}`;

  async function flush() {
    if (!ownerId || flushing.current || pendingKm.current <= 0) return;
    flushing.current = true;
    const sending = pendingKm.current;
    try {
      const res = await apiFetch('/api/driver/distance/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, km: Math.round(sending * 1000) / 1000 }),
      });
      if (res.ok) {
        const data = await res.json();
        pendingKm.current -= sending;
        savedKm.current = data.todayKm || 0;
        setTodayKm(savedKm.current + pendingKm.current);
      }
    } catch {
      // offline: keep the distance pending and try again on the next flush
    } finally {
      flushing.current = false;
    }
  }

  // Today's saved distance and the remembered duty switch
  useEffect(() => {
    if (!ownerId || !enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/driver/distance?owner_id=${ownerId}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          savedKm.current = data.todayKm || 0;
          setTodayKm(savedKm.current + pendingKm.current);
        }
      } catch {
        // shown as 0 until the next successful load
      }
      try {
        if ((await AsyncStorage.getItem(dutyKey)) === '1' && !cancelled) setOnDuty(true);
      } catch {
        // stays off
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerId, enabled]);

  // GPS watch while on duty
  useEffect(() => {
    if (!ownerId || !enabled || !onDuty) return;
    let subscription: Location.LocationSubscription | null = null;
    let stopped = false;
    lastFix.current = null;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setPermissionDenied(true);
          setOnDuty(false);
          AsyncStorage.setItem(dutyKey, '0').catch(() => {});
          return;
        }
        setPermissionDenied(false);
        const watcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 20, timeInterval: 5000 },
          position => {
            const { latitude, longitude, accuracy } = position.coords;
            if (accuracy != null && accuracy > MAX_ACCURACY_M) return;
            const fix = { lat: latitude, lon: longitude, at: position.timestamp };
            const previous = lastFix.current;
            if (!previous || fix.at - previous.at > MAX_BRIDGE_MS) {
              lastFix.current = fix;
              return;
            }
            const stepKm = haversineKm(previous.lat, previous.lon, fix.lat, fix.lon);
            if (stepKm < MIN_STEP_KM) return;
            const hours = (fix.at - previous.at) / 3600000;
            lastFix.current = fix;
            if (hours <= 0 || stepKm / hours > MAX_SPEED_KMH) return;
            pendingKm.current += stepKm;
            setTodayKm(savedKm.current + pendingKm.current);
            if (pendingKm.current >= FLUSH_AT_KM) flush();
          },
        );
        if (stopped) watcher.remove();
        else subscription = watcher;
      } catch (e) {
        console.error('Distance tracking could not start:', e);
      }
    })();

    const timer = setInterval(flush, FLUSH_EVERY_MS);
    const appState = AppState.addEventListener('change', state => {
      if (state !== 'active') flush();
    });
    return () => {
      stopped = true;
      subscription?.remove();
      clearInterval(timer);
      appState.remove();
      flush();
    };
  }, [ownerId, enabled, onDuty]);

  function toggleDuty(value: boolean) {
    setOnDuty(value);
    if (ownerId) AsyncStorage.setItem(dutyKey, value ? '1' : '0').catch(() => {});
  }

  return { onDuty, toggleDuty, todayKm: Math.round(todayKm * 10) / 10, permissionDenied };
}
