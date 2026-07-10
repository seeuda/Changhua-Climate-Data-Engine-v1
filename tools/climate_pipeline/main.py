import os
import csv
import json
import glob
from collections import OrderedDict

# ==========================================
# Climate Data Pipeline (CDP)
# ==========================================

# 1 degree lat is approx 111 km. 5km is approx 0.045 degrees.
# We will use +/- 0.0225 for the bounding box around the center point.
GRID_SIZE_DEG = 0.045
HALF_GRID = GRID_SIZE_DEG / 2.0

# Base directories
BASE_INPUT_DIR = r"G:\我的雲端硬碟\Gemini Gems\業務研究\【素材】GIS應用\AR6_氣候變遷關鍵指標_彰化縣_溫度指標"
BASE_OUTPUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'data'))

def parse_filename(filename):
    basename = os.path.basename(filename).replace(".csv", "")
    parts = basename.split("_")
    
    try:
        if len(parts) >= 7:
            indicator = parts[4] # e.g. 日夜溫差
            scenario = parts[5] # e.g. ssp126
            model = "_".join(parts[6:]) # e.g. ACCESS-CM2
        else:
            indicator = "unknown_indicator"
            scenario = "unknown_scenario"
            model = basename
    except Exception:
        indicator = "unknown"
        scenario = "unknown"
        model = basename
        
    return indicator, scenario, model

def build_grid_polygon(lon, lat):
    # Return a polygon for GeoJSON
    return [
        [lon - HALF_GRID, lat - HALF_GRID],
        [lon + HALF_GRID, lat - HALF_GRID],
        [lon + HALF_GRID, lat + HALF_GRID],
        [lon - HALF_GRID, lat + HALF_GRID],
        [lon - HALF_GRID, lat - HALF_GRID]
    ]

def main():
    if not os.path.exists(BASE_OUTPUT_DIR):
        os.makedirs(BASE_OUTPUT_DIR)
        
    grid_registry = OrderedDict() # (lon, lat) -> GridID
    grid_geojson = {
        "type": "FeatureCollection",
        "dataset_version": "AR6_v112",
        "schema_version": "Grid_v1",
        "features": []
    }
    
    csv_files = glob.glob(os.path.join(BASE_INPUT_DIR, "**", "*.csv"), recursive=True)
    if not csv_files:
        print("未找到任何 CSV 檔案，請確認 G 槽掛載與路徑。")
        return
        
    print(f"找到 {len(csv_files)} 個 CSV 檔案，開始執行 CDP 轉換...")
    
    grid_counter = 1
    
    for file_path in csv_files:
        indicator, scenario, model = parse_filename(file_path)
        
        output_dir = os.path.join(BASE_OUTPUT_DIR, indicator, scenario)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
            
        output_data = {
            "dataset_version": "AR6_v112",
            "schema_version": "Grid_v1",
            "model": model,
            "scenario": scenario,
            "indicator": indicator,
            "values": {} # Year -> {GridID: value}
        }
        
        with open(file_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            headers = next(reader)
            
            # The headers are LON, LAT, 2018, 2019, ...
            years = [h.strip() for h in headers[2:] if h.strip()]
            
            for y in years:
                output_data["values"][y] = {}
                
            for row in reader:
                if not row or len(row) < 3:
                    continue
                    
                lon = float(row[0])
                lat = float(row[1])
                coords = (lon, lat)
                
                # Assign GridID
                if coords not in grid_registry:
                    grid_id = f"GRID_{grid_counter:05d}"
                    grid_registry[coords] = grid_id
                    grid_counter += 1
                    
                    # Add to GeoJSON
                    grid_geojson["features"].append({
                        "type": "Feature",
                        "properties": {
                            "GridID": grid_id,
                            "lon": lon,
                            "lat": lat
                        },
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [build_grid_polygon(lon, lat)]
                        }
                    })
                
                grid_id = grid_registry[coords]
                
                # Check if all values are -99.9
                vals = [float(v) for v in row[2:] if v.strip()]
                if all(v == -99.9 for v in vals):
                    continue # Skip invalid grids for this dataset
                    
                for i, y in enumerate(years):
                    if i < len(vals):
                        val = vals[i]
                        if val != -99.9:
                            output_data["values"][y][grid_id] = val
                            
        # Save JSON
        json_path = os.path.join(output_dir, f"{model}.json")
        with open(json_path, 'w', encoding='utf-8') as jf:
            json.dump(output_data, jf, ensure_ascii=False, indent=2)
            
        print(f"已輸出: {json_path}")
        
    # Finally save the GeoJSON
    geojson_path = os.path.join(BASE_OUTPUT_DIR, "climate_grids.geojson")
    with open(geojson_path, 'w', encoding='utf-8') as f:
        json.dump(grid_geojson, f, ensure_ascii=False)
    print(f"地理邊界檔已輸出: {geojson_path}")
    print("CDP 管線執行完畢。")

if __name__ == "__main__":
    main()
