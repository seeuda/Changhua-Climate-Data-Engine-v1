# 彰化縣氣候風險開圖系統 — Climate Data Engine

> **Changhua County Climate Risk Overlay Decision Support System**

這是一個以 AR6 氣候網格資料為核心，整合高溫風險（AR6 SSP情境）與淹水潛勢（水利署）的 GIS 套疊決策支援系統。

## 系統特色

- 🗺️ **Climate Data Engine 架構**：Geometry 與 Attribute 分離，實現 On-Demand 載入
- 🌡️ **AR6 5km 氣候網格**：整合 NCDR AR6 氣候變遷關鍵指標（SSP126/245/585）
- 🌊 **淹水風險／潛勢套疊**：以 NCDR AR6 淹水災害風險作為 Primary Risk，並以水利署 24h 650mm 與 6h 350mm 淹水潛勢圖作為主要 Comparison
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


## 高溫風險判讀原則

- **預設判定**：點位高溫風險優先使用 NCDR AR6 氣候網格值，避免行政區平均值掩蓋同一鄉鎮內的空間差異。
- **行政區回退情境**：前端提供「不呈現網格」模式；當使用者刻意關閉網格，或點位沒有可用網格值時，才使用行政區風險配對。
- **行政區二級資料限制**：`temp_risk_mean_*`（均權/平均風險）與 `temp_risk_max_*`（最大值風險）是由行政區尺度彙整出的二級參考資料，不應取代網格值作為精細點位判定。適合用於行政區概覽、舊版成果比對、缺值回退或溝通摘要；若用於正式決策，應回溯原始網格與指標資料並說明彙整方法。

## 淹水風險判讀原則

- **NCDR Primary Risk**：NCDR AR6 淹水災害風險用於策略層級調適判讀，概念上整合危害度、脆弱度與暴露度（`R = H × V × E`），前端目前以彰化鄉鎮彙整欄位呈現。
- **水利署 Comparison**：水利署第 3 代 24h 650mm 淹水潛勢圖呈現極端長延時廣域淹水，也是 NCDR 風險的物理基底；6h 350mm 淹水潛勢圖則補足短延時強降雨與都市瞬間積淹水視角。
- **血緣但不混算**：NCDR 的脆弱度可承接水利署 650mm 潛勢圖的淹水情況，因此兩者有資料血緣；但 NCDR 是相對風險等級，水利署是淹水深度潛勢，前端套疊時以互補解讀為主，不以兩者等級取高混算。
- **目前前端欄位限制**：此版本的 NCDR 淹水前端資料包提供 `flood_risk_current` 與 `flood_risk_future`，因此升溫 1.5°C／2.0°C／4.0°C 在鄉鎮彙整圖上共用未來欄位；水利署主要 Comparison 建議使用 650mm/24HR 與 350mm/6HR；既有 350mm/24HR 保留為一般豪雨備用情境。

## 資料來源

- **AR6 氣候網格**：國家災害防救科技中心（NCDR）AR6 氣候變遷關鍵指標
- **淹水潛勢**：經濟部水利署淹水潛勢圖
- **行政區界**：內政部鄉鎮市區界線（TWD97[2020]→WGS84）

## 授權

本系統為彰化縣氣候變遷調適業務研究用途。
