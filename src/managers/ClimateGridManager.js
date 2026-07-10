class ClimateGridManager {
    constructor(registry) {
        this.registry = registry;
        this.colorScaleConfig = {}; // 來自 config/ColorScaleConfig.json
        this.currentLayer = null;
    }

    async initConfig() {
        try {
            const resp = await fetch('config/ColorScaleConfig.json');
            this.colorScaleConfig = await resp.json();
        } catch (e) {
            console.error("載入 ColorScaleConfig.json 失敗", e);
        }
    }

    getColor(indicator, value) {
        if (value === null || value === undefined || value === -99.9) return "transparent";
        
        const config = this.colorScaleConfig[indicator];
        if (!config || config.mode !== 'absolute') {
            // Fallback (若未定義或不支援 relative，暫用預設)
            return value > 35 ? '#d73027' : '#91bfdb';
        }

        const breaks = config.breaks;
        const colors = config.colors;
        
        // 尋找對應色階
        for (let i = 0; i < breaks.length; i++) {
            if (value <= breaks[i]) {
                return colors[i];
            }
        }
        return colors[colors.length - 1]; // 超過最大值
    }


    isValidGridValue(value) {
        return value !== null && value !== undefined && value !== -99.9 && Number.isFinite(Number(value));
    }

    getNoDataGridStyle(fillOpacity) {
        const opacity = Math.min(fillOpacity, 0.28);
        return {
            fillColor: '#94a3b8',
            color: '#94a3b8',
            weight: 1,
            opacity,
            fillOpacity: opacity,
            dashArray: '3, 3',
            className: 'climate-grid-no-data'
        };
    }

    async loadGridData(datasetVersion, indicator, scenario, model, year) {
        // 確認幾何檔已註冊
        let geojson = this.registry.getGrids(datasetVersion);
        if (!geojson) {
            // 動態拉取
            const resp = await fetch(`data/climate_grids.geojson`);
            const data = await resp.json();
            this.registry.registerGrids(datasetVersion, "Grid_v1", data);
            geojson = data;
        }

        // 確認屬性資料已註冊
        let attrData = this.registry.getData(datasetVersion, indicator, scenario, model);
        if (!attrData) {
            const path = `data/${indicator}/${scenario}/${model}.json`;
            try {
                const resp = await fetch(path);
                const data = await resp.json();
                this.registry.registerData(datasetVersion, indicator, scenario, model, data);
                attrData = data;
            } catch (e) {
                console.error("載入氣候資料失敗", path, e);
                return null;
            }
        }

        // 建立快取映射 (GridID -> Value)。缺值格保留為 no-data，不補值避免誤導風險判定。
        const yearValues = attrData.values[year] || {};

        return {
            geojson: geojson,
            values: yearValues,
            indicator: indicator,
            scenario: scenario,
            model: model,
            year: year,
            datasetVersion: attrData.dataset_version,
            source: "NCDR AR6",
            resolution: "5 km"
        };
    }

    renderToLeaflet(map, layerManager, dataState, options = {}) {
        if (this.currentLayer) {
            map.removeLayer(this.currentLayer);
        }

        const { geojson, values, indicator, scenario, model, year, datasetVersion, source, resolution } = dataState;
        const fillOpacity = Number.isFinite(options.fillOpacity) ? options.fillOpacity : 0.6;

        this.currentLayer = L.geoJSON(geojson, {
            pane: layerManager.getPane('climate_grid'),
            style: (feature) => {
                const gridId = feature.properties.GridID;
                const val = values[gridId];
                if (!this.isValidGridValue(val)) {
                    return this.getNoDataGridStyle(fillOpacity);
                }

                const color = this.getColor(indicator, val);
                
                return {
                    fillColor: color,
                    weight: 1,
                    opacity: fillOpacity,
                    color,
                    fillOpacity,
                    lineCap: 'square',
                    lineJoin: 'miter'
                };
            },
            onEachFeature: (feature, layer) => {
                const gridId = feature.properties.GridID;
                const val = values[gridId];
                if (this.isValidGridValue(val)) {
                    const popupContent = `
                        <div class="climate-popup">
                            <h4>氣候網格資訊</h4>
                            <p><b>Grid ID:</b> ${gridId}</p>
                            <p><b>經緯度:</b> ${feature.properties.lon.toFixed(3)}, ${feature.properties.lat.toFixed(3)}</p>
                            <p><b>指標:</b> ${indicator}</p>
                            <p><b>情境與模型:</b> ${scenario} (${model})</p>
                            <p><b>年份:</b> ${year}</p>
                            <p><b>數值:</b> <span style="color: red; font-weight: bold;">${Number(val).toFixed(2)}</span></p>
                            <hr>
                            <small>解析度: ${resolution} | 來源: ${source} | 版號: ${datasetVersion}</small>
                        </div>
                    `;
                    layer.bindPopup(popupContent);
                } else {
                    layer.bindPopup(`
                        <div class="climate-popup">
                            <h4>氣候網格資訊</h4>
                            <p><b>Grid ID:</b> ${gridId}</p>
                            <p><b>經緯度:</b> ${feature.properties.lon.toFixed(3)}, ${feature.properties.lat.toFixed(3)}</p>
                            <p><b>指標:</b> ${indicator}</p>
                            <p><b>情境與模型:</b> ${scenario} (${model})</p>
                            <p><b>年份:</b> ${year}</p>
                            <p><b>數值:</b> 無來源網格資料；不納入風險判定</p>
                            <hr>
                            <small>解析度: ${resolution} | 來源: ${source} | 版號: ${datasetVersion}</small>
                        </div>
                    `);
                }
            }
        });

        this.currentLayer.addTo(map);
    }
}

window.ClimateGridManager = ClimateGridManager;
