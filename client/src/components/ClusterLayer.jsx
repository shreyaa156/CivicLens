import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L, { markerIcon } from '../lib/leaflet';
import 'leaflet.markercluster';
import { categoryLabel } from '../lib/constants';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Clustered report markers coloured by priority. */
export default function ClusterLayer({ reports, onSelect, selectedId }) {
  const map = useMap();
  const groupRef = useRef(null);

  useEffect(() => {
    const group = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, spiderfyOnMaxZoom: true });
    groupRef.current = group;
    map.addLayer(group);
    return () => map.removeLayer(group);
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    const markers = reports.map((r) => {
      const m = L.marker([r.latitude, r.longitude], { icon: markerIcon(r.priority, { demo: r.is_demo, selected: r.id === selectedId }), title: r.reference });
      m.bindTooltip(
        `<strong>${esc(r.reference)}</strong>${r.is_demo ? ' · DEMO' : ''}<br/>${esc(categoryLabel(r.category))} · ${esc(r.priority || 'Unassigned')}`,
        { direction: 'top', offset: [0, -8] },
      );
      m.on('click', () => onSelect?.(r));
      return m;
    });
    group.addLayers(markers);
  }, [reports, onSelect, selectedId]);

  return null;
}
