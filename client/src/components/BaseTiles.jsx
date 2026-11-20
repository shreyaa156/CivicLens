import { TileLayer } from 'react-leaflet';
import { useApp } from '../lib/AppContext';
import { OSM_TILES } from '../lib/leaflet';

/**
 * Base map tiles for every map in the app. The provider comes from the server's /api/config
 * (MAP_TILE_URL etc.), so it can be switched without code changes. Falls back to the official
 * OpenStreetMap tile server. Attribution is always shown by Leaflet's attribution control.
 */
export default function BaseTiles() {
  const { config } = useApp();
  const map = config?.map;
  const url = map?.tileUrl || OSM_TILES.url;
  return (
    <TileLayer
      key={url}
      url={url}
      attribution={map?.attribution || OSM_TILES.attribution}
      subdomains={map?.subdomains || 'abc'}
      maxZoom={map?.maxZoom || 19}
      // Send the site origin as Referer (required by the OSM tile usage policy).
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
