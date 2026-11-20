import { config } from '../config/index.js';

// Reverse geocoding with OpenStreetMap Nominatim (free, no key).
// Usage policy: max 1 request/second, identify the app via User-Agent, cache results.
const cache = new Map();
let lastCall = 0;

export async function reverseGeocode(lat, lon) {
  if (!config.geocoding.enabled || config.isTest) return { area: null, address: null };
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key);

  const wait = Math.max(0, lastCall + 1100 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${lat}&lon=${lon}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': config.geocoding.userAgent, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const json = await res.json();
    const a = json.address || {};
    const area = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || a.town || a.city || null;
    const result = { area, address: json.display_name || null };
    cache.set(key, result);
    return result;
  } catch {
    return { area: null, address: null };
  }
}
