"""Підсумкові цифри для фінального звіту."""
from pathlib import Path
import json
import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent.parent / "analysis" / "out"
metrics = pd.read_parquet(OUT / "corner_metrics.parquet")
laps = pd.read_csv(OUT / "laps.csv")

print("=== ЗАГАЛЬНІ ===")
valid = laps[(laps["time"] < 47) & (laps["lap"] > 1)]
print(f"Кіл: {len(valid)}")
print(f"Best: {valid['time'].min():.3f}c, mean: {valid['time'].mean():.3f}c, std: {valid['time'].std():.3f}c")
for s in sorted(laps["session"].unique()):
    sub = laps[(laps["session"] == s) & (laps["time"] < 47) & (laps["lap"] > 1)]
    print(f"  {s.split('on ')[-1].replace('.csv','')}: best={sub['time'].min():.3f}, mean={sub['time'].mean():.3f}, std={sub['time'].std():.3f}, n={len(sub)}")

print("\n=== ДЕЛЬТА (best - median) min/exit на КОЖНОМУ ПОВОРОТІ ===")
print("(скільки км/год ти можеш ще додати, якщо стабільно їздити по best 5%)")
for c in [1, 2, 3, 4, 5, 6]:
    sub = metrics[metrics["corner"] == c]
    min_med = sub["min_speed"].median()
    min_p95 = sub["min_speed"].quantile(0.95)
    exit_med = sub["exit_speed"].median()
    exit_p95 = sub["exit_speed"].quantile(0.95)
    brake_med = sub["brake_time_s"].median()
    brake_min = sub["brake_time_s"].quantile(0.1)
    coast_med = sub["coast_time_s"].median()
    print(
        f"T{c}: min {min_med:.1f}→{min_p95:.1f} (+{min_p95-min_med:.1f}), "
        f"exit {exit_med:.1f}→{exit_p95:.1f} (+{exit_p95-exit_med:.1f}), "
        f"brake_t {brake_med:.2f}c (мін {brake_min:.2f}c), coast {coast_med:.2f}c"
    )

print("\n=== Кореляція exit_speed[T] з lap_time ===")
for c in [1,2,3,4,5,6]:
    sub = metrics[metrics["corner"] == c].dropna(subset=["lap_time"])
    if len(sub) > 10:
        print(f"T{c}: r(exit, lap_time)={sub['exit_speed'].corr(sub['lap_time']):.3f}, r(min, lap)={sub['min_speed'].corr(sub['lap_time']):.3f}")

print("\n=== Як best lap відрізняється від медіани НА КОЖНОМУ ПОВОРОТІ ===")
# best lap = (session_file=21-52, lap=10)
best_lap = metrics[(metrics["session"] == "RaceBox Track Sessionon 29-05-2026 21-52.csv") & (metrics["lap"] == 10)]
for c in [1,2,3,4,5,6]:
    sub = metrics[metrics["corner"] == c]
    bl = best_lap[best_lap["corner"] == c].iloc[0]
    print(
        f"T{c}: BEST min={bl['min_speed']:.1f} (median {sub['min_speed'].median():.1f}, +{bl['min_speed']-sub['min_speed'].median():+.1f}), "
        f"exit={bl['exit_speed']:.1f} (med {sub['exit_speed'].median():.1f}, {bl['exit_speed']-sub['exit_speed'].median():+.1f}), "
        f"brake={bl['brake_time_s']:.2f}c (med {sub['brake_time_s'].median():.2f}), "
        f"coast={bl['coast_time_s']:.2f}c"
    )

# Аналіз "пилоподібного" gx — стабільність газу/гальма
print("\n=== Пилоподібність gx (трансляції газ↔гальмо) на best lap vs середньому ===")
import pandas as pd
df = pd.read_parquet(OUT / "telemetry_with_s.parquet")
from scipy.signal import savgol_filter

def transitions(arr):
    g = savgol_filter(arr, 9, 3)
    state = np.where(g > 0.1, 1, np.where(g < -0.15, -1, 0))
    diffs = np.diff(state)
    # transitions where state changed (включно з через "0")
    return int(np.sum(diffs != 0))

# best lap
sub_b = df[(df["session_file"] == "RaceBox Track Sessionon 29-05-2026 21-52.csv") & (df["lap"] == 10)]
print(f"Best lap (42.636c): {transitions(sub_b['gx'].values)} переходів gas/coast/brake")

# Усі чисті кола
counts = []
for (sess, lap), grp in df.groupby(["session_file", "lap"]):
    if lap == 0 or len(grp) < 100:
        continue
    counts.append(transitions(grp["gx"].values))
print(f"Всі кола: median={np.median(counts):.0f}, p25={np.percentile(counts,25):.0f}, p75={np.percentile(counts,75):.0f}")
