// ==========================================================================
// Application State & Initialization
// ==========================================================================
let map;
let baseTileLayer = null;
let labelTileLayer = null;
let townGeoJsonData = null;
let daycarePointsData = null;
let originalTownGeoJson = null;
let originalDaycarePoints = null;

let townLayer = null;
let daycareLayer = null;
let riskChart = null;
let pointLayers = {};
let originalPointDatasets = {};
let pointDatasets = {};
let activePointLayerIds = new Set();

let activeTheme = 'temp'; // 'flood' or 'temp'
let activeScenario = 'gwl40'; // 'current', 'gwl15', 'gwl20', 'gwl40'
let activeFloodLayers = { ncdr: true, wra: false }; // flood overlays can be combined
let activeTempAdminReference = false; // optional township reference overlay for temp mode
let activeTempRiskMode = 'grid'; // 'grid' = NCDR AR6 climate grid; 'admin' = township fallback without grid display
let activeWraScenario = 'gwl15'; // 'gwl15' = 350mm/24HR, 'gwl20' = 650mm/24HR
let riskMapOpacity = 0.7;
let activeClimateIndicator = '日夜溫差';
let activeClimateYear = '2050';
let activeClimateGridDataState = null;
let selectedTown = null; // Filter daycare list
let layerRenderRequestId = 0;

// 新增: Climate Data Engine 全域實例
const datasetRegistry = new DatasetRegistry();
const climateGridManager = new ClimateGridManager(datasetRegistry);
const spatialQueryEngine = new SpatialQueryEngine();
let layerManager = null;


let wraGeoJson350 = null;
let wraGeoJson650 = null;
let wraLayer = null;
let daycareIntersectResults = {}; // point key -> WRA direct/proximity flood risk result


function isWraLayerEnabled() {
    return activeTheme === 'flood' && activeFloodLayers.wra;
}

function isNcdrLayerEnabled() {
    return activeTheme === 'temp' ? (activeTempAdminReference || activeTempRiskMode === 'admin') : activeFloodLayers.ncdr;
}

function isClimateGridRiskMode() {
    return activeTheme === 'temp' && activeTempRiskMode === 'grid';
}

function getActiveFloodLayerNames() {
    const names = [];
    if (activeFloodLayers.ncdr) names.push('NCDR 鄉鎮風險');
    if (activeFloodLayers.wra) names.push('水利署潛勢圖');
    return names;
}

function getActiveWraScenario() {
    return activeFloodLayers.wra && !activeFloodLayers.ncdr ? activeScenario : activeWraScenario;
}

function getWraScenarioName() {
    return getActiveWraScenario() === 'gwl20' ? '650mm / 24HR 極端降雨' : '350mm / 24HR 暴雨模擬';
}

function getTownRiskFillOpacity() {
    return riskMapOpacity;
}

function getTownRiskHighlightOpacity() {
    return Math.min(riskMapOpacity + 0.1, 1);
}


// Base map tiles matched to the selected color theme.
const mapTileThemes = {
    dark: {
        base: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
        labels: 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png'
    },
    light: {
        base: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
        labels: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png'
    },
};

function getSavedColorTheme() {
    try {
        const theme = window.localStorage.getItem('cool-color-theme');
        return theme === 'light' || theme === 'dark' ? theme : 'dark';
    } catch (error) {
        return 'dark';
    }
}

function saveColorTheme(theme) {
    try {
        window.localStorage.setItem('cool-color-theme', theme);
    } catch (error) {
        // Storage can be blocked in sandboxed or privacy-restricted contexts.
    }
}

function getChartThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
        tick: styles.getPropertyValue('--text-secondary').trim() || '#94a3b8',
        grid: styles.getPropertyValue('--border-color').trim() || 'rgba(255,255,255,0.08)'
    };
}

function updateChartTheme() {
    if (!riskChart) return;
    const chartTheme = getChartThemeColors();
    riskChart.options.scales.x.ticks.color = chartTheme.tick;
    riskChart.options.scales.y.ticks.color = chartTheme.tick;
    riskChart.options.scales.y.grid.color = chartTheme.grid;
    riskChart.update();
}

function applyColorTheme(theme) {
    const nextTheme = theme === 'light' || theme === 'dark' ? theme : 'dark';
    document.documentElement.dataset.colorTheme = nextTheme;
    saveColorTheme(nextTheme);

    const select = document.getElementById('color-theme-select');
    if (select) select.value = nextTheme;

    applyMapTileTheme(nextTheme);
    updateChartTheme();
}

function applyMapTileTheme(theme) {
    if (!map) return;
    const tileTheme = mapTileThemes[theme] || mapTileThemes.dark;

    if (baseTileLayer) map.removeLayer(baseTileLayer);
    if (labelTileLayer) map.removeLayer(labelTileLayer);

    baseTileLayer = L.tileLayer(tileTheme.base, {
        maxZoom: 20,
        subdomains: 'abcd'
    }).addTo(map);

    labelTileLayer = L.tileLayer(tileTheme.labels, {
        maxZoom: 20,
        subdomains: 'abcd',
        pane: 'labels'
    }).addTo(map);
}

// Risk Color Map (corresponds to CSS variables)
const riskColors = {
    1: '#10b981', // Emerald Green (Low)
    2: '#84cc16', // Lime Green
    3: '#eab308', // Amber Yellow (Medium)
    4: '#f97316', // Orange
    5: '#ef4444'  // Soft Red (High)
};

// WRA Flood Depth Colors
const wraColors = {
    2: '#93c5fd', // 0.3 - 0.5m: Light Blue
    3: '#3b82f6', // 0.5 - 1.0m: Blue
    4: '#f97316', // 1.0 - 2.0m: Orange
    5: '#ef4444', // 2.0 - 3.0m: Red
    6: '#a855f7'  // > 3.0m: Purple
};

// Case Type Colors for Daycare markers
const caseColors = {
    '混合型': '#60a5fa',  // Blue
    '失智型': '#fb7185',  // Rose
    '失能型': '#34d399',  // Emerald
    '未知': '#94a3b8'    // Slate
};

const AGGREGATE_POINT_LAYER_ID = 'envFacilities';
const SPLIT_ENV_POINT_LAYER_IDS = ['envHq', 'envRecycling'];
const POINT_LAYER_GROUP_ORDER = ['環保設施', '日照中心'];

const POINT_REGISTRY = {
    daycare: {
        id: 'daycare',
        label: '日照與小規機構',
        shortLabel: '日照',
        icon: 'fa-house-chimney-medical',
        file: 'daycare_points.json',
        defaultVisible: false,
        idField: 'id',
        nameField: 'name',
        townField: 'town',
        addressField: 'address',
        phoneField: 'phone',
        countLabel: '日照',
        groupLabel: '日照中心',
        emptyText: '本區尚無日照與小規機構',
        categoryFields: [
            { field: 'case_type', tagClass: 'tag-case' },
            { field: 'service_type', tagClass: 'tag-service' }
        ],
        popupFields: [
            { field: 'town', label: '服務地區' },
            { field: 'case_type', label: '個案類型' },
            { field: 'service_type', label: '服務類型' },
            { field: 'work_type', label: '業務類型' },
            { field: 'staff_count', label: '人力數', suffix: ' 人' },
            { field: 'shade_info', label: '遮蔭資訊' },
            { field: 'phone', label: '聯絡電話' },
            { field: 'address', label: '機構地址' },
            { field: 'risk_note', label: '風險註記', type: 'risk' },
            { field: 'adaptation_action', label: '調適作為', type: 'action' }
        ],
        listFields: [
            { field: 'phone', icon: 'fa-phone' },
            { field: 'address', icon: 'fa-map-location-dot' },
            { field: 'work_type', icon: 'fa-briefcase' },
            { field: 'staff_count', icon: 'fa-users', suffix: ' 人' },
            { field: 'shade_info', icon: 'fa-tree' },
            { field: 'risk_note', icon: 'fa-triangle-exclamation', type: 'risk' },
            { field: 'adaptation_action', icon: 'fa-screwdriver-wrench', type: 'action' }
        ],
        marker: {
            colorField: 'case_type',
            colorMap: caseColors,
            fallbackColor: '#94a3b8'
        }
    },
    envHq: {
        id: 'envHq',
        label: '清潔隊隊部',
        shortLabel: '隊部',
        icon: 'fa-truck',
        file: 'env_facilities.json',
        defaultVisible: false,
        filterCategory: '清潔隊部',
        idField: 'id',
        nameField: 'name',
        townField: 'town',
        addressField: 'address',
        countLabel: '隊部',
        groupLabel: '環保設施',
        categoryFields: [
            { field: 'category', tagClass: 'tag-service' },
            { field: 'sub_type', tagClass: 'tag-case' }
        ],
        popupFields: [
            { field: 'town', label: '所在鄉鎮' },
            { field: 'category', label: '設施類別' },
            { field: 'sub_type', label: '設施型態' },
            { field: 'shade_info', label: '遮蔭資訊' },
            { field: 'phone', label: '聯絡電話' },
            { field: 'address', label: '位置地址' },
            { field: 'note', label: '資料註記' }
        ],
        listFields: [
            { field: 'sub_type', icon: 'fa-briefcase' },
            { field: 'shade_info', icon: 'fa-tree' },
            { field: 'phone', icon: 'fa-phone' },
            { field: 'address', icon: 'fa-map-location-dot' },
            { field: 'note', icon: 'fa-circle-info' }
        ],
        marker: {
            color: '#f59e0b',
            fallbackColor: '#f59e0b'
        }
    },
    envRecycling: {
        id: 'envRecycling',
        label: '資源回收場',
        shortLabel: '回收場',
        icon: 'fa-recycle',
        file: 'env_facilities.json',
        defaultVisible: true,
        filterCategory: '資源回收場',
        idField: 'id',
        nameField: 'name',
        townField: 'town',
        addressField: 'address',
        countLabel: '回收場',
        groupLabel: '環保設施',
        categoryFields: [
            { field: 'category', tagClass: 'tag-service' },
            { field: 'sub_type', tagClass: 'tag-case' }
        ],
        popupFields: [
            { field: 'town', label: '所在鄉鎮' },
            { field: 'category', label: '設施類別' },
            { field: 'sub_type', label: '設施型態' },
            { field: 'shade_info', label: '遮蔭資訊' },
            { field: 'phone', label: '聯絡電話' },
            { field: 'address', label: '位置地址' },
            { field: 'note', label: '資料註記' }
        ],
        listFields: [
            { field: 'sub_type', icon: 'fa-briefcase' },
            { field: 'shade_info', icon: 'fa-tree' },
            { field: 'phone', icon: 'fa-phone' },
            { field: 'address', icon: 'fa-map-location-dot' },
            { field: 'note', icon: 'fa-circle-info' }
        ],
        marker: {
            color: '#10b981',
            fallbackColor: '#10b981'
        }
    },
    envFacilities: {
        id: 'envFacilities',
        label: '環保設施合計',
        shortLabel: '環保',
        icon: 'fa-map-pin',
        file: 'env_facilities.json',
        defaultVisible: false,
        idField: 'id',
        nameField: 'name',
        townField: 'town',
        addressField: 'address',
        countLabel: '環保設施',
        showInSelector: false,
        categoryFields: [
            { field: 'category', tagClass: 'tag-service' },
            { field: 'sub_type', tagClass: 'tag-case' }
        ],
        popupFields: [
            { field: 'town', label: '所在鄉鎮' },
            { field: 'category', label: '設施類別' },
            { field: 'sub_type', label: '設施型態' },
            { field: 'shade_info', label: '遮蔭資訊' },
            { field: 'phone', label: '聯絡電話' },
            { field: 'address', label: '位置地址' },
            { field: 'note', label: '資料註記' }
        ],
        listFields: [
            { field: 'category', icon: 'fa-layer-group' },
            { field: 'sub_type', icon: 'fa-briefcase' },
            { field: 'shade_info', icon: 'fa-tree' },
            { field: 'phone', icon: 'fa-phone' },
            { field: 'address', icon: 'fa-map-location-dot' },
            { field: 'note', icon: 'fa-circle-info' }
        ],
        marker: {
            colorField: 'category',
            colorMap: { '清潔隊部': '#f59e0b', '資源回收場': '#10b981' },
            fallbackColor: '#34d399'
        }
    }
};

