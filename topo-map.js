import { feature } from "./vendor/topojson-client.js";

export const COUNTY_CODES = ["63000", "64000", "65000", "66000", "67000", "68000", "10002", "10004", "10005", "10007", "10008", "10009", "10010", "10013", "10014", "10015", "10016", "10017", "10018", "10020", "09007", "09020"];
export const POPULATION_BREAKS = [0, 100, 500, 1000, 3000, 5000, 10000, 25000, 50000, 75000, 100000, 200000, 300000, 400000, 500000, 600000];
export const PALETTES = {
  purpleMorandi: ["#E8E4EC", "#D7CFDC", "#C4B8CA", "#BAAFC3", "#AA9BB2", "#9E90A7", "#8B7592", "#7B6283", "#6B5373", "#624568", "#5A3760"],
  roseMorandi: ["#EEE5E1", "#EDE2DF", "#E1C3B9", "#DBC3B8", "#CBA89D", "#CB9895", "#B88D89", "#B7827D", "#B27C82", "#A86669", "#873B46"],
  apricotMorandi: ["#F0EBE2", "#ECDAC9", "#E5C9B2", "#DFBDA4", "#DDB59C", "#D7A287", "#D39B81", "#CF927B", "#C88873", "#BB7967", "#A8675A"],
};

export function paletteColor(key, fraction) {
  const colors = PALETTES[key] || PALETTES.purpleMorandi;
  const position = Math.max(0, Math.min(1, fraction)) * (colors.length - 1);
  const index = Math.min(Math.floor(position), colors.length - 2);
  const rgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const a = rgb(colors[index]), b = rgb(colors[index + 1]);
  return `rgb(${a.map((channel, i) => Math.round(channel + (b[i] - channel) * (position - index))).join(",")})`;
}

export function classColor(value, breaks, colors) {
  if (!Number.isFinite(value)) return "#fff";
  const index = breaks.findIndex((edge, i) => i > 0 && value < edge);
  return colors[index < 0 ? colors.length - 1 : index - 1];
}

// One Mercator projection for every island: no inset translation or rescaling.
const mercator = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI;
const west = 118.1, north = mercator(26.5), factor = 170;
export const project = ([lon, lat]) => [(lon - west) * factor + 20, (north - mercator(lat)) * factor + 20];

function projectGeometry(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  // Keep the Taiwan/Penghu/Kinmen/Matsu map extent; omit remote sea polygons.
  const rings = polygons.filter(polygon => polygon[0].some(([lon, lat]) => lon >= 118.1 && lon <= 122.15 && lat >= 21.7 && lat <= 26.5))
    .map(polygon => polygon.map(ring => ring.map(project)));
  const points = rings.flat(2);
  if (!points.length) throw new Error("No Taiwan-region geometry");
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const bounds = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  const path = rings.map(polygon => polygon.map(ring => `M${ring.map(p => p.map(v => v.toFixed(3)).join(",")).join("L")}Z`).join("")).join("");
  // Place the label in the largest island/polygon, not between distant islands.
  const area = ring => Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0));
  const largest = rings.reduce((best, polygon) => area(polygon[0]) > area(best[0]) ? polygon : best)[0];
  const labelX = largest.reduce((sum, p) => sum + p[0], 0) / largest.length;
  const labelY = largest.reduce((sum, p) => sum + p[1], 0) / largest.length;
  return { path, bounds, labelX, labelY };
}

export async function loadTopoGeometry(loadJson, metadata) {
  const [country, ...towns] = await Promise.all([
    loadJson("./data/topojson/taiwan-country.topo.json"),
    ...COUNTY_CODES.map(code => loadJson(`./data/topojson/taiwan-towns-${code}.topo.json`)),
  ]);
  const names = new Map(metadata.towns.map(town => [town.code, town]));
  const counties = feature(country, country.objects.map).features.map(item => {
    const code = String(item.properties.id);
    const metadataTown = metadata.towns.find(town => town.code.startsWith(code));
    return { code, county: metadataTown?.county || item.properties.name, ...projectGeometry(item.geometry) };
  });
  const converted = towns.flatMap(topology => feature(topology, topology.objects.map).features).map(item => {
    const code = String(item.properties.id), town = names.get(code);
    if (!town) throw new Error(`Unknown TopoJSON town code: ${code}`);
    return { ...town, countyCode: code.slice(0, 5), ...projectGeometry(item.geometry) };
  });
  if (converted.length !== names.size || new Set(converted.map(town => town.code)).size !== names.size) throw new Error("Incomplete TopoJSON town coverage");
  const southeast = project([122.15, 21.7]);
  const northwestView = project([118.15, 25.4]), southeastView = project([122.15, 21.85]);
  const defaultBounds = { x: northwestView[0], y: northwestView[1], width: southeastView[0] - northwestView[0], height: southeastView[1] - northwestView[1] };
  return { towns: converted, counties, regions: {}, defaultBounds, viewBox: { width: southeast[0] + 20, height: southeast[1] + 20 } };
}
