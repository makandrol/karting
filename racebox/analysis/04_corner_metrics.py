"""
Детальний per-corner per-lap аналіз.

Для кожного повороту обчислюємо:
- min швидкість в зоні повороту, та позицію цього мінімуму
- швидкість входу (~30м до апексу) і виходу (~30м після)
- max поздовжнє "гальмівне" g (gx найменше) і його положення
- max бічне g (|gy|)
- "різкість керма" — std швидкості зміни heading у зоні повороту (рад/с) — чим вище, тим різкіше
- довжина гальмівної зони (м) — від точки де gx стає < -0.15g до min швидкості
- "coast time" — час між кінцем гальмування і початком прискорення (де gx > 0.05g стабільно)
- "trail-brake overlap" — час де gx<-0.1 І |gy|>0.4 одночасно (хороше для гальмування з заходом)

Похідні величини рахуємо на згладжених сигналах.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.signal import savgol_filter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "analysis" / "out"


def smooth(arr, win=9):
    if len(arr) < win + 2:
        return arr
    return savgol_filter(arr, win, 3)


def heading_unwrap(h_deg):
    rad = np.unwrap(np.radians(h_deg))
    return rad


def main() -> None:
    df = pd.read_parquet(OUT / "telemetry_with_s.parquet")
    laps_df = pd.read_csv(OUT / "laps.csv")
    with (OUT / "corners.json").open() as f:
        corners = json.load(f)

    # Зони поворотів за s-координатою (з буфером)
    # Беремо вікно (-25м до апексу, +25м після), але обрізаємо щоб не перекривалися
    s_apex = [c["apex_s"] for c in corners]
    track_len = df["s"].max()

    zones = []
    for i, c in enumerate(corners):
        s_in = c["entry_s"] - 5  # трохи до точки входу
        s_out = c["exit_s"] + 5
        zones.append((c["n"], s_in, s_out, c["apex_s"], c["direction"]))

    rows = []
    for (sess, lap), grp in df.groupby(["session_file", "lap"]):
        if lap == 0 or len(grp) < 50:
            continue
        # Перевірка: коло мусить мати валідну дистанцію (повне коло)
        if grp["s"].max() - grp["s"].min() < track_len * 0.5:
            continue

        grp = grp.sort_values("t_s").reset_index(drop=True)
        speed = smooth(grp["speed_kmh"].values)
        gx = smooth(grp["gx"].values)
        gy = smooth(grp["gy"].values)
        s = grp["s"].values
        heading = heading_unwrap(grp["heading"].values)
        # Кутова швидкість керма (proxy)
        dt = np.diff(grp["t_s"].values, prepend=grp["t_s"].values[0])
        dt = np.where(dt == 0, 0.1, dt)
        yaw_rate = np.gradient(heading, grp["t_s"].values)  # рад/с
        yaw_jerk = np.gradient(yaw_rate, grp["t_s"].values)  # рад/с^2 — різкість

        for (n, s_in, s_out, s_ap, direction) in zones:
            # Враховуємо випадки коли коло "перетинає" 0 (старт) — у нас всі повороти не біля старту, тому ок
            mask = (s >= s_in) & (s <= s_out)
            if mask.sum() < 5:
                continue
            seg_speed = speed[mask]
            seg_gx = gx[mask]
            seg_gy = gy[mask]
            seg_s = s[mask]
            seg_t = grp["t_s"].values[mask]
            seg_yaw_jerk = yaw_jerk[mask]
            seg_yaw_rate = yaw_rate[mask]

            # min швидкість і її s
            min_idx = int(np.argmin(seg_speed))
            min_speed = float(seg_speed[min_idx])
            min_s = float(seg_s[min_idx])

            # entry speed: швидкість на ~25м до min_s (або в s_in)
            target_in = max(s_in, min_s - 20)
            i_entry = int(np.argmin(np.abs(seg_s - target_in)))
            entry_speed = float(seg_speed[i_entry])

            # exit speed: на ~25м після min_s
            target_out = min(s_out, min_s + 20)
            i_exit = int(np.argmin(np.abs(seg_s - target_out)))
            exit_speed = float(seg_speed[i_exit])

            # Гальмівний пік
            brake_peak = float(np.min(seg_gx))
            brake_peak_s = float(seg_s[int(np.argmin(seg_gx))])
            # Тривалість гальмування: gx < -0.2 g від першого такого до min швидкості
            brake_mask = seg_gx < -0.2
            if brake_mask.any():
                brake_start = int(np.argmax(brake_mask))  # перший True
                brake_dist = float(seg_s[min_idx] - seg_s[brake_start]) if min_idx >= brake_start else 0.0
                brake_time = float(seg_t[min_idx] - seg_t[brake_start]) if min_idx >= brake_start else 0.0
            else:
                brake_dist = 0.0
                brake_time = 0.0

            # Coast: gx ~ 0 між кінцем гальма і початком газу
            # Кінець гальма — останній індекс де gx<-0.15 в зоні
            coast_end_mask = seg_gx < -0.15
            if coast_end_mask.any():
                last_brake = np.where(coast_end_mask)[0].max()
            else:
                last_brake = min_idx
            # Початок газу: перший індекс після last_brake де gx>0.1
            after = seg_gx[last_brake:]
            gas_rel = np.where(after > 0.1)[0]
            if len(gas_rel) > 0:
                gas_start = last_brake + int(gas_rel[0])
                coast_time = float(seg_t[gas_start] - seg_t[last_brake])
                # Швидкість в момент газу
                gas_start_speed = float(seg_speed[gas_start])
                gas_start_s = float(seg_s[gas_start])
            else:
                coast_time = float(seg_t[-1] - seg_t[last_brake])
                gas_start_speed = float(seg_speed[-1])
                gas_start_s = float(seg_s[-1])

            # Trail brake overlap: одночасно гальмо і поворот
            trail_mask = (seg_gx < -0.1) & (np.abs(seg_gy) > 0.4)
            trail_time = float(np.sum(trail_mask) * 0.1)  # 10Hz

            # Max бічне g
            max_lat_g = float(np.max(np.abs(seg_gy)))

            # Різкість керма: std швидкості зміни heading біля апексу
            steer_std = float(np.std(seg_yaw_rate))
            steer_jerk_max = float(np.max(np.abs(seg_yaw_jerk)))

            rows.append(
                {
                    "session": sess,
                    "lap": lap,
                    "lap_time": laps_df[(laps_df["session"] == sess) & (laps_df["lap"] == lap)]["time"].values[0]
                    if len(laps_df[(laps_df["session"] == sess) & (laps_df["lap"] == lap)]) > 0
                    else np.nan,
                    "corner": n,
                    "direction": direction,
                    "entry_speed": entry_speed,
                    "min_speed": min_speed,
                    "exit_speed": exit_speed,
                    "min_s": min_s,
                    "brake_peak_g": brake_peak,
                    "brake_dist_m": brake_dist,
                    "brake_time_s": brake_time,
                    "coast_time_s": coast_time,
                    "trail_brake_s": trail_time,
                    "max_lat_g": max_lat_g,
                    "steer_yaw_std": steer_std,
                    "steer_yaw_jerk": steer_jerk_max,
                    "gas_start_speed": gas_start_speed,
                    "gas_start_s": gas_start_s,
                }
            )

    metrics = pd.DataFrame(rows)
    metrics.to_parquet(OUT / "corner_metrics.parquet")
    metrics.to_csv(OUT / "corner_metrics.csv", index=False)

    # Summary by corner
    print("\n=== Усереднені метрики по поворотах (всі сесії, всі чисті кола) ===\n")
    summary = metrics.groupby("corner").agg(
        n_laps=("lap", "count"),
        entry_kmh_mean=("entry_speed", "mean"),
        entry_kmh_std=("entry_speed", "std"),
        min_kmh_mean=("min_speed", "mean"),
        min_kmh_std=("min_speed", "std"),
        exit_kmh_mean=("exit_speed", "mean"),
        exit_kmh_std=("exit_speed", "std"),
        brake_peak_mean=("brake_peak_g", "mean"),
        brake_dist_mean=("brake_dist_m", "mean"),
        brake_time_mean=("brake_time_s", "mean"),
        coast_time_mean=("coast_time_s", "mean"),
        trail_brake_mean=("trail_brake_s", "mean"),
        max_lat_g_mean=("max_lat_g", "mean"),
        steer_jerk_mean=("steer_yaw_jerk", "mean"),
    ).round(2)
    print(summary.to_string())
    summary.to_csv(OUT / "corner_summary.csv")

    # Кореляція з часом кола: які повороти найсильніше впливають на lap_time?
    print("\n=== Кореляція метрик з часом кола (по поворотах) ===")
    print("(від'ємна кореляція з min_speed/exit_speed = краще; з brake_time = більше гальма погіршує)")
    corr_rows = []
    for n, grp in metrics.groupby("corner"):
        if len(grp) < 10:
            continue
        valid = grp.dropna(subset=["lap_time"])
        if len(valid) < 10:
            continue
        for col in ["entry_speed", "min_speed", "exit_speed", "brake_dist_m",
                    "brake_time_s", "coast_time_s", "trail_brake_s",
                    "max_lat_g", "steer_yaw_jerk"]:
            corr = valid["lap_time"].corr(valid[col])
            corr_rows.append({"corner": n, "metric": col, "corr_with_lap_time": round(corr, 3)})
    corr_df = pd.DataFrame(corr_rows).pivot(index="corner", columns="metric", values="corr_with_lap_time")
    print(corr_df.to_string())
    corr_df.to_csv(OUT / "corner_corr.csv")


if __name__ == "__main__":
    main()
