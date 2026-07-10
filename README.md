# 彰化縣氣候風險開圖系統 — Climate Data Engine

> **Changhua County Climate Risk Overlay Decision Support System**

這是一個以 AR6 氣候網格資料為核心，整合高溫風險（AR6 SSP情境）與淹水潛勢（水利署）的 GIS 套疊決策支援系統。

## 系統特色

- 🗺️ **Climate Data Engine 架構**：Geometry 與 Attribute 分離，實現 On-Demand 載入
- 🌡️ **AR6 5km 氣候網格**：整合 NCDR AR6 氣候變遷關鍵指標（SSP126/245/585）
- 🌊 **淹水潛勢套疊**：整合水利署 350mm/650mm 淹水潛勢圖
- 📍 **設施點位管理**：日照中心、環保設施等業務點位的風險評估
- 🔄 **Climate Data Pipeline（CDP）**：自動化 ETL 腳本，將 CSV 轉換為高效前端格式

## 專案結構

```
├── index.html              # 主頁面
├── app.js                  # 主程式邏輯
├── src/
│   ├── engines/
│   │   └── SpatialQueryEngine.js     # 空間查詢引擎（NearestStrategy）
│   └── managers/
│       ├── ClimateGridManager.js     # 氣候網格管理器
│       ├── DatasetRegistry.js        # 資料集版控管理
│       └── LayerManager.js           # 圖層 Z-Index 管理
├── tools/
│   └── climate_pipeline/
│       └── main.py                   # CDP 轉譯腳本
├── data/
│   ├── climate_grids.geojson         # AR6 5km 氣候網格（純幾何）
│   ├── changhua_towns.json           # 彰化縣行政區邊界（WGS84）
│   └── {指標}/{情境}/{模型}.json     # 氣候數值資料
└── config/
    └── ColorScaleConfig.json         # 絕對色階設定
```

## 快速啟動

```bash
# 在專案根目錄啟動本機伺服器
python -m http.server 8080
# 開啟瀏覽器前往 http://127.0.0.1:8080
```

## 執行 CDP 轉譯腳本

```bash
cd tools/climate_pipeline
pip install geopandas pandas
python main.py
```

## 資料來源

- **AR6 氣候網格**：國家災害防救科技中心（NCDR）AR6 氣候變遷關鍵指標
- **淹水潛勢**：經濟部水利署淹水潛勢圖
- **行政區界**：內政部鄉鎮市區界線（TWD97[2020]→WGS84）

## 授權

本系統為彰化縣氣候變遷調適業務研究用途。
