#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config/PointDatasetConfig.json');
const COLOR_SCALE_PATH = path.join(REPO_ROOT, 'config/ColorScaleConfig.json');
export const BASELINE_PATH = path.join(REPO_ROOT, 'tests/baselines/point_algorithm_baseline.json');
export const JSON_REPORT_PATH = path.join(REPO_ROOT, 'tools/output/point_validation_report.json');
export const MARKDOWN_REPORT_PATH = path.join(REPO_ROOT, 'tools/output/point_validation_report.md');
const WRA_RADIUS_METERS = 100;

export const readJson = filePath => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const normalizeStatus = feature => String(feature?.properties?.status || 'active').toLowerCase();
export const isActiveFeature = feature => normalizeStatus(feature) !== 'retired';

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
    }
    return value;
}

function datasetVersion(datasets) {
    const canonical = datasets
        .map(({ config, data }) => ({ dataset_id: config.dataset_id, data: stableValue(data) }))
        .sort((a, b) => a.dataset_id.localeCompare(b.dataset_id));
    return `points-${crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16)}`;
}

function coordinateHash(coordinates) {
    return crypto.createHash('sha256').update(JSON.stringify(coordinates)).digest('hex');
}

function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const intersects = ((yi > y) !== (yj > y))
            && (x < ((xj - xi) * (y - yi) / (yj - yi)) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function pointInPolygon(x, y, polygon) {
    if (!polygon?.length || !pointInRing(x, y, polygon[0])) return false;
    return !polygon.slice(1).some(hole => pointInRing(x, y, hole));
}

export function pointInGeometry(x, y, geometry) {
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return false;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polygons.some(polygon => pointInPolygon(x, y, polygon));
}

function coordinateBBox(coordinates, bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }) {
    if (typeof coordinates?.[0] === 'number') {
        const [x, y] = coordinates;
        bbox.minX = Math.min(bbox.minX, x);
        bbox.minY = Math.min(bbox.minY, y);
        bbox.maxX = Math.max(bbox.maxX, x);
        bbox.maxY = Math.max(bbox.maxY, y);
    } else {
        (coordinates || []).forEach(child => coordinateBBox(child, bbox));
    }
    return bbox;
}

function isPointInBBox(x, y, bbox) {
    return x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY;
}

function degreeDelta(dx, dy, latitude) {
    return { x: dx * 111320 * Math.cos(latitude * Math.PI / 180), y: dy * 111320 };
}

function distancePointToSegmentMeters(x, y, start, end) {
    const latitude = (y + start[1] + end[1]) / 3;
    const a = degreeDelta(start[0] - x, start[1] - y, latitude);
    const b = degreeDelta(end[0] - x, end[1] - y, latitude);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lengthSquared = (abx * abx) + (aby * aby);
    if (lengthSquared === 0) return Math.hypot(a.x, a.y);
    const t = Math.max(0, Math.min(1, -((a.x * abx) + (a.y * aby)) / lengthSquared));
    return Math.hypot(a.x + (t * abx), a.y + (t * aby));
}

function distancePointToRingMeters(x, y, ring) {
    let minimum = Infinity;
    for (let index = 0; index < ring.length - 1; index += 1) {
        minimum = Math.min(minimum, distancePointToSegmentMeters(x, y, ring[index], ring[index + 1]));
    }
    return minimum;
}

function prepareWra(geojson) {
    return (geojson.features || []).map(feature => {
        const geometry = feature.geometry;
        const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.coordinates || [];
        return {
            feature,
            bbox: coordinateBBox(polygons),
            rings: polygons.flatMap(polygon => polygon || [])
        };
    });
}

function depthGridCode(depth) {
    const normalized = String(depth || '').replace(/\s/g, '').replace(/\.0/g, '');
    return { '0.3-0.5': 2, '0.5-1': 3, '1-2': 4, '2-3': 5, '>3': 6 }[normalized] || 1;
}