Object.values(POINT_REGISTRY).forEach(config => {
    if (config.defaultVisible) activePointLayerIds.add(config.id);
});

function normalizeActivePointLayerSelection(changedLayerId = null) {
    const hasAggregate = activePointLayerIds.has(AGGREGATE_POINT_LAYER_ID);
    const activeSplitIds = SPLIT_ENV_POINT_LAYER_IDS.filter(id => activePointLayerIds.has(id));

    if (!hasAggregate || activeSplitIds.length === 0) return;

    if (changedLayerId === AGGREGATE_POINT_LAYER_ID) {
        activeSplitIds.forEach(id => activePointLayerIds.delete(id));
        return;
    }

    activePointLayerIds.delete(AGGREGATE_POINT_LAYER_ID);
}

// Document Ready
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    setupUIControls();
    loadData();
});

// ==========================================================================
// Map Setup & Base Layers
// ==========================================================================
function initMap() {
    // Initialize map centered on Changhua County
    map = L.map('map', {
        zoomControl: false, // Custom position instead
        attributionControl: false
    }).setView([23.97, 120.46], 10.5);

    // 新增: 初始化 LayerManager 與載入色階
    layerManager = new LayerManager(map);
    climateGridManager.initConfig();

    // Create custom panes for proper layering
    map.createPane('towns');
    map.getPane('towns').style.zIndex = 300;

    map.createPane('labels');
    map.getPane('labels').style.zIndex = 350;
    map.getPane('labels').style.pointerEvents = 'none'; // Ensure click-through for labels layer

    // Theme-aware base map and label layers.
    applyMapTileTheme(getSavedColorTheme());

    // Zoom control at bottom right
    L.control.zoom({
        position: 'bottomleft'
    }).addTo(map);

    // Add Legend Control
    addLegend();
}

// ==========================================================================
// Data Fetching & Parsing
// ==========================================================================
function loadData() {
    // Fetch pre-calibrated geojson files directly (clean baseline data with correct temperature fields)
    const pointLoaders = Object.values(POINT_REGISTRY).map(config =>
        fetch(`${config.file}?t=${new Date().getTime()}`)
            .then(res => {
                if (!res.ok) throw new Error(`${config.file} ${res.status}`);
                return res.json();
            })
            .then(data => ({ id: config.id, data }))
            .catch(err => {
                console.warn(`Point dataset skipped: ${config.file}`, err);
                activePointLayerIds.delete(config.id);
                return { id: config.id, data: null };
            })
    );

    Promise.all([
        fetch(`data/changhua_towns.json?t=${new Date().getTime()}`).then(res => res.json()),
        Promise.all(pointLoaders)
    ]).then(([towns, pointResults]) => {
        originalTownGeoJson = towns;
        originalPointDatasets = {};
        pointResults.forEach(result => {
            if (result.data) originalPointDatasets[result.id] = result.data;
        });
        originalDaycarePoints = originalPointDatasets.daycare || null;
        renderPointLayerSelector();

        // Render the initial, standardized GIS data.
        refreshStandardizedData();
    }).catch(err => {
        console.error('Error loading GIS data:', err);
    });
}

// ==========================================================================
// Data Refresh
// ==========================================================================
let activeWraData = null;

async function refreshStandardizedData() {
    if (!originalTownGeoJson) return;

    townGeoJsonData = JSON.parse(JSON.stringify(originalTownGeoJson));
    pointDatasets = {};
    Object.entries(originalPointDatasets).forEach(([id, data]) => {
        pointDatasets[id] = JSON.parse(JSON.stringify(data));
    });
    daycarePointsData = pointDatasets.daycare || null;

    activeWraData = null;
    if (isWraLayerEnabled()) {
        const originalWra = getActiveWraScenario() === 'gwl20' ? wraGeoJson650 : wraGeoJson350;
        if (originalWra) {
            activeWraData = JSON.parse(JSON.stringify(originalWra));
            annotateWraFeatureBBoxes(activeWraData);
        }
    }

    await updateLayers();
    updateStatsAndChart();
    populatePointList();
}

// ==========================================================================
// Risk Field Helper
// ==========================================================================
function getActiveRiskField() {
    if (activeTheme === 'flood') {
        // Flood supports current and gwl15 (which maps to flood_risk_future)
        return activeScenario === 'current' ? 'flood_risk_current' : 'flood_risk_future';
    } else {
        // Temp township values are retained only as a legacy administrative reference/fallback.
        return `temp_risk_mean_${activeScenario}`;
    }
}

function getActiveHazardField() {
    if (activeTheme === 'flood') {
        return activeScenario === 'current' ? 'flood_hazard_current' : 'flood_hazard_future';
    } else {
        if (activeScenario === 'current') return 'temp_hazard_current';
        if (activeScenario === 'gwl15') return 'temp_hazard_gwl15';
        if (activeScenario === 'gwl20') return 'temp_hazard_gwl20';
        if (activeScenario === 'gwl40') return 'temp_hazard_gwl40';
        return 'temp_hazard_current';
    }
}

function getActiveVulnerabilityField() {
    return activeTheme === 'flood' ? 'flood_vulnerability' : 'temp_vulnerability';
}

// ==========================================================================
// Layer Rendering & Styling
// ==========================================================================
// ==========================================================================
// Spatial Point-in-Polygon Check for Daycares
// ==========================================================================
function isPointInMultiPolygon(x, y, coordinates) {
    for (let poly of coordinates) {
        let exterior = poly[0];
        // BBox optimization
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let pt of exterior) {
            if (pt[0] < minX) minX = pt[0];
            if (pt[0] > maxX) maxX = pt[0];
            if (pt[1] < minY) minY = pt[1];
            if (pt[1] > maxY) maxY = pt[1];
        }
        if (x < minX || x > maxX || y < minY || y > maxY) {
            continue;
        }
        // Ray casting
        let inside = false;
        let n = exterior.length;
        let p1x = exterior[0][0], p1y = exterior[0][1];
        for (let i = 0; i <= n; i++) {
            let p2 = exterior[i % n];
            let p2x = p2[0], p2y = p2[1];
            if (y > Math.min(p1y, p2y)) {
                if (y <= Math.max(p1y, p2y)) {
                    if (x <= Math.max(p1x, p2x)) {
                        if (p1y !== p2y) {
                            var xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x;
                        }
                        if (p1x === p2x || x <= xinters) {
                            inside = !inside;
                        }
                    }
                }
            }
            p1x = p2x;
            p1y = p2y;
        }
        if (inside) {
            let inHole = false;
            for (let j = 1; j < poly.length; j++) {
                let hole = poly[j];
                let hInside = false;
                let hn = hole.length;
                let hp1x = hole[0][0], hp1y = hole[0][1];
                for (let k = 0; k <= hn; k++) {
                    let hp2 = hole[k % hn];
                    let hp2x = hp2[0], hp2y = hp2[1];
                    if (y > Math.min(hp1y, hp2y)) {
                        if (y <= Math.max(hp1y, hp2y)) {
                            if (x <= Math.max(hp1x, hp2x)) {
                                if (hp1y !== hp2y) {
                                    var hxinters = (y - hp1y) * (hp2x - hp1x) / (hp2y - hp1y) + hp1x;
                                }
                                if (hp1x === hp2x || x <= hxinters) {
                                    hInside = !hInside;
                                }
                            }
                        }
                    }
                    hp1x = hp2x;
                    hp1y = hp2y;
                }
                if (hInside) {
                    inHole = true;
                    break;
                }
            }
            if (!inHole) return true;
        }
    }
    return false;
}

