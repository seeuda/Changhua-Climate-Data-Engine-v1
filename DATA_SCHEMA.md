# GIS_Portal 點位資料格式（GeoJSON）

本系統維持 GitHub Pages 可直接部署的靜態架構。新增環保局或其他業務點位時，原則上只需要：

1. 將點位 GeoJSON 放在 `GIS_Portal/` 下。
2. 在 `app.js` 的 `POINT_REGISTRY` 新增一組設定。
3. 重新整理頁面，左側「業務點位主題」會依 registry 顯示可切換圖層。

## GeoJSON 基本格式

點位資料應使用 `FeatureCollection`，座標順序為 `[經度, 緯度]`。

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [120.54321, 24.07654]
      },
      "properties": {
        "id": "ENV001",
        "name": "彰化縣清潔隊資源回收場",
        "town": "彰化市",
        "address": "彰化縣彰化市..."
      }
    }
  ]
}
```

## 必填欄位

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | string / number | 點位唯一識別碼，同一資料集內不可重複。 |
| `name` | string | 點位名稱，會顯示於 popup 與列表標題。 |
| `town` | string | 業務資料提供的鄉鎮市文字註記；列表篩選與風險辨識會優先依點位座標套疊 `changhua_towns.json` 判定實際地理所屬鄉鎮，文字僅作顯示與無法套疊時的備援。 |
| `address` | string | 地址或位置描述。 |

若既有資料欄位名稱不同，可在 `POINT_REGISTRY` 以 `idField`、`nameField`、`townField`、`addressField` 對應，不一定要改原始資料。

## 建議欄位

| 欄位 | 型別 | 顯示方式 | 說明 |
| --- | --- | --- | --- |
| `phone` | string | popup / 列表 | 聯絡電話。 |
| `category` | string | popup / 列表 / tag / filter | 設施主分類，例如 `清潔隊部`、`資源回收場`；可搭配 `POINT_REGISTRY.filterCategory` 產生獨立套疊圖層。 |
| `sub_type` | string | popup / 列表 / tag | 設施細分類，例如清潔隊隊部、清潔隊資源回收場。 |
| `shade_info` | string | popup / 列表 | 遮蔭、降溫、戶外等待區或補水資訊。 |
| `note` | string | popup / 列表 | 一般資料註記；若值為早期 AI 座標註記，應遷移至 `legacy_ai_coordinate_note` 並自 UI 隱藏。 |
| `work_type` | string | popup / 列表 / tag | 舊版欄位仍可使用，若資料尚未轉成 `category` / `sub_type` 可在 registry 指向此欄位。 |
| `staff_count` | number | popup / 列表 | 舊版欄位仍可使用，用於工作人員、配置人力或可動員人數。 |
| `risk_note` | string | popup / 列表 | 舊版欄位仍可使用，適合描述淹水、高溫、交通或服務中斷風險。 |
| `adaptation_action` | string | popup / 列表 | 舊版欄位仍可使用，適合描述建議調適作為。 |
| `source_type` | string | popup / tag | 舊版欄位仍可使用，表示資料來源或業務分類。 |
| `updated_at` | string | popup | 資料更新日期，建議使用 `YYYY-MM-DD`。 |

## POINT_REGISTRY 設定範例

```js
const POINT_REGISTRY = {
  envRecycling: {
    id: 'envRecycling',
    label: '資源回收場',
    shortLabel: '回收場',
    icon: 'fa-recycle',
    file: 'env_facilities.json',
    defaultVisible: false,
    filterCategory: '資源回收場',
    idField: 'id',
    nameField: 'name',
    townField: 'town',
    addressField: 'address',
    countLabel: '回收場',
    categoryFields: [
      { field: 'category', tagClass: 'tag-service' },
      { field: 'sub_type', tagClass: 'tag-case' }
    ],
    popupFields: [
      { field: 'town', label: '所在鄉鎮' },
      { field: 'category', label: '設施類別' },
      { field: 'sub_type', label: '設施型態' },
      { field: 'shade_info', label: '遮蔭資訊' },
      { field: 'address', label: '地址' },
      { field: 'legacy_ai_coordinate_note', label: '歷史AI座標註記', internalOnly: true }
    ],
    marker: {
      color: '#10b981'
    }
  }
};
```

## 顯示規則

- `popupFields` 與 `listFields` 中的欄位只有在值不為空時才顯示。
- `filterCategory` 會依 GeoJSON properties 的 `category` 欄位篩出獨立點位圖層；未設定時顯示整份資料。
- 若同一份 GeoJSON 同時提供分類圖層與合計圖層，UI 應避免讓合計圖層與其分類子圖層同時啟用，以免重複統計。
- `type: 'risk'` 會使用警示樣式，適合舊版 `risk_note`。
- `type: 'action'` 會使用行動建議樣式，適合舊版 `adaptation_action`。
- 高溫主題保留雙模式比對：預設「純氣候危害度」優先使用 NCDR AR6 氣候網格，點位無網格值時回退至前端即時計算的行政區加權危害度；「NCDR 官方綜合風險」則讀取鄉鎮資料包內 `temp_risk_*` 欄位，代表已納入危害度、65 歲以上高齡人口比例與人口暴露的綜合風險。若資料的 `town` 文字註記與座標套疊結果不同，popup 會顯示差異並以座標套疊結果為準。
- 淹水點位外框不套用鄉鎮／行政區彙整風險；NCDR 淹水風險圖僅供策略層級與視覺參考。啟用水利署淹水潛勢時，系統會先做點位與潛勢多邊形的直接套疊；若點位未落入潛勢面，但距離最近潛勢面邊界 100 公尺內，會以距離反比加權（`1 - 距離 / 100m`）列為「鄰近淹水潛勢」，並沿用最近潛勢面的淹水深度級距。直接套疊或鄰近加權命中的點位都會以紅色警戒外框標示；未命中水利署圖資時顯示為「圖資未命中」，`hazard_level` 與 `display_risk` 為 null，不回退行政區風險，也不顯示為低風險或 L1。

## 靜態部署注意事項

- GeoJSON 檔案路徑需與 `POINT_REGISTRY.file` 完全一致，包含大小寫。
- 本頁使用 `fetch()` 載入 GeoJSON，請用 GitHub Pages、Netlify、Vercel 或本機 HTTP server 測試，不建議直接以 `file://` 開啟。
- 本機測試可在 repo 根目錄執行：