function normalizedWraDisplayLevel(gridCode) {
    return Math.min(Math.max(Math.round(Number(gridCode)), 1), 5);
}

function wraScore(result) {
    const level = normalizedWraDisplayLevel(result.grid_code);
    return result.method === 'direct' ? level : 1 + ((level - 1) * result.weight);
}

function higherPriorityWra(candidate, current) {
    if (!current) return true;
    if (candidate.method !== current.method) return candidate.method === 'direct';
    if (wraScore(candidate) !== wraScore(current)) return wraScore(candidate) > wraScore(current);
    if (candidate.grid_code !== current.grid_code) return candidate.grid_code > current.grid_code;
    return (candidate.distance_m ?? Infinity) < (current.distance_m ?? Infinity);
}

function wraStatus(method, distanceMeters) {
    if (method === 'direct') return 'direct_overlay';
    if (distanceMeters > 0 && distanceMeters <= 25) return 'near_0_25m';
    if (distanceMeters <= 50) return 'near_25_50m';
    if (distanceMeters <= 75) return 'near_50_75m';
    if (distanceMeters <= WRA_RADIUS_METERS) return 'near_75_100m';
    return 'no_hit';
}

export function evaluateWraFeature(feature, preparedWra) {
    const [x, y] = feature.geometry.coordinates;
    let bestDirect = null;
    let bestProximity = null;
    for (const item of preparedWra) {
        const source = item.feature;
        const depth = source.properties?.depth_type ?? null;
        const gridCode = source.properties?.grid_code || depthGridCode(depth);
        const winningFeatureId = source.properties?.id || source.properties?.OBJECTID
            || source.properties?.TownName || source.properties?.Town || null;
        if (isPointInBBox(x, y, item.bbox) && pointInGeometry(x, y, source.geometry)) {
            const boundaryDistance = Math.min(...item.rings.map(ring => distancePointToRingMeters(x, y, ring)));
            const candidate = {
                method: 'direct', status: 'direct_overlay', winning_feature_id: winningFeatureId,
                grid_code: gridCode, depth_type: depth, distance_m: 0, boundary_distance_m: boundaryDistance,
                weight: 1
            };
            if (higherPriorityWra(candidate, bestDirect)) bestDirect = candidate;
            continue;
        }
        const distance = Math.min(...item.rings.map(ring => distancePointToRingMeters(x, y, ring)));
        if (distance <= WRA_RADIUS_METERS) {
            const candidate = {
                method: 'proximity', status: wraStatus('proximity', distance), winning_feature_id: winningFeatureId,
                grid_code: gridCode, depth_type: depth, distance_m: distance, boundary_distance_m: null,
                weight: Math.max(0, 1 - (distance / WRA_RADIUS_METERS))
            };
            if (higherPriorityWra(candidate, bestProximity)) bestProximity = candidate;
        }
    }
    const result = bestDirect || bestProximity || {
        method: 'no_match', status: 'no_hit', winning_feature_id: null, grid_code: null,
        depth_type: null, distance_m: null, boundary_distance_m: null, weight: null
    };
    for (const field of ['distance_m', 'boundary_distance_m', 'weight']) {
        if (Number.isFinite(result[field])) result[field] = Number(result[field].toFixed(9));
    }
    return result;
}

function climateLevel(colorConfig, indicator, value) {
    const config = colorConfig[indicator];
    if (value === null || value === undefined || value === -99.9 || !config) return null;
    let index = config.breaks.findIndex(breakValue => value <= breakValue);
    if (index === -1) index = config.colors.length - 1;
    return index + 1;
}

function empiricalPercentile(value, population) {
    if (!Number.isFinite(value) || population.length === 0) return null;
    return Number(((population.filter(candidate => candidate <= value).length / population.length) * 100).toFixed(6));
}

