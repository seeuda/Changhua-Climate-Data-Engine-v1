class LayerManager {
    constructor(map) {
        this.map = map;
        this.paneAliases = {
            base_map: 'base-map',
            climate_grid: 'climate-grid',
            flood_potential: 'comparison',
            facilities: 'facility',
            popup: 'interaction',
            towns: 'administrative'
        };
        this.initPanes();
    }

    initPanes() {
        // Functional pane architecture for v2: primary climate risk stays above
        // comparison overlays, while optional reference panes remain independently controllable.
        const panes = [
            { name: 'base-map', zIndex: 100, pointerEvents: 'none' },
            { name: 'administrative', zIndex: 300, pointerEvents: 'none' },
            { name: 'climate-grid', zIndex: 350 },
            { name: 'comparison', zIndex: 400 },
            { name: 'primary-risk', zIndex: 450 },
            { name: 'facility', zIndex: 600 },
            { name: 'interaction', zIndex: 700 },
            { name: 'labels', zIndex: 650, pointerEvents: 'none' }
        ];

        panes.forEach(p => {
            if (!this.map.getPane(p.name)) {
                this.map.createPane(p.name);
            }

            const pane = this.map.getPane(p.name);
            pane.style.zIndex = p.zIndex;
            if (p.pointerEvents) {
                pane.style.pointerEvents = p.pointerEvents;
            }
        });
    }

    getPane(name) {
        return this.paneAliases[name] || name;
    }
}

window.LayerManager = LayerManager;
