#!/usr/bin/env node

import assert from 'node:assert/strict';
import { BASELINE_PATH, readJson, validateRepository } from './validate_points.mjs';

const baseline = readJson(BASELINE_PATH);
const { assessment, report } = validateRepository({ checkBaseline: true, writeOutput: false });

assert.equal(report.valid, true, report.errors.join('\n'));
assert.equal(assessment.dataset_version, baseline.dataset_version, 'Point data changed; generate a reviewed baseline update');
assert.equal(assessment.points.length, baseline.points.length, 'Current baseline fixture must cover every active point');

const currentByKey = new Map(assessment.points.map(point => [point.key, point]));
for (const expected of baseline.points) {
    const actual = currentByKey.get(expected.key);
    assert(actual, `Missing baseline point ${expected.key}`);
    assert.equal(actual.coordinate_hash, expected.coordinate_hash, `${expected.key}: coordinate hash changed`);
    const { facility_percentile: ignoredExpected, ...expectedTemperature } = expected.temperature;
    const { facility_percentile: ignoredActual, ...actualTemperature } = actual.temperature;
    assert.deepEqual(actualTemperature, expectedTemperature, `${expected.key}: temperature algorithm changed`);
    assert.deepEqual(actual.wra, expected.wra, `${expected.key}: WRA algorithm changed`);
}

console.log(JSON.stringify({
    valid: true,
    dataset_version: assessment.dataset_version,
    point_count: assessment.point_count,
    invariant_temperature_and_wra_points: baseline.points.length,
    facility_percentile_population: assessment.facility_percentile_population,
    note: 'Facility-list percentiles and distributions are data-version dependent and intentionally excluded from invariance assertions.'
}, null, 2));