function findContainingFeature(feature, polygons) {
    const [x, y] = feature.geometry.coordinates;
    return polygons.find(candidate => pointInGeometry(x, y, candidate.geometry)) || null;
}

function loadDatasets(config, overrides = {}) {
    return config.datasets.map(datasetConfig => ({
        config: datasetConfig,
        data: clone(overrides[datasetConfig.dataset_id] || readJson(path.join(REPO_ROOT, datasetConfig.file)))
    }));
}

export function getUniquePointEntries(datasets, includeRetired = false) {
    const entries = new Map();
    for (const { config, data } of datasets) {
        for (const feature of data.features || []) {
            if (!includeRetired && !isActiveFeature(feature)) continue;
            const featureId = feature.properties?.[config.id_field];
            const key = `${config.dataset_id}:${String(featureId)}`;
            if (!entries.has(key)) entries.set(key, { key, dataset_id: config.dataset_id, config, feature });
        }
    }
    return Array.from(entries.values());
}

function categoryCounts(entries) {
    return entries.reduce((counts, entry) => {
        const category = entry.config.category_field
            ? String(entry.feature.properties?.[entry.config.category_field] || '(blank)')
            : entry.dataset_id;
        counts[category] = (counts[category] || 0) + 1;
        return counts;
    }, {});
}

function townCounts(entries, towns) {
    return entries.reduce((counts, entry) => {
        const spatialTown = findContainingFeature(entry.feature, towns)?.properties?.town_name;
        const town = spatialTown || entry.feature.properties?.[entry.config.town_field] || '(outside)';
        counts[town] = (counts[town] || 0) + 1;
        return counts;
    }, {});
}

function validateRegistryCoverage(config, errors) {
    const appSource = fs.readFileSync(path.join(REPO_ROOT, 'app.js'), 'utf8');
    for (const datasetConfig of config.datasets.filter(item => item.category_field)) {
        for (const category of datasetConfig.visible_categories || []) {
            const escaped = category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            if (!new RegExp(`filterCategory:\\s*['\"]${escaped}['\"]`).test(appSource)) {
                errors.push(`Visible category has no POINT_REGISTRY layer: ${datasetConfig.dataset_id}:${category}`);
            }
        }
    }
}