const WRA_PROXIMITY_RADIUS_METERS = 100;

function degreesToMetersDelta(dx, dy, latitude) {
    const latMeters = dy * 111320;
    const lngMeters = dx * 111320 * Math.cos(latitude * Math.PI / 180);
    return { x: lngMeters, y: latMeters };
}

function distancePointToSegmentMeters(px, py, ax, ay, bx, by) {
    const latitude = (py + ay + by) / 3;
    const a = degreesToMetersDelta(ax - px, ay - py, latitude);
    const b = degreesToMetersDelta(bx - px, by - py, latitude);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abLengthSquared = abx * abx + aby * aby;

    if (abLengthSquared === 0) {
        return Math.hypot(a.x, a.y);
    }

    const t = Math.max(0, Math.min(1, -(a.x * abx + a.y * aby) / abLengthSquared));
    const closestX = a.x + t * abx;
    const closestY = a.y + t * aby;
    return Math.hypot(closestX, closestY);
}

function distancePointToRingMeters(x, y, ring) {
    let minDistance = Infinity;
    for (let i = 0; i < ring.length - 1; i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[i + 1];
        minDistance = Math.min(minDistance, distancePointToSegmentMeters(x, y, ax, ay, bx, by));
    }
    return minDistance;
}

function expandBBoxByMeters(bbox, meters) {
    const centerLat = (bbox.minY + bbox.maxY) / 2;
    const latDelta = meters / 111320;
    const lngDelta = meters / (111320 * Math.cos(centerLat * Math.PI / 180));
    return {
        minX: bbox.minX - lngDelta,
        minY: bbox.minY - latDelta,
        maxX: bbox.maxX + lngDelta,
        maxY: bbox.maxY + latDelta
    };
}

function getCoordinateBBox(coordinates, bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }) {
    if (typeof coordinates?.[0] === 'number') {
        const [x, y] = coordinates;
        bbox.minX = Math.min(bbox.minX, x);
        bbox.minY = Math.min(bbox.minY, y);
        bbox.maxX = Math.max(bbox.maxX, x);
        bbox.maxY = Math.max(bbox.maxY, y);
        return bbox;
    }

    (coordinates || []).forEach(child => getCoordinateBBox(child, bbox));
    return bbox;
}

function collectPolygonRings(coordinates) {
    return (coordinates || []).flatMap(polygon => polygon || []);
}

function isPointInPolygonRings(x, y, polygon) {
    return isPointInMultiPolygon(x, y, [polygon]);
}

function annotateWraFeatureBBoxes(geojson) {
    (geojson?.features || []).forEach(feature => {
        if (!feature.geometry?.coordinates) return;

        const geometry = feature.geometry;
        const coordinates = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return;

        const bbox = getCoordinateBBox(coordinates);
        feature._bbox = bbox;
        feature._proximityBBox = expandBBoxByMeters(bbox, WRA_PROXIMITY_RADIUS_METERS);
        feature._polygons = (coordinates || []).map(polygon => ({
            polygon,
            bbox: getCoordinateBBox(polygon)
        }));
        feature._rings = collectPolygonRings(coordinates).map(ring => {
            const ringBBox = getCoordinateBBox(ring);
            return {
                ring,
                bbox: ringBBox,
                proximityBBox: expandBBoxByMeters(ringBBox, WRA_PROXIMITY_RADIUS_METERS)
            };
        });
    });
}

function isPointInBBox(x, y, bbox) {
    return Boolean(bbox) && x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY;
}

function isPointInWraFeature(x, y, feature) {
    for (const item of feature._polygons || []) {
        if (!isPointInBBox(x, y, item.bbox)) continue;
        if (isPointInPolygonRings(x, y, item.polygon)) return true;
    }
    return false;
}

function distancePointToWraFeatureMeters(x, y, feature) {
    let minDistance = Infinity;
    for (const item of feature._rings || []) {
        if (!isPointInBBox(x, y, item.proximityBBox)) continue;
        minDistance = Math.min(minDistance, distancePointToRingMeters(x, y, item.ring));
    }
    return minDistance;
}

function getWraGridCodeFromDepth(depth) {
    if (depth === '0.3-0.5') return 2;
    if (depth === '0.5-1') return 3;
    if (depth === '1-2') return 4;
    if (depth === '2-3') return 5;
    if (depth === '>3') return 6;
    return 2;
}

function getWraPointRisk(feature, config) {
    return daycareIntersectResults[getPointKey(feature, config)] || null;
}

function getWraPointDepth(feature, config) {
    return getWraPointRisk(feature, config)?.depth || '';
}

function formatWraRiskLabel(result) {
    if (!result) return '';
    if (result.method === 'direct') return `${result.depth} 公尺（直接套疊）`;
    return `${result.depth} 公尺（鄰近 ${Math.round(result.distanceMeters)}m，加權 ${Math.round(result.weight * 100)}%）`;
}

function getConfigValue(config, key, fallback = null) {
    return config[key] || fallback;
}

function getFeatureValue(props, field) {
    if (!field) return '';
    const value = props[field];
    return value === undefined || value === null ? '' : value;
}

function hasDisplayValue(value) {
    return value !== undefined && value !== null && String(value).trim() !== '';
}

function getFeatureId(feature, config) {
    const props = feature.properties || {};
    return String(getFeatureValue(props, config.idField) || getFeatureValue(props, config.nameField));
}

function getFeatureName(feature, config) {
    return getFeatureValue(feature.properties || {}, config.nameField) || '未命名點位';
}

function getFeatureDeclaredTown(feature, config) {
    return getFeatureValue(feature.properties || {}, config.townField);
}

function getFeatureCoordinates(feature) {
    return feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
}

function getFeatureSpatialTown(feature) {
    const coords = getFeatureCoordinates(feature);
    if (!coords || !townGeoJsonData) return '';

    const [x, y] = coords;
    for (const townFeature of townGeoJsonData.features || []) {
        const geometry = townFeature.geometry;
        if (!geometry) continue;

        const coordinates = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') continue;

        if (isPointInMultiPolygon(x, y, coordinates)) {
            return townFeature.properties?.town_name || '';
        }
    }

    return '';
}

function getFeatureTown(feature, config) {
    return getFeatureSpatialTown(feature) || getFeatureDeclaredTown(feature, config);
}

function getPointKey(feature, config) {
    return `${config.id}:${getFeatureId(feature, config)}`;
}

function getTownRiskMap() {
    const riskField = getActiveRiskField();
    const townRisks = {};
    if (!townGeoJsonData) return townRisks;
    townGeoJsonData.features.forEach(feat => {
        townRisks[feat.properties.town_name] = feat.properties[riskField] || 1;
    });
    return townRisks;
}



function getClimateGridRiskLevel(value) {
    const config = climateGridManager?.colorScaleConfig?.[activeClimateIndicator];
    if (value === null || value === undefined || value === -99.9 || !config?.breaks || !config?.colors) return null;

    let binIndex = config.breaks.findIndex(breakValue => value <= breakValue);
    if (binIndex === -1) binIndex = config.colors.length - 1;

    return Math.min(5, Math.max(1, Math.ceil(((binIndex + 1) / config.colors.length) * 5)));
}

function getClimateGridFeatureRisk(feature) {
    if (!isClimateGridRiskMode() || !activeClimateGridDataState) return null;

    const coords = getFeatureCoordinates(feature);
    if (!coords) return null;

    const [x, y] = coords;
    const { geojson, values, indicator, scenario, model, year } = activeClimateGridDataState;
    for (const gridFeature of geojson?.features || []) {
        const geometry = gridFeature.geometry;
        if (!geometry) continue;

        const coordinates = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') continue;
        if (!isPointInMultiPolygon(x, y, coordinates)) continue;

        const gridId = gridFeature.properties?.GridID;
        const value = values?.[gridId];
        const risk = getClimateGridRiskLevel(value);
        if (!risk) return null;

        return { risk, value, gridId, indicator, scenario, model, year };
    }

    return null;
}

function getNcdrFeatureRisk(feature, config) {
    const town = getFeatureTown(feature, config);
    return getTownRiskMap()[town] || 1;
}

function getWraFeatureRisk(feature, config) {
    const wraRisk = getWraPointRisk(feature, config);
    if (!wraRisk) return 1;

    // WRA depth classes are stored as grid codes 2-6. For point-level risk display,
    // normalize them to the same 1-5 scale used by township risks:
    // no intersection = 1, 0.3-0.5m = 2, 0.5-1m = 3, 1-2m = 4, >=2m = 5.
    const directLevel = Math.min(wraRisk.gridCode || getWraGridCodeFromDepth(wraRisk.depth), 5);
    if (wraRisk.method === 'direct') return directLevel;

    // Nearby-but-not-overlapping polygons should not be treated as full direct
    // inundation. Keep the warning visible, but taper the risk level by distance
    // within the 100m buffer so the rendered marker updates more realistically.
    return Math.max(1, Math.round(1 + ((directLevel - 1) * (wraRisk.weight || 0))));
}

