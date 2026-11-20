import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import { pinIcon, OSM_TILES } from '../lib/leaflet';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../lib/constants';

function ClickHandler({ onPick }) {
  useMapEvents({ click: (e) => onPick({ latitude: +e.latlng.lat.toFixed(6), longitude: +e.latlng.lng.toFixed(6) }) });
  return null;
}

function Recenter({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo([position.latitude, position.longitude], Math.max(map.getZoom(), 16), { duration: 0.6 });
  }, [position, map]);
  return null;
}

/** Click (or drag the pin) to choose the issue location. */
export default function LocationPicker({ position, onChange, className = 'h-72' }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 ${className}`}>
      <MapContainer center={position ? [position.latitude, position.longitude] : DEFAULT_CENTER} zoom={position ? 16 : DEFAULT_ZOOM} className="h-full w-full" scrollWheelZoom>
        <TileLayer url={OSM_TILES.url} attribution={OSM_TILES.attribution} />
        <ClickHandler onPick={onChange} />
        <Recenter position={position} />
        {position && (
          <Marker
            position={[position.latitude, position.longitude]}
            icon={pinIcon}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const ll = e.target.getLatLng();
                onChange({ latitude: +ll.lat.toFixed(6), longitude: +ll.lng.toFixed(6) });
              },
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
