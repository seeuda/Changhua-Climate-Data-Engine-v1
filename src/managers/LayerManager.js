class LayerManager {
    constructor(map) {
        this.map = map;
        this.initPanes();
    }

    initPanes() {
        // 設定絕對的 Layer Priority
        const panes = [
            { name: 'base_map', zIndex: 100 },
            { name: 'administrative', zIndex: 200 },
            { name: 'climate_grid', zIndex: 300 },
            { name: 'flood_potential', zIndex: 400 },
            { name: 'facilities', zIndex: 500 },
            { name: 'popup', zIndex: 600 }
        ];

        panes.forEach(p => {
            if (!this.map.getPane(p.name)) {
                this.map.createPane(p.name);
                this.map.getPane(p.name).style.zIndex = p.zIndex;
                // 防止特定圖層擋住滑鼠事件 (若需點擊需保留 pointerEvents)
                if (p.name === 'base_map' || p.name === 'administrative') {
                    this.map.getPane(p.name).style.pointerEvents = 'none';
                }
            }
        });
    }

    getPane(name) {
        return name;
    }
}

window.LayerManager = LayerManager;
