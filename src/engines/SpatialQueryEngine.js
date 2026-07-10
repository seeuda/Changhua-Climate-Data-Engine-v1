class SpatialQueryEngine {
    constructor() {
        this.strategies = {
            'nearest': new NearestStrategy(),
            'contains': new ContainsStrategy()
        };
        this.activeStrategy = this.strategies['nearest']; // 預設使用 Nearest
    }

    setStrategy(strategyName) {
        if (this.strategies[strategyName]) {
            this.activeStrategy = this.strategies[strategyName];
        } else {
            console.error(`Strategy ${strategyName} not found.`);
        }
    }

    query(point, gridsFeatureCollection) {
        if (!this.activeStrategy) return null;
        return this.activeStrategy.execute(point, gridsFeatureCollection);
    }
}

// IQueryStrategy 介面實作
class NearestStrategy {
    execute(point, gridsFeatureCollection) {
        // point: [lon, lat]
        // 使用簡單歐式距離尋找最近中心點 (假設網格夠密)
        let nearestGrid = null;
        let minDistance = Infinity;

        gridsFeatureCollection.features.forEach(feature => {
            const gridLon = feature.properties.lon;
            const gridLat = feature.properties.lat;
            
            // 簡易平面距離 (經緯度小範圍可用)
            const d = Math.pow(gridLon - point[0], 2) + Math.pow(gridLat - point[1], 2);
            if (d < minDistance) {
                minDistance = d;
                nearestGrid = feature.properties.GridID;
            }
        });

        return nearestGrid;
    }
}

class ContainsStrategy {
    execute(point, gridsFeatureCollection) {
        // 未來可引入 Turf.js 處理 booleanPointInPolygon
        console.warn("ContainsStrategy 尚未實作");
        return null;
    }
}

window.SpatialQueryEngine = SpatialQueryEngine;
