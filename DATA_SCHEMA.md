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
| `note` | string | popup / 列表 | 資料註記；例如座標來源或待補充說明。 |
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
      { field: 'note', label: '資料註記' }
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
- 點位外框會依目前啟用的氣候風險圖層與情境，以點位座標套疊鄉鎮界後讀取實際地理所屬鄉鎮的風險等級渲染；第 4、5 級外框較粗。若資料的 `town` 文字註記與座標套疊結果不同，popup 會顯示差異並以座標套疊結果為準。
- 啟用水利署淹水潛勢時，系統會先做點位與潛勢多邊形的直接套疊；若點位未落入潛勢面，但距離最近潛勢面邊界 100 公尺內，會以距離反比加權（`1 - 距離 / 100m`）列為「鄰近淹水潛勢」，並沿用最近潛勢面的淹水深度級距。直接套疊或鄰近加權命中的點位都會以紅色警戒外框標示。

## 靜態部署注意事項

- GeoJSON 檔案路徑需與 `POINT_REGISTRY.file` 完全一致，包含大小寫。
- 本頁使用 `fetch()` 載入 GeoJSON，請用 GitHub Pages、Netlify、Vercel 或本機 HTTP server 測試，不建議直接以 `file://` 開啟。
- 本機測試可在 repo 根目錄執行：

```bash
python3 -m http.server 4173
```

再開啟 `http://127.0.0.1:4173/GIS_Portal/`。
