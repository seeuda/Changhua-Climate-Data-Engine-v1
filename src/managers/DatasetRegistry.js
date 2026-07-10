class DatasetRegistry {
    constructor() {
        this.datasets = {}; // 存放已載入的資料集，例如 { 'AR6_v112': { grids: null, data: {} } }
        this.schemaVersions = {}; 
    }

    registerGrids(datasetVersion, schemaVersion, geojsonData) {
        if (!this.datasets[datasetVersion]) {
            this.datasets[datasetVersion] = { grids: null, data: {} };
        }
        
        // 版控驗證
        if (geojsonData.dataset_version && geojsonData.dataset_version !== datasetVersion) {
            console.error(`版控衝突：GeoJSON 的 Dataset Version (${geojsonData.dataset_version}) 不符合預期 (${datasetVersion})`);
            return false;
        }

        this.datasets[datasetVersion].grids = geojsonData;
        this.schemaVersions[datasetVersion] = schemaVersion;
        console.log(`成功註冊 Grid 資料: ${datasetVersion} (${schemaVersion})`);
        return true;
    }

    registerData(datasetVersion, indicator, scenario, model, jsonData) {
        // 版控驗證：防止 JSON 與已註冊的 Grid 版本不合
        const expectedSchema = this.schemaVersions[datasetVersion];
        if (jsonData.dataset_version !== datasetVersion || jsonData.schema_version !== expectedSchema) {
            console.error(`資料版控衝突！JSON 版號 (${jsonData.dataset_version}, ${jsonData.schema_version}) 與系統不符 (${datasetVersion}, ${expectedSchema})。可能遺漏執行 CDP 轉譯。`);
            return false;
        }

        const dataKey = `${indicator}_${scenario}_${model}`;
        this.datasets[datasetVersion].data[dataKey] = jsonData;
        console.log(`成功掛載屬性資料: ${dataKey}`);
        return true;
    }

    getGrids(datasetVersion) {
        return this.datasets[datasetVersion]?.grids || null;
    }

    getData(datasetVersion, indicator, scenario, model) {
        const dataKey = `${indicator}_${scenario}_${model}`;
        return this.datasets[datasetVersion]?.data[dataKey] || null;
    }
}

window.DatasetRegistry = DatasetRegistry;