function validateDatasets(config, datasets, towns, baseline, errors, warnings) {
    const compositeKeys = new Set();
    const baselinePoints = new Map((baseline?.points || []).map(point => [point.key, point]));
    const currentKeys = new Set();
    for (const { config: datasetConfig, data } of datasets) {
        if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
            errors.push(`${datasetConfig.file}: expected a FeatureCollection with features[]`);
            continue;
        }
        const ids = new Set();
        const exceptions = new Set((data.metadata?.coordinate_exceptions || []).map(String));
        const categories = new Set();
        for (const feature of data.features) {
            const properties = feature.properties || {};
            const featureId = properties[datasetConfig.id_field];
            const key = `${datasetConfig.dataset_id}:${String(featureId)}`;
            currentKeys.add(key);
            if (featureId === undefined || featureId === null || String(featureId).trim() === '') {
                errors.push(`${datasetConfig.file}: missing feature_id`);
            } else if (ids.has(String(featureId))) {
                errors.push(`${datasetConfig.file}: duplicate feature_id ${String(featureId)}`);
            }
            ids.add(String(featureId));
            if (compositeKeys.has(key)) errors.push(`Composite point key collision: ${key}`);
            compositeKeys.add(key);
            for (const field of datasetConfig.required_fields) {
                if (properties[field] === undefined || properties[field] === null || String(properties[field]).trim() === '') {
                    errors.push(`${key}: missing required field ${field}`);
                }
            }
            if (feature.type !== 'Feature' || feature.geometry?.type !== 'Point') {
                errors.push(`${key}: geometry must be Point`);
                continue;
            }
            const coordinates = feature.geometry.coordinates;
            if (!Array.isArray(coordinates) || coordinates.length < 2
                || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) {
                errors.push(`${key}: coordinates must be finite [longitude, latitude] numbers`);
                continue;
            }
            const [longitude, latitude] = coordinates;
            if (longitude < 119 || longitude > 122 || latitude < 22 || latitude > 26) {
                errors.push(`${key}: coordinate order/range is not plausible for [longitude, latitude] in Taiwan`);
            }
            const spatialTown = findContainingFeature(feature, towns)?.properties?.town_name || null;
            if (!spatialTown && !exceptions.has(String(featureId))) errors.push(`${key}: point is outside Changhua or lacks an exception`);
            const declaredTown = properties[datasetConfig.town_field];
            if (spatialTown && declaredTown && spatialTown !== declaredTown) {
                errors.push(`${key}: declared town ${declaredTown} differs from spatial town ${spatialTown}`);
            }
            const category = datasetConfig.category_field ? String(properties[datasetConfig.category_field] || '').trim() : '';
            if (category) categories.add(category);
            const oldPoint = baselinePoints.get(key);
            if (baseline && !oldPoint && !['manually_reviewed', 'pending_review'].includes(properties.coordinate_review_status)) {
                errors.push(`${key}: new feature must declare coordinate_review_status as manually_reviewed or pending_review`);
            }
            if (oldPoint && oldPoint.coordinate_hash !== coordinateHash(coordinates)) {
                const pending = properties.coordinate_review_status === 'pending_review';
                const record = properties.coordinate_review_record;
                const reviewed = record && record.reviewed_at && record.reviewed_by;
                if (!pending && !reviewed) errors.push(`${key}: coordinates changed without pending_review or a new review record`);
            }
        }
        if (datasetConfig.category_field) {
            const covered = new Set([
                ...(datasetConfig.visible_categories || []),
                ...(datasetConfig.aggregate_only_categories || [])
            ]);
            for (const category of categories) {
                if (!covered.has(category)) errors.push(`Unregistered facility category: ${category}`);
            }
        }
        const metadata = data.metadata || {};
        const pendingFeatures = data.features.filter(feature => feature.properties?.coordinate_review_status === 'pending_review');
        if (metadata.coordinate_review_scope === 'all_points_in_dataset'
            && metadata.coordinate_review_status === 'manually_reviewed') {
            if (metadata.coordinate_review_count !== data.features.length) {
                errors.push(`${datasetConfig.file}: coordinate_review_count ${metadata.coordinate_review_count} must equal actual feature count ${data.features.length}`);
            }
            if (pendingFeatures.length > 0) {
                errors.push(`${datasetConfig.file}: pending_review points cannot coexist with an all-points manually reviewed claim`);
            }
        } else if (pendingFeatures.length === 0 && metadata.coordinate_review_status === 'pending_review') {
            warnings.push(`${datasetConfig.file}: dataset is pending_review but no feature-level pending_review marker exists`);
        }
        const activeCount = data.features.filter(isActiveFeature).length;
        if (metadata.total !== undefined && metadata.total !== activeCount) {
            errors.push(`${datasetConfig.file}: metadata.total ${metadata.total} must equal active point count ${activeCount}`);
        }
        if (metadata.categories && datasetConfig.category_field) {
            const actual = Object.fromEntries([...categories].map(category => [
                category,
                data.features.filter(feature => isActiveFeature(feature)
                    && String(feature.properties?.[datasetConfig.category_field] || '').trim() === category).length
            ]));
            if (JSON.stringify(stableValue(metadata.categories)) !== JSON.stringify(stableValue(actual))) {
                errors.push(`${datasetConfig.file}: metadata.categories does not match active feature categories`);
            }
        }
    }
    for (const key of baselinePoints.keys()) {
        if (!currentKeys.has(key)) errors.push(`${key}: baseline feature was deleted; mark it status=retired instead`);
    }
}

