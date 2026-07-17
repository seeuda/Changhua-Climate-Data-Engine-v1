#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import {
    REPO_ROOT,
    buildAssessment,
    getUniquePointEntries,
    readJson,
    validateRepository
} from './validate_points.mjs';

const current = buildAssessment();
const sourcePoint = current.points.find(point =>
    point.dataset_id === 'env_facilities'
    && point.temperature.absolute_level !== null
    && ['direct_overlay', 'near_0_25m', 'near_25_50m', 'near_50_75m', 'near_75_100m']
        .includes(point.wra.wra650_24h.status)
);
assert(sourcePoint, 'Expected an active environmental facility with temperature and WRA assessment');

const envConfig = current.config.datasets.find(config => config.dataset_id === 'env_facilities');
const envData = readJson(path.join(REPO_ROOT, envConfig.file));
const sourceFeature = envData.features.find(feature => String(feature.properties.id) === sourcePoint.feature_id);
const fixtureFeature = JSON.parse(JSON.stringify(sourceFeature));
fixtureFeature.properties.id = 'FIXTURE_DYNAMIC_001';
fixtureFeature.properties.name = 'M1 動態新增測試點位';
fixtureFeature.properties.coordinate_review_status = 'manually_reviewed';

const fixtureEnvData = JSON.parse(JSON.stringify(envData));
fixtureEnvData.features.push(fixtureFeature);
fixtureEnvData.metadata.total = fixtureEnvData.features.filter(feature => feature.properties?.status !== 'retired').length;
fixtureEnvData.metadata.categories[fixtureFeature.properties.category] += 1;
fixtureEnvData.metadata.coordinate_review_count = fixtureEnvData.features.length;

const { assessment: fixture, report } = validateRepository({
    overrides: { env_facilities: fixtureEnvData },
    checkBaseline: false,
    writeOutput: false
});
assert.equal(report.valid, true, report.errors.join('\n'));
assert.equal(fixture.point_count, current.point_count + 1);
assert.equal(fixture.dataset_counts.env_facilities, current.dataset_counts.env_facilities + 1);
assert.equal(
    fixture.category_counts[fixtureFeature.properties.category],
    current.category_counts[fixtureFeature.properties.category] + 1
);
assert.equal(
    fixture.town_counts[fixtureFeature.properties.town],
    current.town_counts[fixtureFeature.properties.town] + 1
);
assert.equal(fixture.facility_percentile_population, current.facility_percentile_population + 1);

const addedPoint = fixture.points.find(point => point.key === 'env_facilities:FIXTURE_DYNAMIC_001');
assert(addedPoint, 'Fixture point must be present in the unique point collection');
assert.notEqual(addedPoint.temperature.absolute_level, null, 'Fixture point must receive temperature assessment');
assert.notEqual(addedPoint.wra.wra650_24h.status, null, 'Fixture point must receive WRA assessment');
assert.equal(
    fixture.risk_baseline.temperature_level_distribution[`L${addedPoint.temperature.absolute_level}`],
    current.risk_baseline.temperature_level_distribution[`L${addedPoint.temperature.absolute_level}`] + 1
);
assert.equal(
    fixture.risk_baseline.wra_status_distribution.wra650_24h[addedPoint.wra.wra650_24h.status],
    current.risk_baseline.wra_status_distribution.wra650_24h[addedPoint.wra.wra650_24h.status] + 1
);

const retiredFeature = JSON.parse(JSON.stringify(fixtureFeature));
retiredFeature.properties.status = 'retired';
const retiredDataset = { config: envConfig, data: { type: 'FeatureCollection', features: [retiredFeature] } };
assert.equal(getUniquePointEntries([retiredDataset]).length, 0, 'Retired point must be excluded from active population');
assert.equal(getUniquePointEntries([retiredDataset], true).length, 1, 'Retired point must remain auditable');

console.log(JSON.stringify({
    fixture_key: addedPoint.key,
    point_count_before: current.point_count,
    point_count_after: fixture.point_count,
    category: fixtureFeature.properties.category,
    town: fixtureFeature.properties.town,
    temperature: addedPoint.temperature,
    wra650_24h: addedPoint.wra.wra650_24h,
    fixture_persisted: false
}, null, 2));
