"""
Виявлення поворотів та розрахунок дистанції.

Алгоритм:
1. Беремо найшвидше коло як референс (траса = центральна лінія).
2. Конвертуємо lat/lon в локальні метри (рівнокутна проєкція щодо центру).
3. Рахуємо кумулятивну дистанцію вздовж кола (s, м).
4. Знаходимо повороти за швидкістю (локальні мінімуми) та |gy| (поперечне g).
5. Для всіх інших кіл знаходимо найближчу точку на референсному колі (1D відображення → s).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.signal import savgol_filter, find_peaks
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "analysis" / "out"
OUT.mkdir(parents=True, exist_ok=True)


def latlon_to_xy(lat: np.ndarray, lon: np.ndarray, lat0: float, lon0: float) -> tuple[np.ndarray, np.ndarray]:
    R = 6371000.0
    x = (np.radians(lon - lon0)) * R * np.cos(np.radians(lat0))
    y = (np.radians(lat - lat0)) * R
    return x, y


def cumulative_distance(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    dx = np.diff(x, prepend=x[0])
    dy = np.diff(y, prepend=y[0])
    d = np.sqrt(dx * dx + dy * dy)
    return np.cumsum(d)


def main() -> None:
    df = pd.read_parquet(OUT / "telemetry.parquet")
    laps_df = pd.read_csv(OUT / "laps.csv")

    # 1. Найкраще коло як референс
    best_row = laps_df.loc[laps_df["time"].idxmin()]
    best_session = best_row["session"]
    best_lap = int(best_row["lap"])
    print(f"Reference lap: {best_session} lap {best_lap}, time={best_row['time']}")

    ref = df[(df["session_file"] == best_session) & (df["lap"] == best_lap)].copy().reset_index(drop=True)
    lat0 = ref["lat"].mean()
    lon0 = ref["lon"].mean()

    # Глобальна проєкція для всіх сесій (єдина система координат)
    df["x"], df["y"] = latlon_to_xy(df["lat"].values, df["lon"].values, lat0, lon0)

    ref["x"], ref["y"] = latlon_to_xy(ref["lat"].values, ref["lon"].values, lat0, lon0)
    ref["s"] = cumulative_distance(ref["x"].values, ref["y"].values)
    track_length = ref["s"].iloc[-1]
    print(f"Reference lap length: {track_length:.1f} m")

    ref.to_parquet(OUT / "reference_lap.parquet")

    # 2. Згладжуємо швидкість і знаходимо мінімуми = повороти
    speed = ref["speed_kmh"].values
    win = max(5, len(speed) // 50 | 1)  # непарне, ~2% довжини
    speed_smooth = savgol_filter(speed, win, 3)
    # Інверсія для пошуку піків
    inv = -speed_smooth
    # min distance ~3 секунди (30 семплів)
    peaks, props = find_peaks(inv, distance=20, prominence=2.0)

    # Фільтр: швидкість в мінімумі мусить бути < 80% максимуму на колі
    vmax = speed_smooth.max()
    peaks = [p for p in peaks if speed_smooth[p] < 0.85 * vmax]

    # Знаходимо вхід (точка початку гальмування) і вихід (повне відкриття газу) для кожного повороту
    # Згладжуємо gx (поздовжнє g) і gy (поперечне)
    gx = ref["gx"].values
    gy = ref["gy"].values
    gx_s = savgol_filter(gx, win, 3)
    gy_s = savgol_filter(gy, win, 3)

    corners = []
    for i, apex_idx in enumerate(peaks):
        # Вхід: іти назад поки швидкість зростає (тобто це початок зниження)
        j = apex_idx
        while j > 1 and speed_smooth[j - 1] >= speed_smooth[j] - 0.2:
            j -= 1
        entry_idx = j
        # Вихід: іти вперед поки швидкість зростає
        k = apex_idx
        while k < len(speed_smooth) - 2 and speed_smooth[k + 1] >= speed_smooth[k] - 0.2:
            k += 1
        exit_idx = k

        # Напрямок повороту з gy (на референсі): + або -
        seg = gy_s[entry_idx : exit_idx + 1]
        direction = "L" if seg.mean() > 0 else "R"
        # gy в kart іноді інвертований - визначимо просто за зміною heading
        heading = ref["heading"].values
        h0 = heading[entry_idx]
        h1 = heading[exit_idx]
        dh = (h1 - h0 + 540) % 360 - 180  # signed shortest delta
        direction = "L" if dh > 0 else "R"
        turn_angle = abs(dh)

        corners.append(
            {
                "n": i + 1,
                "entry_idx": int(entry_idx),
                "apex_idx": int(apex_idx),
                "exit_idx": int(exit_idx),
                "entry_s": float(ref["s"].iloc[entry_idx]),
                "apex_s": float(ref["s"].iloc[apex_idx]),
                "exit_s": float(ref["s"].iloc[exit_idx]),
                "apex_speed_kmh": float(speed_smooth[apex_idx]),
                "entry_speed_kmh": float(speed_smooth[entry_idx]),
                "exit_speed_kmh": float(speed_smooth[exit_idx]),
                "min_speed_kmh": float(speed_smooth[entry_idx : exit_idx + 1].min()),
                "max_lat_g": float(np.max(np.abs(gy_s[entry_idx : exit_idx + 1]))),
                "max_brake_g": float(np.min(gx_s[entry_idx : exit_idx + 1])),
                "direction": direction,
                "angle_deg": float(turn_angle),
                "apex_x": float(ref["x"].iloc[apex_idx]),
                "apex_y": float(ref["y"].iloc[apex_idx]),
            }
        )

    print(f"\nDetected {len(corners)} corners on reference lap:")
    for c in corners:
        print(
            f"  T{c['n']:2d} {c['direction']} apex@{c['apex_s']:6.1f}m "
            f"min={c['min_speed_kmh']:5.1f} km/h, "
            f"entry={c['entry_speed_kmh']:5.1f}, exit={c['exit_speed_kmh']:5.1f}, "
            f"angle≈{c['angle_deg']:.0f}°"
        )

    with (OUT / "corners.json").open("w") as f:
        json.dump(corners, f, indent=2, ensure_ascii=False)

    # 3. Для всіх кіл — мапимо точки до s референсного кола
    print("\nMapping all laps to reference s-coordinate...")
    ref_xy = np.column_stack([ref["x"].values, ref["y"].values])
    tree = cKDTree(ref_xy)

    # Беремо тільки повні кола (не "Incomplete")
    df["s"] = np.nan
    for (sess, lap), grp in df.groupby(["session_file", "lap"]):
        if lap == 0:
            continue  # warm-up / out lap
        xy = np.column_stack([grp["x"].values, grp["y"].values])
        _, idx = tree.query(xy, k=1)
        df.loc[grp.index, "s"] = ref["s"].values[idx]

    df.to_parquet(OUT / "telemetry_with_s.parquet")
    print("Saved telemetry_with_s.parquet")


if __name__ == "__main__":
    main()