```bash
python3 -m http.server 4173
```

再開啟 `http://127.0.0.1:4173/GIS_Portal/`。

## v1.3.1 座標查核與風險語意欄位

資料集層級可記錄：

```json
{
  "coordinate_review_status": "manually_reviewed",
  "coordinate_review_scope": "all_points_in_dataset",
  "coordinate_review_count": 88
}
```

`coordinate_review_status` 預留值包含 `manually_reviewed` 與新增或異動點位使用的 `pending_review`；本版本由資料驗證腳本阻止未查核點位混入「全資料集已人工查核」宣稱。v1.3.1 基準資料為日照88處與環保設施52處，共140處，這些數量只代表該資料版本的回歸基準，不得作為正式程式常數。個別查核日期、人員、定位方法及量測精度尚未全面結構化紀錄。

現有點位檔案中的部分座標品質文字為早期AI工具產製時的歷史殘留，不代表目前資料查核狀態。現有140處點位後續已完成全面人工座標查核，系統不使用舊註記進行風險計算或品質判定。未來新增點位應經人工查核後再更新其查核狀態。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `legacy_ai_coordinate_note` | string | 此欄位為早期AI產製資料時的歷史殘留，不代表目前人工查核結果，不得用於風險計算、篩選、警示或統計。 |

水利署點位判定狀態：`direct_overlay`、`near_0_25m`、`near_25_50m`、`near_50_75m`、`near_75_100m`、`no_hit`、`no_data`。直接套疊需保留 `depth_type`、原始 `grid_code`（2–6）與畫面 `display_risk`（1–5）；`no_hit` 與 `no_data` 的 `hazard_level` / `display_risk` 為 `null`，不得顯示為低風險或 L1。`direct_overlay` 另提供 `boundary_distance_m`，表示點位位於勝出潛勢面內時到該勝出 feature 最近邊界的距離。

