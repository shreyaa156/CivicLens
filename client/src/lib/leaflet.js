// leaflet.markercluster is a UMD plugin that expects a global `L`.
import L from 'leaflet';
import { PRIORITY, UNASSIGNED_COLOR } from './constants';

window.L = L;

export function markerIcon(priority, { demo = false, size = 18, selected = false } = {}) {
  const color = PRIORITY[priority]?.color || UNASSIGNED_COLOR;
  const s = selected ? size + 8 : size;
  return L.divIcon({
    className: '',
    html: `<div class="cl-marker" style="width:${s}px;height:${s}px;background:${color};${demo ? 'opacity:.75;border-style:dashed;' : ''}${selected ? 'outline:3px solid #2563eb;' : ''}"></div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
  });
}

export const pinIcon = L.divIcon({
  className: '',
  html: `<svg width="34" height="44" viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg"><path d="M17 0C7.6 0 0 7.6 0 17c0 12.8 17 27 17 27s17-14.2 17-27C34 7.6 26.4 0 17 0z" fill="#2563eb"/><circle cx="17" cy="17" r="7" fill="#fff"/></svg>`,
  iconSize: [34, 44],
  iconAnchor: [17, 44],
});

export const OSM_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

export default L;