function getFeatureRiskAssessment(feature, config) {
    if (activeTheme === 'temp') {
        const ncdrRisk = getNcdrFeatureRisk(feature, config);
        if (!isClimateGridRiskMode()) {
            return {
                risk: ncdrRisk || 1,
                ncdrRisk: ncdrRisk || 1,
                climateGridRisk: null,
                source: '行政區風險（未呈現網格）',
                mode: 'ncdr_manual'
            };
        }

        const climateGridRisk = getClimateGridFeatureRisk(feature);
        if (climateGridRisk) {
            return {
                risk: climateGridRisk.risk,
                ncdrRisk,
                climateGridRisk,
                source: '氣候網格',
                mode: 'climate_grid'
            };
        }

        return {
            risk: ncdrRisk || 1,
            ncdrRisk: ncdrRisk || 1,
            climateGridRisk: null,
            source: '鄉鎮市風險（無網格資料）',
            mode: 'ncdr_fallback'
        };
    }

    const hasNcdr = isNcdrLayerEnabled();
    const hasWra = isWraLayerEnabled();
    const ncdrRisk = hasNcdr ? getNcdrFeatureRisk(feature, config) : null;
    const wraRisk = hasWra ? getWraFeatureRisk(feature, config) : null;

    if (hasNcdr && hasWra) {
        const risk = Math.max(ncdrRisk || 1, wraRisk || 1);
        return { risk, ncdrRisk, wraRisk, source: '綜合套疊', mode: 'combined' };
    }

    if (hasWra) return { risk: wraRisk || 1, ncdrRisk: null, wraRisk: wraRisk || 1, source: '水利署潛勢', mode: 'wra' };
    return { risk: ncdrRisk || 1, ncdrRisk: ncdrRisk || 1, wraRisk: null, source: '鄉鎮市潛勢', mode: 'ncdr' };
}

function getFeatureRisk(feature, config) {
    return getFeatureRiskAssessment(feature, config).risk;
}

function getFeatureTownMismatch(feature, config) {
    const declaredTown = getFeatureDeclaredTown(feature, config);
    const spatialTown = getFeatureSpatialTown(feature);
    if (!declaredTown || !spatialTown || declaredTown === spatialTown) return null;
    return { declaredTown, spatialTown };
}

function filterPointDataset(dataset, config) {
    if (!config.filterCategory) return dataset;
    return {
        ...dataset,
        features: (dataset.features || []).filter(feature => feature.properties?.category === config.filterCategory)
    };
}

function getActivePointEntries() {
    return Object.values(POINT_REGISTRY)
        .filter(config => activePointLayerIds.has(config.id) && pointDatasets[config.id])
        .map(config => ({ config, dataset: filterPointDataset(pointDatasets[config.id], config) }));
}

function getActivePointFeatures() {
    return getActivePointEntries().flatMap(({ config, dataset }) =>
        dataset.features.map(feature => ({ config, feature }))
    );
}

function computeIntersections() {
    daycareIntersectResults = {};
    if (activeTheme === 'flood' && activeFloodLayers.wra && activeWraData) {
        getActivePointFeatures().forEach(({ config, feature }) => {
            const coords = getFeatureCoordinates(feature);
            if (!coords) return;

            const [x, y] = coords;
            let nearest = null;

            for (const feat of activeWraData.features || []) {
                const geometry = feat.geometry;
                if (!geometry) continue;

                const coordinates = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
                if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') continue;

                if (!isPointInBBox(x, y, feat._proximityBBox)) continue;

                const depth = feat.properties.depth_type;
                const gridCode = feat.properties.grid_code || getWraGridCodeFromDepth(depth);

                if (isPointInBBox(x, y, feat._bbox) && isPointInWraFeature(x, y, feat)) {
                    daycareIntersectResults[getPointKey(feature, config)] = {
                        depth,
                        gridCode,
                        method: 'direct',
                        distanceMeters: 0,
                        weight: 1
                    };
                    return;
                }

                const distanceMeters = distancePointToWraFeatureMeters(x, y, feat);
                if (distanceMeters <= WRA_PROXIMITY_RADIUS_METERS && (!nearest || distanceMeters < nearest.distanceMeters)) {
                    nearest = { depth, gridCode, method: 'proximity', distanceMeters };
                }
            }

            if (nearest) {
                const weight = Math.max(0, 1 - (nearest.distanceMeters / WRA_PROXIMITY_RADIUS_METERS));
                daycareIntersectResults[getPointKey(feature, config)] = { ...nearest, weight };
            }
        });
    }
}

// ==========================================================================
// Layer Rendering & Styling
// ==========================================================================
async function updateLayers() {
    if (!townGeoJsonData) return;

    const renderRequestId = ++layerRenderRequestId;

    // 1. Remove existing layers
    if (townLayer) map.removeLayer(townLayer);
    if (daycareLayer) map.removeLayer(daycareLayer);
    if (wraLayer) map.removeLayer(wraLayer);
    if (climateGridManager && climateGridManager.currentLayer) {
        map.removeLayer(climateGridManager.currentLayer);
        climateGridManager.currentLayer = null;
    }
    Object.values(pointLayers).forEach(layer => map.removeLayer(layer));
    pointLayers = {};

    // Compute spatial intersections first
    computeIntersections();

    // 2. Renders WRA Layer if active
    if (activeTheme === 'flood' && activeFloodLayers.wra && activeWraData) {
        wraLayer = L.geoJSON(activeWraData, {
            style: (feature) => {
                const gridCode = feature.properties.grid_code || 2;
                return {
                    fillColor: wraColors[gridCode] || '#93c5fd',
                    fillOpacity: 0.65,
                    color: 'rgba(255,255,255,0.1)',
                    weight: 0.8
                };
            },
            onEachFeature: (feature, layer) => {
                const depth = feature.properties.depth_type || '';
                layer.bindPopup(`<div class="popup-container" style="padding: 4px;"><h4 style="margin: 0 0 4px 0; color: #60a5fa;"><i class="fa-solid fa-water"></i> 水利署淹水潛勢</h4>淹水深度：<strong>${depth} 公尺</strong></div>`);
            }
        }).addTo(map);
    }

    const isNcdrVisible = isNcdrLayerEnabled();

    // 3. Add Town Polygons (Transparent if Climate Grid is active, else original logic)
    townLayer = L.geoJSON(townGeoJsonData, {
        pane: layerManager ? layerManager.getPane('administrative') : 'towns',
        style: (feature) => {
            if (!isNcdrVisible) {
                return {
                    fillColor: 'transparent',
                    fillOpacity: 0,
                    color: 'rgba(255,255,255,0.3)',
                    weight: 1.5,
                    dashArray: '3, 4',
                    className: 'town-boundary'
                };
            } else {
                const riskField = getActiveRiskField();
                const riskVal = feature.properties[riskField] || 1;
                return {
                    fillColor: riskColors[riskVal] || '#cccccc',
                    fillOpacity: getTownRiskFillOpacity(),
                    color: 'rgba(255,255,255,0.15)',
                    weight: 1.5,
                    className: 'town-boundary'
                };
            }
        },
        interactive: isNcdrVisible,
        onEachFeature: isNcdrVisible ? onEachTownFeature : undefined
    }).addTo(map);

    activeClimateGridDataState = null;

    // 3.5. Render New Climate Grid if temp theme is active
    if (isClimateGridRiskMode() && climateGridManager) {
        const scenarioStr = getClimateScenarioCode(activeScenario);
        const year = scenarioStr === 'historical' && Number(activeClimateYear) > 2014 ? '2014' : activeClimateYear;
        const dataState = await climateGridManager.loadGridData("AR6_v112", activeClimateIndicator, scenarioStr, "TaiESM1", year);
        if (renderRequestId !== layerRenderRequestId) return;
        if (dataState) {
            activeClimateGridDataState = dataState;
            climateGridManager.renderToLeaflet(map, layerManager, dataState, { fillOpacity: riskMapOpacity });
        }
    } else if (climateGridManager && climateGridManager.currentLayer) {
        map.removeLayer(climateGridManager.currentLayer);
    }

    // 4. Add registry-driven business point markers
    renderPointLayers();
}

function getMarkerColor(feature, config) {
    const markerConfig = config.marker || {};
    if (markerConfig.color) return markerConfig.color;
    const value = getFeatureValue(feature.properties || {}, markerConfig.colorField);
    return (markerConfig.colorMap && markerConfig.colorMap[value]) || markerConfig.fallbackColor || '#94a3b8';
}

function createRiskOutlinedMarker(latlng, markerColor, riskVal, floodDepth) {
    const riskColor = riskColors[riskVal] || '#94a3b8';
    const isHighRisk = riskVal >= 4;
    const isFlooded = Boolean(floodDepth);
    const radiusBoost = isFlooded || isHighRisk ? 1.5 : 0;

    const outerWhiteRing = L.circleMarker(latlng, {
        radius: 10 + radiusBoost,
        fill: false,
        color: '#ffffff',
        weight: 4,
        opacity: 0.98,
        interactive: false,
        className: 'point-outer-ring'
    });

    const riskRing = L.circleMarker(latlng, {
        radius: 8 + radiusBoost,
        fill: false,
        color: riskColor,
        weight: isHighRisk ? 4 : 3,
        opacity: 1,
        interactive: false,
        className: 'point-risk-ring'
    });

    const coreMarker = L.circleMarker(latlng, {
        radius: 5.5 + radiusBoost,
        fillColor: markerColor,
        fillOpacity: 0.95,
        color: isFlooded ? '#ef4444' : '#ffffff',
        weight: isFlooded ? 2.5 : 1.5,
        opacity: 1,
        className: isFlooded ? 'daycare-marker warning-pulse' : 'daycare-marker'
    });

    return L.featureGroup([outerWhiteRing, riskRing, coreMarker]);
}