## 點位資料動態集合規則

- `POINT_REGISTRY.datasetId` 是資料集識別碼。唯一點位鍵固定為 `` `${dataset_id}:${String(feature_id)}` ``，數字 ID 一律轉為字串後組鍵。
- `getActivePointFeatures()` 只代表目前畫面啟用圖層，供圖層、清單及目前顯示統計使用。
- `getAllUniquePointFeatures()` 代表當前資料版本內全部不重複的正式 active 點位，供全資料母體、資料品質摘要及設施百分位母體使用。
- 同一 GeoJSON 可供合計層與分類層共用。不得直接串接 `POINT_REGISTRY` 的所有項目計數。
- `properties.status` 省略時視為 `active`；裁撤設施使用 `status: "retired"`。retired feature 保留供稽核，並從圖層、清單、統計及設施百分位母體排除。
- `config/PointDatasetConfig.json` 記錄資料集、必填欄位、可見分類及合計層專用分類。新增非空白 `category` 時，必須加入可見的 `POINT_REGISTRY.filterCategory` 圖層，或明確列入 `aggregate_only_categories`。

## 座標查核與異動規則

1. 資料集宣稱 `coordinate_review_scope: all_points_in_dataset` 且 `coordinate_review_status: manually_reviewed` 時，`coordinate_review_count` 必須等於實際 feature 數量，包含已退休但仍留存的 feature。
2. 新增且尚未完成查核的點位，在 feature 標示 `coordinate_review_status: pending_review`，資料集層級同步取消全數已查核宣稱。
3. 既有點位座標異動時，feature 必須重設為 `pending_review`，或新增含 `reviewed_at`、`reviewed_by` 的 `coordinate_review_record`。
4. `feature_id` 不得變更或重用。既有 feature 不得刪除；裁撤時改標 `status: retired`。
5. `legacy_ai_coordinate_note`、座標小數位數、地址格式及舊 `exact`／`approx` 文字均不參與人工查核狀態判定。

## 點位資料維護標準流程

1. 在工作分支新增或更新 GeoJSON feature，不直接修改 `main`。
2. 確認 `feature_id` 唯一、不可重用，並維持固定 `dataset_id`。
3. 確認新 `category` 已有可見 registry 圖層，或已明列為合計層專用分類。
4. 完成人工座標查核；尚未完成或座標剛異動時標示 `pending_review`。
5. 執行 `node tools/validate_points.mjs`，檢查 GeoJSON、Point 座標、行政區、分類覆蓋、查核計數及 retired 排除。
6. 正式點位資料版本更新且完成審查後，執行 `node tools/validate_points.mjs --update-baseline`，由工具產生新的 `dataset_version`、`point_count`、`category_counts`、`risk_baseline` 與 `generated_at`。不得手工修改基準數字。
7. 執行 `node tools/regression_checks.mjs`，確認資料未變的點位在高溫原始值、絕對7級、GridID、WRA方法、勝出 feature、`grid_code`、`depth_type`、距離及全縣網格百分位均維持一致。
8. 執行 `node tools/test_dynamic_point_addition.mjs`，確認記憶體內測試點位會使資料集、分類、鄉鎮、總數及風險分布增加1，並取得高溫與WRA判定。測試 fixture 不寫入正式資料，也不提交 Git。
9. 檢查提交內容後，以 Minimal Commit 推送分支並建立 PR。`tools/output/` 報告、fixture、截圖、log、cache、binary、金鑰及 token 均不得進入提交。

驗證器固定輸出 `tools/output/point_validation_report.json` 與 `tools/output/point_validation_report.md`，兩者含 `dataset_version` 與 `generated_at`，且已由 `.gitignore` 排除。PR 會透過 `.github/workflows/validate-points.yml` 重跑靜態數量掃描、資料驗證、逐點不變性及動態新增測試。