export function buildAssessment({ overrides = {}, baseline = null } = {}) {
    const config = readJson(CONFIG_PATH);
    const datasets = loadDatasets(config, overrides);
    const entries = getUniquePointEntries(datasets);
    const allEntries = getUniquePointEntries(datasets, true);
    const towns = readJson(path.join(REPO_ROOT, config.town_file)).features || [];
    const grids = readJson(path.join(REPO_ROOT, config.climate_grid_file)).features || [];
    const colorConfig = readJson(COLOR_SCALE_PATH);
    const temperatureConfig = config.temperature_baseline;
    const temperatureValues = readJson(path.join(REPO_ROOT, temperatureConfig.values_file)).values[temperatureConfig.year];
    const validCountyValues = Object.values(temperatureValues).filter(value => Number.isFinite(value) && value !== -99.9);
    const preparedWra = Object.fromEntries(config.wra_scenarios.map(scenario => [
        scenario.id,
        prepareWra(readJson(path.join(REPO_ROOT, scenario.file)))
    ]));
    const pointRows = entries.map(entry => {
        const grid = findContainingFeature(entry.feature, grids);
        const gridId = grid?.properties?.GridID ?? null;
        const rawValue = gridId === null ? null : temperatureValues[gridId];
        const temperature = {
            grid_id: gridId,
            raw_value: rawValue ?? null,
            absolute_level: climateLevel(colorConfig, temperatureConfig.indicator, rawValue),
            county_grid_percentile: empiricalPercentile(rawValue, validCountyValues),
            facility_percentile: null
        };
        return {
            key: entry.key,
            dataset_id: entry.dataset_id,
            feature_id: String(entry.feature.properties?.[entry.config.id_field]),
            name: entry.feature.properties?.[entry.config.name_field] || '',
            status: normalizeStatus(entry.feature),
            coordinates: entry.feature.geometry.coordinates,
            coordinate_hash: coordinateHash(entry.feature.geometry.coordinates),
            temperature,
            wra: Object.fromEntries(config.wra_scenarios.map(scenario => [
                scenario.id,
                evaluateWraFeature(entry.feature, preparedWra[scenario.id])
            ]))
        };
    });
    const facilityValues = pointRows.map(point => point.temperature.raw_value).filter(Number.isFinite);
    pointRows.forEach(point => {
        point.temperature.facility_percentile = empiricalPercentile(point.temperature.raw_value, facilityValues);
    });
    const riskBaseline = {
        temperature_level_distribution: pointRows.reduce((counts, point) => {
            const label = point.temperature.absolute_level === null ? 'no_data' : `L${point.temperature.absolute_level}`;
            counts[label] = (counts[label] || 0) + 1;
            return counts;
        }, {}),
        wra_status_distribution: Object.fromEntries(config.wra_scenarios.map(scenario => [
            scenario.id,
            pointRows.reduce((counts, point) => {
                const status = point.wra[scenario.id].status;
                counts[status] = (counts[status] || 0) + 1;
                return counts;
            }, {})
        ]))
    };
    return {
        config, datasets, entries, allEntries, towns,
        dataset_version: datasetVersion(datasets),
        point_count: entries.length,
        all_feature_count: allEntries.length,
        retired_count: allEntries.length - entries.length,
        dataset_counts: Object.fromEntries(config.datasets.map(item => [
            item.dataset_id,
            entries.filter(entry => entry.dataset_id === item.dataset_id).length
        ])),
        category_counts: categoryCounts(entries),
        town_counts: townCounts(entries, towns),
        facility_percentile_population: facilityValues.length,
        risk_baseline: riskBaseline,
        points: pointRows,
        baseline
    };
}