function renderPointLayers() {
    getActivePointEntries().forEach(({ config, dataset }) => {
        pointLayers[config.id] = L.geoJSON(dataset, {
            pointToLayer: (feature, latlng) => {
                const markerColor = getMarkerColor(feature, config);
                const floodDepth = getWraPointDepth(feature, config);
                const riskVal = getFeatureRisk(feature, config);

                return createRiskOutlinedMarker(latlng, markerColor, riskVal, floodDepth);
            },
            onEachFeature: (feature, layer) => onEachPointFeature(feature, layer, config)
        }).addTo(map);
    });

    daycareLayer = pointLayers.daycare || null;
}

// Interactive events for town polygons
function onEachTownFeature(feature, layer) {
    layer.on({
        mouseover: highlightFeature,
        mouseout: resetHighlight,
        click: selectTownFeature
    });
}

function highlightFeature(e) {
    const layer = e.target;
    layer.setStyle({
        weight: 3,
        color: '#ffffff',
        fillOpacity: isNcdrLayerEnabled() ? getTownRiskHighlightOpacity() : 0.05
    });

    // Update Map Info Widget
    updateInfoWidget(layer.feature.properties);
}

function resetHighlight(e) {
    townLayer.resetStyle(e.target);
    clearInfoWidget();
}

function selectTownFeature(e) {
    const layer = e.target;
    const townName = layer.feature.properties.town_name;

    if (selectedTown === townName) {
        selectedTown = null; // Toggle off
        document.getElementById('town-selected-name').innerText = '(全縣)';
    } else {
        selectedTown = townName;
        document.getElementById('town-selected-name').innerText = `(${townName})`;
    }

    // Zoom/Pan slightly
    map.panTo(e.latlng);

    populatePointList();

    // Auto-expand mobile drawer if collapsed when selecting a town
    const container = document.querySelector('.app-container');
    const toggleIcon = document.getElementById('mobile-toggle-icon');
    if (window.innerWidth <= 768 && container && container.classList.contains('sidebar-collapsed')) {
        container.classList.remove('sidebar-collapsed');
        if (toggleIcon) {
            toggleIcon.className = 'fa-solid fa-chevron-down';
        }
    }
}

// Popup configuration for registry-driven point markers
function onEachPointFeature(feature, layer, config) {
    const props = feature.properties;

    let warningHtml = '';
    const wraRisk = getWraPointRisk(feature, config);
    if (activeTheme === 'flood' && activeFloodLayers.wra && wraRisk) {
        warningHtml = `
            <div class="popup-row" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 4px; padding: 4px 8px; margin-top: 4px; margin-bottom: 8px;">
                <span class="popup-label" style="color: #ef4444; font-weight: bold;"><i class="fa-solid fa-triangle-exclamation"></i> ${wraRisk.method === 'direct' ? '淹水警戒' : '鄰近淹水潛勢'}</span>
                <span class="popup-val" style="color: #ef4444; font-weight: bold;">${formatWraRiskLabel(wraRisk)}</span>
            </div>
        `;
    }

    const riskAssessment = getFeatureRiskAssessment(feature, config);
    const riskVal = riskAssessment.risk;
    const resolvedTown = getFeatureTown(feature, config);
    const townMismatch = getFeatureTownMismatch(feature, config);
    const riskHtml = `
        <div class="popup-row">
            <span class="popup-label">地理所屬鄉鎮</span>
            <span class="popup-val">${resolvedTown || '無法判定'}</span>
        </div>
        <div class="popup-row">
            <span class="popup-label">所處風險</span>
            <span class="popup-val risk-badge badge-${riskVal}">第 ${riskVal} 級（${riskAssessment.source}）</span>
        </div>
        ${riskAssessment.mode === 'combined' ? `<div class="popup-row"><span class="popup-label">套疊明細</span><span class="popup-val">鄉鎮市第 ${riskAssessment.ncdrRisk} 級；水利署第 ${riskAssessment.wraRisk} 級，取較高者</span></div>` : ''}
        ${riskAssessment.mode === 'climate_grid' ? `<div class="popup-row"><span class="popup-label">網格明細</span><span class="popup-val">${riskAssessment.climateGridRisk.indicator} ${riskAssessment.climateGridRisk.value.toFixed(2)}；Grid ${riskAssessment.climateGridRisk.gridId}</span></div>` : ''}
        ${riskAssessment.mode === 'ncdr_fallback' ? `<div class="popup-row"><span class="popup-label">判定註記</span><span class="popup-val">此點位無可用網格值，改用行政區風險配對</span></div>` : ''}
        ${townMismatch ? `<div class="popup-row"><span class="popup-label">資料鄉鎮註記</span><span class="popup-val">${townMismatch.declaredTown}（依座標改以 ${townMismatch.spatialTown} 判定風險）</span></div>` : ''}
    `;

    const rowsHtml = (config.popupFields || []).map(fieldConfig => {
        const value = getFeatureValue(props, fieldConfig.field);
        if (!hasDisplayValue(value)) return '';
        const text = `${value}${fieldConfig.suffix || ''}`;
        if (fieldConfig.type === 'risk' || fieldConfig.type === 'action') {
            const noteClass = fieldConfig.type === 'risk' ? 'popup-note-risk' : 'popup-note-action';
            return `<div class="popup-note ${noteClass}"><strong>${fieldConfig.label}</strong><br>${text}</div>`;
        }
        return `
            <div class="popup-row">
                <span class="popup-label">${fieldConfig.label}</span>
                <span class="popup-val">${text}</span>
            </div>
        `;
    }).join('');

    const content = `
        <div class="popup-container">
            <h3 class="popup-title"><i class="fa-solid ${config.icon}"></i> ${getFeatureName(feature, config)}</h3>
            ${warningHtml}
            ${riskHtml}
            ${rowsHtml}
        </div>
    `;
    layer.bindPopup(content, { maxWidth: 340 });
}

// ==========================================================================
// Dashboard Widgets & Stats Updater
// ==========================================================================
function updateTotalPointCard() {
    const totalCard = document.querySelector('.total-centers');
    if (!totalCard) return;

    const totalLabel = totalCard.querySelector('.stat-label');
    const totalValue = totalCard.querySelector('.stat-value');
    const activeFeatures = getActivePointFeatures();

    totalLabel.innerText = `目前顯示${getActivePointSummaryLabel()}`;
    totalValue.innerText = activeFeatures.length;
}

function updateHighRiskCard(total, label) {
    const highRiskCard = document.querySelector('.high-risk-centers');
    if (!highRiskCard) return;

    const highRiskLabel = highRiskCard.querySelector('.stat-label');
    const highRiskValue = highRiskCard.querySelector('.stat-value');

    highRiskLabel.innerText = label;
    highRiskValue.innerText = total;

    if (total > 0) {
        highRiskCard.classList.add('warning-active');
        highRiskValue.style.color = '#ef4444';
    } else {
        highRiskCard.classList.remove('warning-active');
        highRiskValue.style.color = '';
    }
}

function getRiskDistribution() {
    let totalHighRisk = 0;
    const riskDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    getActivePointFeatures().forEach(({ config, feature }) => {
        const riskVal = getFeatureRisk(feature, config);

        riskDistribution[riskVal]++;
        if (riskVal >= 4) {
            totalHighRisk++;
        }
    });

    return { totalHighRisk, riskDistribution };
}

function getWraDepthDistribution() {
    let totalFlooded = 0;
    const depthDistribution = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

    getActivePointFeatures().forEach(({ config, feature }) => {
        const risk = getWraPointRisk(feature, config);
        if (risk) {
            totalFlooded++;
            depthDistribution[risk.gridCode || getWraGridCodeFromDepth(risk.depth)]++;
        }
    });

    return { totalFlooded, depthDistribution };
}

function updateStatsAndChart() {
    if (!townGeoJsonData) return;

    // Dynamically update the legend content
    updateLegendUI();
    updateTotalPointCard();

    if (activeTheme === 'temp') {
        const { totalHighRisk, riskDistribution } = getRiskDistribution();
        updateHighRiskCard(totalHighRisk, `網格高溫警戒${getActivePointSummaryLabel()} (Lv.4-5)`);
        renderChart(riskDistribution);
    } else if (isNcdrLayerEnabled()) {
        const { totalHighRisk, riskDistribution } = getRiskDistribution();
        const sourceLabel = isWraLayerEnabled() ? '綜合套疊' : '第 4-5 級';
        updateHighRiskCard(totalHighRisk, `${sourceLabel}警戒${getActivePointSummaryLabel()} (Lv.4-5)`);
        renderChart(riskDistribution);
    } else if (isWraLayerEnabled()) {
        // WRA-only mode has no NCDR Lv.4-5 towns, so summarize flooded daycare sites by depth.
        const { totalFlooded, depthDistribution } = getWraDepthDistribution();
        updateHighRiskCard(totalFlooded, `淹水警戒${getActivePointSummaryLabel()}`);
        renderChartWRA(depthDistribution);
    }
}

function getActivePointSummaryLabel() {
    const activeConfigs = Object.values(POINT_REGISTRY).filter(config => activePointLayerIds.has(config.id) && pointDatasets[config.id]);
    if (activeConfigs.length === 1) return activeConfigs[0].countLabel || activeConfigs[0].shortLabel || '點位';
    return '業務點位';
}

function renderChart(distributionData) {
    const ctx = document.getElementById('riskChart').getContext('2d');

    const chartLabels = ['第 1 級', '第 2 級', '第 3 級', '第 4 級', '第 5 級'];
    const chartData = [
        distributionData[1],
        distributionData[2],
        distributionData[3],
        distributionData[4],
        distributionData[5]
    ];

    if (riskChart) {
        riskChart.data.labels = chartLabels;
        riskChart.data.datasets[0].label = '機構數量';
        riskChart.data.datasets[0].data = chartData;
        riskChart.data.datasets[0].backgroundColor = [
            riskColors[1],
            riskColors[2],
            riskColors[3],
            riskColors[4],
            riskColors[5]
        ];
        riskChart.update();
    } else {
        riskChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: chartLabels,
                datasets: [{
                    label: '機構數量',
                    data: chartData,
                    backgroundColor: [
                        riskColors[1],
                        riskColors[2],
                        riskColors[3],
                        riskColors[4],
                        riskColors[5]
                    ],
                    borderRadius: 4,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { color: getChartThemeColors().tick, font: { size: 9 } }
                    },
                    y: {
                        grid: { color: getChartThemeColors().grid },
                        ticks: { color: getChartThemeColors().tick, font: { size: 9 }, stepSize: 5 }
                    }
                }
            }
        });
    }
}

function renderChartWRA(distribution) {
    const chartLabels = ['0.3-0.5m', '0.5-1m', '1-2m', '2-3m', '>3m'];
    const chartData = [
        distribution[2],
        distribution[3],
        distribution[4],
        distribution[5],
        distribution[6]
    ];

    if (riskChart) {
        riskChart.data.labels = chartLabels;
        riskChart.data.datasets[0].label = '警戒機構';
        riskChart.data.datasets[0].data = chartData;
        riskChart.data.datasets[0].backgroundColor = [
            wraColors[2],
            wraColors[3],
            wraColors[4],
            wraColors[5],
            wraColors[6]
        ];
        updateChartTheme();
    }
}

// Info Widget (Hover detail overlay)
function updateInfoWidget(props) {
    const infoDiv = document.getElementById('info-content');

    // Count active business points in this town
    const pointCount = getActivePointFeatures().filter(({ config, feature }) => getFeatureTown(feature, config) === props.town_name).length;

    if (isWraLayerEnabled()) {
        const floodedCount = getActivePointFeatures().filter(({ config, feature }) =>
            getFeatureTown(feature, config) === props.town_name && getWraPointRisk(feature, config)
        ).length;
        infoDiv.innerHTML = `
            <div class="hover-town-title">${props.town_name}</div>
            <div class="hover-stat-row">
                <span class="hover-stat-label">轄區內業務點位數</span>
                <span class="hover-stat-val" style="color: var(--secondary); font-weight: 700;">${pointCount} 處</span>
            </div>
            <div class="hover-stat-row" style="margin-top: 8px; border-top: 1px dashed rgba(239,68,68,0.3); padding-top: 8px;">
                <span class="hover-stat-label" style="color: #ef4444; font-weight: bold;">淹水警戒點位數</span>
                <span class="hover-stat-val risk-badge badge-5">${floodedCount} 處</span>
            </div>
        `;
    } else {
        const riskVal = props[getActiveRiskField()] || 1;
        const vulVal = props[getActiveVulnerabilityField()] || 1;

        if (activeTheme === 'temp') {
            const hazTempField = `temp_hazard_temp_${activeScenario}`;
            const hazDurField = `temp_hazard_dur_${activeScenario}`;
            const hazTempVal = props[hazTempField] || 1;
            const hazDurVal = props[hazDurField] || 1;

            infoDiv.innerHTML = `
                <div class="hover-town-title">${props.town_name}</div>
                <div class="hover-stat-row">
                    <span class="hover-stat-label">強度危害度 (Intensity Hazard)</span>
                    <span class="hover-stat-val risk-badge badge-${hazTempVal}">第 ${hazTempVal} 級</span>
                </div>
                <div class="hover-stat-row">
                    <span class="hover-stat-label">持續危害度 (Duration Hazard)</span>
                    <span class="hover-stat-val risk-badge badge-${hazDurVal}">第 ${hazDurVal} 級</span>
                </div>
                <div class="hover-stat-row">
                    <span class="hover-stat-label">脆弱度等級 (Vulnerability)</span>
                    <span class="hover-stat-val risk-badge badge-${vulVal}">第 ${vulVal} 級</span>
                </div>
                <div class="hover-stat-row">
                    <span class="hover-stat-label">綜合風險等級 (Risk)</span>
                    <span class="hover-stat-val risk-badge badge-${riskVal}">第 ${riskVal} 級</span>
                </div>
                <div class="hover-stat-row" style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px;">
                    <span class="hover-stat-label">轄區內業務點位數</span>
                    <span class="hover-stat-val" style="color: var(--secondary); font-weight: 700;">${pointCount} 處</span>
                </div>
            `;
        } else {
            const hazVal = props[getActiveHazardField()] || 1;
            infoDiv.innerHTML = `
                <div class="hover-town-title">${props.town_name}</div>
                <div class="hover-stat-row">
                    <span class="hover-stat-label">危害度等級 (Hazard)</span>
                    <span class="hover-stat-val risk-badge badge-${hazVal}">第 ${hazVal} 級</span>
                </div>
                <div class="hover-stat-row">
                    <span class="hover-stat-label">脆弱度等級 (Vulnerability)</span>
                    <span class="hover-stat-val risk-badge badge-${vulVal}">第 ${vulVal} 級</span>
                </div>
                <div class="hover-stat-row">
                    <span class="hover-stat-label">綜合風險等級 (Risk)</span>
                    <span class="hover-stat-val risk-badge badge-${riskVal}">第 ${riskVal} 級</span>
                </div>
                <div class="hover-stat-row" style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px;">
                    <span class="hover-stat-label">轄區內業務點位數</span>
                    <span class="hover-stat-val" style="color: var(--secondary); font-weight: 700;">${pointCount} 處</span>
                </div>
            `;
        }
    }
}

function clearInfoWidget() {
    const infoDiv = document.getElementById('info-content');
    infoDiv.innerHTML = `<p class="placeholder">懸停於行政區上以載入氣候風險指標...</p>`;
}

// Populate the active business point list inside the sidebar
function populatePointList() {
    const container = document.getElementById('daycare-list-container');
    container.innerHTML = '';

    const activeFeatures = getActivePointFeatures();

    let filtered = activeFeatures;
    if (selectedTown) {
        filtered = activeFeatures.filter(({ config, feature }) => getFeatureTown(feature, config) === selectedTown);
    }

    if (filtered.length === 0) {
        container.innerHTML = `<p class="list-placeholder">本區尚無啟用中的業務點位</p>`;
        return;
    }

    filtered.forEach(({ config, feature }) => {
        const feat = feature;
        const props = feat.properties;

        let warningTag = '';
        const wraRisk = getWraPointRisk(feat, config);
        if (activeTheme === 'flood' && activeFloodLayers.wra && wraRisk) {
            warningTag = `<span class="item-tag tag-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${wraRisk.method === 'direct' ? '淹水警戒' : '鄰近潛勢'}: ${formatWraRiskLabel(wraRisk)}</span>`;
        }

        const riskVal = getFeatureRisk(feat, config);
        const categoryTags = (config.categoryFields || []).map(fieldConfig => {
            const value = getFeatureValue(props, fieldConfig.field);
            if (!hasDisplayValue(value)) return '';
            return `<span class="item-tag ${fieldConfig.tagClass || 'tag-service'}">${value}</span>`;
        }).join('');
        const detailRows = (config.listFields || []).map(fieldConfig => {
            const value = getFeatureValue(props, fieldConfig.field);
            if (!hasDisplayValue(value)) return '';
            const text = `${value}${fieldConfig.suffix || ''}`;
            if (fieldConfig.type === 'risk' || fieldConfig.type === 'action') {
                const noteClass = fieldConfig.type === 'risk' ? 'item-note-risk' : 'item-note-action';
                return `<div class="item-note ${noteClass}"><i class="fa-solid ${fieldConfig.icon}"></i> ${text}</div>`;
            }
            return `
                <div class="daycare-item-detail">
                    <i class="fa-solid ${fieldConfig.icon}"></i> <span>${text}</span>
                </div>
            `;
        }).join('');

        const card = document.createElement('div');
        card.className = 'daycare-item-card';

        card.innerHTML = `
            <div class="daycare-item-title"><i class="fa-solid ${config.icon}"></i> ${getFeatureName(feat, config)}</div>
            <div class="daycare-item-tags">
                <span class="item-tag tag-warning">風險 ${riskVal}｜${getFeatureRiskAssessment(feat, config).source}</span>
                ${categoryTags}
                ${warningTag}
            </div>
            ${detailRows}
        `;

        // Click item zoom to marker and open popup
        card.addEventListener('click', () => {
            const coords = feat.geometry.coordinates;
            map.setView([coords[1], coords[0]], 14);

            const layerGroup = pointLayers[config.id];
            if (!layerGroup) return;
            layerGroup.eachLayer(layer => {
                if (getPointKey(layer.feature, config) === getPointKey(feat, config)) {
                    layer.openPopup();
                }
            });
        });

        container.appendChild(card);
    });
}

// ==========================================================================
// Lazy Loader for WRA Flood GeoJSON
// ==========================================================================
function loadWraData(scenarioId, callback) {
    const file = scenarioId === 'gwl20' ? 'wra_flood_650mm_24h.json' : 'wra_flood_350mm_24h.json';

    if (scenarioId === 'gwl20' && wraGeoJson650) {
        callback(wraGeoJson650);
        return;
    }
    if (scenarioId !== 'gwl20' && wraGeoJson350) {
        callback(wraGeoJson350);
        return;
    }

    const indicator = document.getElementById('active-scenario-indicator');
    const originalText = indicator.innerText;
    indicator.innerText = `載入水利署精細潛勢圖中...請稍候...`;

    fetch(`${file}?t=${new Date().getTime()}`)
        .then(res => res.json())
        .then(geojson => {
            if (scenarioId === 'gwl20') {
                wraGeoJson650 = geojson;
            } else {
                wraGeoJson350 = geojson;
            }
            indicator.innerText = originalText;
            callback(geojson);
        })
        .catch(err => {
            console.error('Error loading WRA GeoJSON:', err);
            indicator.innerText = `載入圖資失敗`;
        });
}