function compareAlgorithmBaseline(assessment, baseline, errors) {
    if (!baseline) {
        errors.push(`Missing algorithm baseline: ${path.relative(REPO_ROOT, BASELINE_PATH)}`);
        return;
    }
    const current = new Map(assessment.points.map(point => [point.key, point]));
    for (const oldPoint of baseline.points || []) {
        const newPoint = current.get(oldPoint.key);
        if (!newPoint || oldPoint.coordinate_hash !== newPoint.coordinate_hash) continue;
        const invariantTemperature = ({ facility_percentile, ...fields }) => fields;
        try {
            assert.deepEqual(invariantTemperature(newPoint.temperature), invariantTemperature(oldPoint.temperature));
            assert.deepEqual(newPoint.wra, oldPoint.wra);
        } catch {
            errors.push(`${oldPoint.key}: per-point temperature/WRA algorithm invariance changed`);
        }
    }
}

function reportPayload(assessment, errors, warnings) {
    return {
        valid: errors.length === 0,
        dataset_version: assessment.dataset_version,
        generated_at: new Date().toISOString(),
        point_count: assessment.point_count,
        all_feature_count: assessment.all_feature_count,
        retired_count: assessment.retired_count,
        dataset_counts: assessment.dataset_counts,
        category_counts: assessment.category_counts,
        town_counts: assessment.town_counts,
        facility_percentile_population: assessment.facility_percentile_population,
        risk_baseline: assessment.risk_baseline,
        errors,
        warnings
    };
}

function markdownReport(report) {
    const lines = [
        '# Point validation report', '',
        `- valid: ${report.valid}`, `- dataset_version: ${report.dataset_version}`,
        `- generated_at: ${report.generated_at}`, `- active point_count: ${report.point_count}`,
        `- retired_count: ${report.retired_count}`,
        `- facility percentile population: ${report.facility_percentile_population}`, '',
        '## Dataset counts', '',
        ...Object.entries(report.dataset_counts).map(([name, count]) => `- ${name}: ${count}`), '',
        '## Category counts', '',
        ...Object.entries(report.category_counts).map(([name, count]) => `- ${name}: ${count}`), '',
        '## Errors', '', ...(report.errors.length ? report.errors.map(error => `- ${error}`) : ['- None']), '',
        '## Warnings', '', ...(report.warnings.length ? report.warnings.map(warning => `- ${warning}`) : ['- None']), ''
    ];
    return `${lines.join('\n')}\n`;
}

function writeReports(report) {
    fs.mkdirSync(path.dirname(JSON_REPORT_PATH), { recursive: true });
    fs.writeFileSync(JSON_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(MARKDOWN_REPORT_PATH, markdownReport(report));
}

export function validateRepository({ overrides = {}, checkBaseline = true, writeOutput = true } = {}) {
    const baseline = fs.existsSync(BASELINE_PATH) ? readJson(BASELINE_PATH) : null;
    const assessment = buildAssessment({ overrides, baseline });
    const errors = [];
    const warnings = [];
    validateRegistryCoverage(assessment.config, errors);
    validateDatasets(assessment.config, assessment.datasets, assessment.towns, baseline, errors, warnings);
    if (checkBaseline) compareAlgorithmBaseline(assessment, baseline, errors);
    const report = reportPayload(assessment, errors, warnings);
    if (writeOutput) writeReports(report);
    return { assessment, report };
}

function baselinePayload(assessment) {
    return {
        dataset_version: assessment.dataset_version,
        generated_at: new Date().toISOString(),
        point_count: assessment.point_count,
        category_counts: assessment.category_counts,
        risk_baseline: assessment.risk_baseline,
        points: assessment.points.map(point => {
            const { name, coordinates, ...safePoint } = point;
            const { facility_percentile, ...invariantTemperature } = safePoint.temperature;
            return { ...safePoint, temperature: invariantTemperature };
        })
    };
}

function main() {
    const updateBaseline = process.argv.includes('--update-baseline');
    if (updateBaseline) {
        const assessment = buildAssessment();
        fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
        fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baselinePayload(assessment), null, 2)}\n`);
    }
    const { report } = validateRepository({ checkBaseline: true, writeOutput: true });
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