// ==========================================================================
// UI Event Handlers
// ==========================================================================
// ==========================================================================
// Dynamic Timeline Generator
// ==========================================================================
function renderTimelineUI() {
    const selector = document.getElementById('scenario-selector');
    if (!selector) return;

    let html = '<div class="timeline-track"></div>';

    if (activeTheme === 'flood') {
        if (activeFloodLayers.wra && !activeFloodLayers.ncdr) {
            const steps = [
                { id: 'gwl15', label: '350mm / 24HR 暴雨', left: '0%' },
                { id: 'gwl20', label: '650mm / 24HR 極端降雨', left: '100%' }
            ];
            steps.forEach(step => {
                const isActive = getActiveWraScenario() === step.id ? 'active' : '';
                html += `
                    <div class="timeline-step ${isActive}" data-scenario="${step.id}" style="left: ${step.left};">
                        <span class="step-dot"></span>
                        <span class="step-label">${step.label}</span>
                    </div>
                `;
            });
        } else {
            const steps = [
                { id: 'current', label: '現況基準', left: '0%' },
                { id: 'gwl15', label: '升溫 1.5°C', left: '100%' }
            ];
            steps.forEach(step => {
                const isActive = activeScenario === step.id ? 'active' : '';
                html += `
                    <div class="timeline-step ${isActive}" data-scenario="${step.id}" style="left: ${step.left};">
                        <span class="step-dot"></span>
                        <span class="step-label">${step.label}</span>
                    </div>
                `;
            });
        }
    } else {
        const steps = [
            { id: 'current', label: '現況基準', left: '0%' },
            { id: 'gwl15', label: '升溫 1.5°C（SSP1-2.6）', left: '33.33%' },
            { id: 'gwl20', label: '升溫 2.0°C（SSP2-4.5）', left: '66.67%' },
            { id: 'gwl40', label: '升溫 4.0°C（SSP5-8.5）', left: '100%' }
        ];
        steps.forEach(step => {
            const isActive = activeScenario === step.id ? 'active' : '';
            html += `
                <div class="timeline-step ${isActive}" data-scenario="${step.id}" style="left: ${step.left};">
                    <span class="step-dot"></span>
                    <span class="step-label">${step.label}</span>
                </div>
            `;
        });
    }

    selector.innerHTML = html;
}

function updateRiskOpacityControl() {
    const opacityGroup = document.getElementById('risk-opacity-group');
    const opacityLabel = document.getElementById('risk-opacity-label');
    const opacityValue = document.getElementById('val-risk-opacity');

    if (opacityGroup) {
        opacityGroup.style.display = (activeTheme === 'temp' || isNcdrLayerEnabled()) ? 'flex' : 'none';
    }

    if (opacityLabel) {
        opacityLabel.innerText = activeTheme === 'temp' ? '高溫風險圖透明度' : 'NCDR 風險圖透明度';
    }

    if (opacityValue) {
        opacityValue.innerText = `${Math.round(riskMapOpacity * 100)}%`;
    }
}

function renderPointLayerSelector() {
    const selector = document.getElementById('point-layer-selector');
    if (!selector) return;

    const selectorConfigs = Object.values(POINT_REGISTRY).filter(config => config.showInSelector !== false);
    const groups = selectorConfigs.reduce((acc, config) => {
        const groupLabel = config.groupLabel || '業務點位';
        if (!acc.has(groupLabel)) acc.set(groupLabel, []);
        acc.get(groupLabel).push(config);
        return acc;
    }, new Map());

    const orderedGroups = Array.from(groups.entries()).sort(([groupA], [groupB]) => {
        const indexA = POINT_LAYER_GROUP_ORDER.indexOf(groupA);
        const indexB = POINT_LAYER_GROUP_ORDER.indexOf(groupB);
        if (indexA === -1 && indexB === -1) return 0;
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
    });

    selector.innerHTML = orderedGroups.map(([groupLabel, configs]) => `
        <div class="point-layer-group">
            <div class="point-layer-group-title">${groupLabel}</div>
            ${configs.map(config => {
                const dataset = pointDatasets[config.id] || originalPointDatasets[config.id];
                const count = dataset ? filterPointDataset(dataset, config).features.length : 0;
                const active = activePointLayerIds.has(config.id) && dataset;
                return `
                    <button class="point-layer-chip ${active ? 'active' : ''}" type="button" data-point-layer="${config.id}" aria-pressed="${Boolean(active)}" aria-label="${config.label}，${active ? '已選取' : '未選取'}，共 ${count} 處" ${dataset ? '' : 'disabled'}>
                        <span class="point-layer-chip-main"><i class="fa-solid ${config.icon}"></i> ${config.label}</span>
                        <span class="point-layer-chip-meta">
                            <span>${count} 處</span>
                            ${active ? '<span class="point-layer-chip-status"><i class="fa-solid fa-check"></i> 已選取</span>' : ''}
                        </span>
                    </button>
                `;
            }).join('')}
        </div>
    `).join('');
}

function setupPointLayerSelector() {
    const selector = document.getElementById('point-layer-selector');
    if (!selector) return;

    selector.addEventListener('click', async event => {
        const button = event.target.closest('[data-point-layer]');
        if (!button) return;

        const layerId = button.dataset.pointLayer;
        if (!pointDatasets[layerId] && !originalPointDatasets[layerId]) return;

        if (activePointLayerIds.has(layerId)) {
            if (activePointLayerIds.size === 1) return;
            activePointLayerIds.delete(layerId);
        } else {
            activePointLayerIds.add(layerId);
            normalizeActivePointLayerSelection(layerId);
        }

        renderPointLayerSelector();
        await updateLayers();
        updateStatsAndChart();
        populatePointList();
    });
}


function setupColorThemeControl() {
    const select = document.getElementById('color-theme-select');
    const savedTheme = getSavedColorTheme();
    applyColorTheme(savedTheme);

    if (select) {
        select.addEventListener('change', (event) => {
            applyColorTheme(event.target.value);
        });
    }
}


function getClimateScenarioCode(scenarioId) {
    // User-facing warming labels map to AR6 SSP folders used by the grid dataset.
    if (scenarioId === 'current') return 'historical';
    if (scenarioId === 'gwl20') return 'ssp245';
    if (scenarioId === 'gwl40') return 'ssp585';
    return 'ssp126';
}

function setupClimateGridControls() {
    const indicatorSelect = document.getElementById('climate-indicator-select');
    const yearSelect = document.getElementById('climate-year-select');

    if (indicatorSelect) {
        indicatorSelect.value = activeClimateIndicator;
        indicatorSelect.addEventListener('change', (event) => {
            activeClimateIndicator = event.target.value;
            refreshStandardizedData();
        });
    }

    if (yearSelect) {
        yearSelect.value = activeClimateYear;
        yearSelect.addEventListener('change', (event) => {
            activeClimateYear = event.target.value;
            refreshStandardizedData();
        });
    }
}

function setupUIControls() {
    setupColorThemeControl();
    setupPointLayerSelector();
    setupClimateGridControls();
    renderTimelineUI();

    // 1. Theme Switcher
    const themeButtons = document.querySelectorAll('#theme-selector .toggle-btn');
    themeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetBtn = e.currentTarget;
            themeButtons.forEach(b => b.classList.remove('active'));
            targetBtn.classList.add('active');

            activeTheme = targetBtn.dataset.theme;

             // Show/Hide WRA mode group
             const modeGroup = document.getElementById('flood-mode-group');
             if (modeGroup) {
                 modeGroup.style.display = activeTheme === 'flood' ? 'block' : 'none';
             }

             // Show/Hide high temperature risk switcher
             const tempModeGroup = document.getElementById('temp-mode-group');
             if (tempModeGroup) {
                 tempModeGroup.style.display = activeTheme === 'temp' ? 'block' : 'none';
             }
             updateRiskOpacityControl();

            // Safety scenario shift
            if (activeTheme === 'flood') {
                if (activeFloodLayers.wra && !activeFloodLayers.ncdr) {
                    if (activeScenario !== 'gwl15' && activeScenario !== 'gwl20') {
                        activeScenario = 'gwl15';
                    }
                } else if (activeScenario !== 'current' && activeScenario !== 'gwl15') {
                    activeScenario = 'current';
                }
            }

            if (isWraLayerEnabled()) {
                loadWraData(getActiveWraScenario(), () => {
                    renderTimelineUI();
                    updateHeaderIndicator();
                    refreshStandardizedData();
                });
            } else {
                renderTimelineUI();
                updateHeaderIndicator();
                refreshStandardizedData();
            }
        });
    });


    const tempRiskModeButtons = document.querySelectorAll('#temp-risk-mode-selector [data-temp-risk-mode]');
    const syncTempRiskModeButtons = () => {
        tempRiskModeButtons.forEach(button => {
            const isActive = button.dataset.tempRiskMode === activeTempRiskMode;
            button.classList.toggle('active', isActive);
            button.setAttribute('aria-pressed', String(isActive));
        });
    };
    tempRiskModeButtons.forEach(button => {
        button.addEventListener('click', () => {
            const nextMode = button.dataset.tempRiskMode === 'admin' ? 'admin' : 'grid';
            if (activeTempRiskMode === nextMode) return;
            activeTempRiskMode = nextMode;
            syncTempRiskModeButtons();
            updateRiskOpacityControl();
            refreshStandardizedData();
        });
    });
    syncTempRiskModeButtons();

    const tempAdminReferenceToggle = document.getElementById('temp-admin-reference-toggle');
    if (tempAdminReferenceToggle) {
        tempAdminReferenceToggle.classList.toggle('active', activeTempAdminReference);
        tempAdminReferenceToggle.setAttribute('aria-pressed', String(activeTempAdminReference));
        tempAdminReferenceToggle.addEventListener('click', () => {
            activeTempAdminReference = !activeTempAdminReference;
            tempAdminReferenceToggle.classList.toggle('active', activeTempAdminReference);
            tempAdminReferenceToggle.setAttribute('aria-pressed', String(activeTempAdminReference));
            updateRiskOpacityControl();
            refreshStandardizedData();
        });
    }

    // 2. Flood Layer Selector (multi-select overlay)
    const modeButtons = document.querySelectorAll('#flood-mode-selector .toggle-btn');
    const syncFloodLayerButtons = () => {
        modeButtons.forEach(button => {
            button.classList.toggle('active', Boolean(activeFloodLayers[button.dataset.mode]));
            button.setAttribute('aria-pressed', String(Boolean(activeFloodLayers[button.dataset.mode])));
        });
    };
    syncFloodLayerButtons();
    updateRiskOpacityControl();

    modeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const targetBtn = e.currentTarget;
            const mode = targetBtn.dataset.mode;
            const enabledCount = Object.values(activeFloodLayers).filter(Boolean).length;

            if (activeFloodLayers[mode] && enabledCount === 1) {
                return;
            }

            activeFloodLayers[mode] = !activeFloodLayers[mode];
            syncFloodLayerButtons();
            updateRiskOpacityControl();

            if (activeFloodLayers.wra && !activeFloodLayers.ncdr) {
                if (activeScenario !== 'gwl15' && activeScenario !== 'gwl20') {
                    activeScenario = 'gwl15';
                }
            } else if (activeScenario !== 'current' && activeScenario !== 'gwl15') {
                activeScenario = 'current';
            }

            if (isWraLayerEnabled()) {
                loadWraData(getActiveWraScenario(), () => {
                    renderTimelineUI();
                    updateHeaderIndicator();
                    refreshStandardizedData();
                });
            } else {
                renderTimelineUI();
                updateHeaderIndicator();
                refreshStandardizedData();
            }
        });
    });

    // 3. Timeline Step Switcher via Event Delegation
    const selector = document.getElementById('scenario-selector');
    if (selector) {
        selector.addEventListener('click', (e) => {
            const stepElement = e.target.closest('.timeline-step');
            if (stepElement) {
                const nextScenario = stepElement.dataset.scenario;
                activeScenario = nextScenario;

                if (activeTheme === 'flood' && activeFloodLayers.wra && !activeFloodLayers.ncdr) {
                    activeWraScenario = nextScenario;
                }

                if (isWraLayerEnabled()) {
                    loadWraData(getActiveWraScenario(), () => {
                        renderTimelineUI();
                        updateHeaderIndicator();
                        refreshStandardizedData();
                    });
                } else {
                    renderTimelineUI();
                    updateHeaderIndicator();
                    refreshStandardizedData();
                }
            }
        });
    }

    // 4. Risk-map opacity slider (shared by NCDR flood risk and high-temperature risk overlays)
    const riskOpacitySlider = document.getElementById('slider-risk-opacity');
    if (riskOpacitySlider) {
        riskOpacitySlider.addEventListener('input', (e) => {
            riskMapOpacity = parseFloat(e.target.value);
            updateRiskOpacityControl();
            updateLayers();
        });
    }

    // 6. Mobile Sidebar Drawer Toggle
    const brand = document.querySelector('.brand');
    const container = document.querySelector('.app-container');
    const toggleIcon = document.getElementById('mobile-toggle-icon');

    if (brand && container) {
        brand.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                container.classList.toggle('sidebar-collapsed');
                if (toggleIcon) {
                    if (container.classList.contains('sidebar-collapsed')) {
                        toggleIcon.className = 'fa-solid fa-chevron-up';
                    } else {
                        toggleIcon.className = 'fa-solid fa-chevron-down';
                    }
                }
            }
        });
    }
}

// Update Title Overlay Text
function updateHeaderIndicator() {
    const indicator = document.getElementById('active-scenario-indicator');

    const themeName = activeTheme === 'flood'
        ? getActiveFloodLayerNames().join(' + ')
        : '高溫風險等級';

    let scenarioName = '現況基準';
    if (activeTheme === 'temp') {
        if (activeScenario === 'gwl15') {
            scenarioName = '升溫 1.5°C（SSP1-2.6）情境推估';
        } else if (activeScenario === 'gwl20') {
            scenarioName = '升溫 2.0°C（SSP2-4.5）情境推估';
        } else if (activeScenario === 'gwl40') {
            scenarioName = '升溫 4.0°C（SSP5-8.5）情境推估';
        }
    } else if (isWraLayerEnabled() && !activeFloodLayers.ncdr) {
        scenarioName = getWraScenarioName();
    } else {
        if (activeScenario === 'gwl15' || activeScenario === 'future') {
            scenarioName = '未來情境推估';
        }

        if (isWraLayerEnabled()) {
            scenarioName += `；水利署 ${getWraScenarioName()}`;
        }
    }

    indicator.innerText = `${themeName}套疊 - ${scenarioName}`;
}


function formatClimateLegendNumber(value) {
    return Number.isInteger(value) ? String(value) : String(value);
}

function getClimateGridLegendHtml() {
    if (activeTheme !== 'temp' || !climateGridManager) return '';
    const config = climateGridManager.colorScaleConfig && climateGridManager.colorScaleConfig[activeClimateIndicator];
    if (!config || config.mode !== 'absolute' || !Array.isArray(config.breaks) || !Array.isArray(config.colors)) return '';

    const unit = config.unit ? ` ${config.unit}` : '';
    const items = config.colors.map((color, index) => {
        let label;
        if (index === 0) {
            label = `≤ ${formatClimateLegendNumber(config.breaks[0])}${unit}`;
        } else if (index >= config.colors.length - 1) {
            label = `> ${formatClimateLegendNumber(config.breaks[config.breaks.length - 1])}${unit}`;
        } else {
            label = `${formatClimateLegendNumber(config.breaks[index - 1])}–${formatClimateLegendNumber(config.breaks[index])}${unit}`;
        }
        return `<div class="legend-item"><span class="legend-color-box" style="background:${color}"></span> <span>${label}</span></div>`;
    }).join('');

    return `
        <div class="legend-title">氣候網格固定色階｜${activeClimateIndicator}</div>
        <div class="legend-scale">${items}</div>
        <div class="legend-note">使用全域固定斷點，不會隨情境、年份或模型重新正規化；因此不同情境可直接以同一色階比較。</div>
        <div class="legend-note">目前時間軸為 SSP 資料代理：升溫 1.5°C→SSP126、2.0°C→SSP245、4.0°C→SSP585；單一網格在同一年份可能受模式內部變異而非單調增加。</div>
    `;
}

// Dynamic Legend UI Widget
function updateLegendUI() {
    const legendDiv = document.getElementById('map-legend-widget');
    if (!legendDiv) return;

    const riskLegend = `
        <div class="legend-title">綜合風險指標等級</div>
        <div class="legend-scale">
            <div class="legend-item"><span class="legend-color-box" style="background:${riskColors[1]}"></span> <span>第 1 級</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${riskColors[2]}"></span> <span>第 2 級</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${riskColors[3]}"></span> <span>第 3 級</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${riskColors[4]}"></span> <span>第 4 級 </span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${riskColors[5]}"></span> <span>第 5 級 </span></div>
        </div>
    `;

    const wraLegend = `
        <div class="legend-title" style="margin-top: ${isNcdrLayerEnabled() ? '10px' : '0'}; ${isNcdrLayerEnabled() ? 'border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px;' : ''}">水利署預估淹水深度</div>
        <div class="legend-scale">
            <div class="legend-item"><span class="legend-color-box" style="background:${wraColors[2]}"></span> <span>0.3 - 0.5 公尺</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${wraColors[3]}"></span> <span>0.5 - 1.0 公尺</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${wraColors[4]}"></span> <span>1.0 - 2.0 公尺</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${wraColors[5]}"></span> <span>2.0 - 3.0 公尺</span></div>
            <div class="legend-item"><span class="legend-color-box" style="background:${wraColors[6]}"></span> <span>大於 3.0 公尺</span></div>
        </div>
    `;

    const pointLegendItems = getActivePointEntries().map(({ config }) => {
        const markerConfig = config.marker || {};
        if (markerConfig.colorMap) {
            return Object.entries(markerConfig.colorMap)
                .filter(([label]) => label !== '未知')
                .map(([label, color]) => `<div class="legend-item"><span class="legend-color-box" style="background:${color}; border-radius:50%; border: 2px solid ${riskColors[4]}"></span> <span>${config.shortLabel}｜${label}</span></div>`)
                .join('');
        }
        return `<div class="legend-item"><span class="legend-color-box" style="background:${markerConfig.color || markerConfig.fallbackColor || '#94a3b8'}; border-radius:50%; border: 2px solid ${riskColors[4]}"></span> <span>${config.label}</span></div>`;
    }).join('');

    const pointLegend = `
        <div class="legend-title" style="margin-top: 10px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px;">業務點位與風險外框</div>
        <div class="legend-scale">
            ${pointLegendItems}
            <div class="legend-item"><span class="legend-color-box" style="background:#fff; border-radius:50%; border: 3px solid ${riskColors[5]}"></span> <span>外框色代表所處風險等級</span></div>
        </div>
    `;

    legendDiv.innerHTML = `${getClimateGridLegendHtml()}${isNcdrLayerEnabled() ? riskLegend : ''}${isWraLayerEnabled() ? wraLegend : ''}${pointLegend}`;
}

// Legend Widget Initialization
function addLegend() {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function (map) {
        const div = L.DomUtil.create('div', 'map-legend');
        div.id = 'map-legend-widget';
        return div;
    };
    legend.addTo(map);
}
