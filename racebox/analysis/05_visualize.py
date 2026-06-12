"""
Візуалізації:
1. Speed-vs-distance: всі кола сірими + best (червоний) + 4 найгірших.
2. Speed + gx + gy traces для best vs avg для кожного сектора.
3. Бокс-плоти min_speed по поворотах для кожної сесії (різні карти).
4. Карта швидкості з різницею best vs worst (де ти найбільше втрачаєш).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection
from scipy.signal import savgol_filter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "analysis" / "out"
IMG = ROOT / "analysis" / "img"

plt.rcParams.update(
    {
        "figure.facecolor": "#0b1020",
        "axes.facecolor": "#0b1020",
        "axes.edgecolor": "#444",
        "axes.labelcolor": "#ccc",
        "xtick.color": "#aaa",
        "ytick.color": "#aaa",
        "text.color": "#eee",
        "axes.titlecolor": "#fff",
        "font.size": 10,
    }
)


def smooth(arr, win=9):
    if len(arr) < win + 2:
        return arr
    return savgol_filter(arr, win, 3)


def main() -> None:
    df = pd.read_parquet(OUT / "telemetry_with_s.parquet")
    laps_df = pd.read_csv(OUT / "laps.csv")
    metrics = pd.read_parquet(OUT / "corner_metrics.parquet")
    with (OUT / "corners.json").open() as f:
        corners = json.load(f)
    ref = pd.read_parquet(OUT / "reference_lap.parquet")

    # Топ best і worst кола (тільки повні чисті)
    valid_laps = laps_df[(laps_df["time"] < 47) & (laps_df["lap"] > 1)].copy().sort_values("time")
    best = valid_laps.iloc[0]
    worst = valid_laps.iloc[-1]

    # ---- 1. Speed vs distance — всі кола
    fig, ax = plt.subplots(figsize=(14, 6))
    for _, row in valid_laps.iterrows():
        sub = df[(df["session_file"] == row["session"]) & (df["lap"] == row["lap"])].sort_values("s")
        if len(sub) < 50:
            continue
        ax.plot(sub["s"], smooth(sub["speed_kmh"].values), color="#888", alpha=0.12, lw=0.8)

    # best
    sub = df[(df["session_file"] == best["session"]) & (df["lap"] == best["lap"])].sort_values("s")
    ax.plot(sub["s"], smooth(sub["speed_kmh"].values), color="#39ff14", lw=2.5, label=f"BEST: {best['time']:.3f} с (lap {best['lap']})")

    # worst
    sub = df[(df["session_file"] == worst["session"]) & (df["lap"] == worst["lap"])].sort_values("s")
    ax.plot(sub["s"], smooth(sub["speed_kmh"].values), color="#ff3060", lw=1.8, label=f"WORST: {worst['time']:.3f} с")

    # average
    avg_speed = []
    for s_target in np.arange(0, ref["s"].iloc[-1], 1):
        vals = []
        for _, row in valid_laps.iterrows():
            sub = df[(df["session_file"] == row["session"]) & (df["lap"] == row["lap"])]
            if len(sub) < 10:
                continue
            i = int(np.argmin(np.abs(sub["s"].values - s_target)))
            vals.append(sub["speed_kmh"].values[i])
        avg_speed.append(np.mean(vals) if vals else np.nan)
    avg_speed = np.array(avg_speed)
    ax.plot(np.arange(0, ref["s"].iloc[-1], 1), avg_speed, color="#fff", lw=2, alpha=0.7, label="Середня")

    # corner markers
    for c in corners:
        ax.axvline(c["apex_s"], color="#ff3060", alpha=0.25, lw=1)
        ax.text(c["apex_s"], 60, f"T{c['n']}", color="#ff3060", fontweight="bold", ha="center")
    ax.set_xlabel("Дистанція по колу, м")
    ax.set_ylabel("Швидкість, км/год")
    ax.set_title("Швидкісний профіль: всі кола (сірі), середня (біла), найкраще (зелене), найгірше (червоне)")
    ax.legend(loc="lower right")
    ax.grid(alpha=0.15)
    ax.set_xlim(0, ref["s"].iloc[-1])
    plt.tight_layout()
    plt.savefig(IMG / "03_speed_vs_distance.png", dpi=150)
    plt.close()
    print("Saved 03_speed_vs_distance.png")

    # ---- 2. Per-corner speed/gx/gy traces (best vs avg)
    fig, axes = plt.subplots(3, 6, figsize=(20, 10), sharex="col")
    for col, c in enumerate(corners):
        s_in = max(0, c["entry_s"] - 15)
        s_out = min(ref["s"].iloc[-1], c["exit_s"] + 15)

        # best
        sub_b = df[(df["session_file"] == best["session"]) & (df["lap"] == best["lap"])]
        sub_b = sub_b[(sub_b["s"] >= s_in) & (sub_b["s"] <= s_out)].sort_values("s")

        # all valid laps
        all_v, all_gx, all_gy, s_grid = [], [], [], np.arange(s_in, s_out, 0.5)
        for _, row in valid_laps.iterrows():
            sub = df[(df["session_file"] == row["session"]) & (df["lap"] == row["lap"])].sort_values("s")
            sub = sub[(sub["s"] >= s_in - 5) & (sub["s"] <= s_out + 5)]
            if len(sub) < 10:
                continue
            ss = sub["s"].values
            v_interp = np.interp(s_grid, ss, smooth(sub["speed_kmh"].values))
            gx_interp = np.interp(s_grid, ss, smooth(sub["gx"].values))
            gy_interp = np.interp(s_grid, ss, smooth(sub["gy"].values))
            all_v.append(v_interp)
            all_gx.append(gx_interp)
            all_gy.append(gy_interp)
        all_v = np.array(all_v)
        all_gx = np.array(all_gx)
        all_gy = np.array(all_gy)
        v_mean = np.mean(all_v, axis=0)
        v_p10 = np.percentile(all_v, 10, axis=0)
        v_p90 = np.percentile(all_v, 90, axis=0)

        # SPEED
        ax = axes[0, col]
        ax.fill_between(s_grid, v_p10, v_p90, color="#888", alpha=0.25, label="10-90%")
        ax.plot(s_grid, v_mean, color="#fff", lw=1.5, alpha=0.7, label="середня")
        ax.plot(sub_b["s"], smooth(sub_b["speed_kmh"].values), color="#39ff14", lw=2, label="best")
        ax.axvline(c["apex_s"], color="#ff3060", alpha=0.5, lw=1)
        ax.set_title(f"T{c['n']} ({c['direction']})\napex {c['apex_s']:.0f}м, мін {c['min_speed_kmh']:.0f}км/год", fontsize=10)
        if col == 0:
            ax.set_ylabel("Швидкість, км/год")
            ax.legend(loc="lower right", fontsize=8)
        ax.grid(alpha=0.15)

        # GX (longitudinal — гальмо/газ)
        ax = axes[1, col]
        gx_mean = np.mean(all_gx, axis=0)
        gx_p10 = np.percentile(all_gx, 10, axis=0)
        gx_p90 = np.percentile(all_gx, 90, axis=0)
        ax.fill_between(s_grid, gx_p10, gx_p90, color="#888", alpha=0.25)
        ax.plot(s_grid, gx_mean, color="#fff", lw=1.5, alpha=0.7)
        ax.plot(sub_b["s"], smooth(sub_b["gx"].values), color="#39ff14", lw=2)
        ax.axhline(0, color="#666", lw=0.7)
        ax.axvline(c["apex_s"], color="#ff3060", alpha=0.5, lw=1)
        if col == 0:
            ax.set_ylabel("gx (поздовжнє g)\n+ газ / − гальмо")
        ax.grid(alpha=0.15)

        # GY (lateral)
        ax = axes[2, col]
        gy_mean = np.mean(all_gy, axis=0)
        gy_p10 = np.percentile(all_gy, 10, axis=0)
        gy_p90 = np.percentile(all_gy, 90, axis=0)
        ax.fill_between(s_grid, gy_p10, gy_p90, color="#888", alpha=0.25)
        ax.plot(s_grid, gy_mean, color="#fff", lw=1.5, alpha=0.7)
        ax.plot(sub_b["s"], smooth(sub_b["gy"].values), color="#39ff14", lw=2)
        ax.axhline(0, color="#666", lw=0.7)
        ax.axvline(c["apex_s"], color="#ff3060", alpha=0.5, lw=1)
        if col == 0:
            ax.set_ylabel("gy (бічне g)")
        ax.set_xlabel("Дистанція, м")
        ax.grid(alpha=0.15)

    fig.suptitle("Профіль кожного повороту: best lap (зелений) vs середня (біла) ± 10-90% (сірий)", fontsize=14, y=0.995)
    plt.tight_layout()
    plt.savefig(IMG / "04_corner_traces.png", dpi=140)
    plt.close()
    print("Saved 04_corner_traces.png")

    # ---- 3. Бокс-плоти min_speed по поворотах × по сесіях
    fig, axes = plt.subplots(2, 3, figsize=(14, 8))
    for ax, c_n in zip(axes.flat, [1, 2, 3, 4, 5, 6]):
        sub = metrics[metrics["corner"] == c_n]
        sessions = sorted(sub["session"].unique())
        data_min = [sub[sub["session"] == s]["min_speed"].values for s in sessions]
        data_exit = [sub[sub["session"] == s]["exit_speed"].values for s in sessions]
        positions_min = np.arange(len(sessions)) * 2
        positions_exit = positions_min + 0.7
        bp1 = ax.boxplot(data_min, positions=positions_min, widths=0.6, patch_artist=True,
                          boxprops=dict(facecolor="#3a8eff", edgecolor="#fff"),
                          medianprops=dict(color="#fff"), whiskerprops=dict(color="#fff"),
                          capprops=dict(color="#fff"), flierprops=dict(markeredgecolor="#fff"))
        bp2 = ax.boxplot(data_exit, positions=positions_exit, widths=0.6, patch_artist=True,
                          boxprops=dict(facecolor="#39ff14", edgecolor="#fff"),
                          medianprops=dict(color="#000"), whiskerprops=dict(color="#fff"),
                          capprops=dict(color="#fff"), flierprops=dict(markeredgecolor="#fff"))
        labels = [f"#{i+1}\n{s.split('on ')[-1].replace('.csv','')}" for i, s in enumerate(sessions)]
        ax.set_xticks(positions_min + 0.35)
        ax.set_xticklabels(labels, fontsize=8)
        ax.set_title(f"T{c_n}: min (синій) / exit (зелений) швидкість")
        ax.set_ylabel("км/год")
        ax.grid(alpha=0.15, axis="y")
    fig.suptitle("Розподіл швидкостей по сесіях (= по різних картах)", fontsize=13)
    plt.tight_layout()
    plt.savefig(IMG / "05_per_session_boxplots.png", dpi=140)
    plt.close()
    print("Saved 05_per_session_boxplots.png")

    # ---- 4. Карта де "втрачаєш" час: різниця best vs worst по швидкості
    fig, ax = plt.subplots(figsize=(12, 9))
    s_grid = np.arange(0, ref["s"].iloc[-1], 0.5)
    sub_b = df[(df["session_file"] == best["session"]) & (df["lap"] == best["lap"])].sort_values("s")
    sub_w = df[(df["session_file"] == worst["session"]) & (df["lap"] == worst["lap"])].sort_values("s")
    v_b = np.interp(s_grid, sub_b["s"].values, smooth(sub_b["speed_kmh"].values))
    v_w = np.interp(s_grid, sub_w["s"].values, smooth(sub_w["speed_kmh"].values))
    delta = v_b - v_w  # позитивне = best швидший тут

    # Малюємо траєкторію best lap кольором delta
    sub_b_xy = df[(df["session_file"] == best["session"]) & (df["lap"] == best["lap"])].sort_values("s").reset_index(drop=True)
    delta_at_pts = np.interp(sub_b_xy["s"].values, s_grid, delta)
    points = np.array([sub_b_xy["x"].values, sub_b_xy["y"].values]).T.reshape(-1, 1, 2)
    segments = np.concatenate([points[:-1], points[1:]], axis=1)
    norm = plt.Normalize(-15, 15)
    lc = LineCollection(segments, cmap="RdYlGn", norm=norm, linewidth=4)
    lc.set_array(delta_at_pts)
    ax.add_collection(lc)
    cb = plt.colorbar(lc, ax=ax, shrink=0.8)
    cb.set_label(f"Δ швидкість best − worst, км/год\n(зелене = best швидший = ти втрачаєш на гіршому колі)")

    for c in corners:
        ax.plot(c["apex_x"], c["apex_y"], "o", color="#fff", markersize=10, zorder=5)
        ax.annotate(f"T{c['n']}", (c["apex_x"], c["apex_y"]), xytext=(8, 8),
                    textcoords="offset points", color="#fff", fontweight="bold", fontsize=11,
                    bbox=dict(boxstyle="round,pad=0.2", fc="#222", ec="#fff", alpha=0.7))

    ax.set_aspect("equal")
    ax.set_title(f"Де ти втрачаєш час: best ({best['time']:.3f}с) vs worst ({worst['time']:.3f}с) — зелені сегменти = найбільший gain best", fontsize=12)
    ax.set_xlabel("x, м")
    ax.set_ylabel("y, м")
    ax.grid(alpha=0.15)
    plt.tight_layout()
    plt.savefig(IMG / "06_best_vs_worst_map.png", dpi=150)
    plt.close()
    print("Saved 06_best_vs_worst_map.png")

    # ---- 5. Консистентність: spread кожної метрики
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))
    ax = axes[0]
    sessions = sorted(laps_df["session"].unique())
    for s in sessions:
        sub = laps_df[(laps_df["session"] == s) & (laps_df["time"] < 47) & (laps_df["lap"] > 1)]
        ax.plot(sub["lap"], sub["time"], "-o", label=s.split("on ")[-1].replace(".csv", ""), markersize=5)
    ax.set_xlabel("№ кола в сесії")
    ax.set_ylabel("Час кола, с")
    ax.set_title("Темп по колах в кожній сесії (різні карти)")
    ax.legend(fontsize=8)
    ax.grid(alpha=0.2)

    ax = axes[1]
    # Гістограма часів
    for s in sessions:
        sub = laps_df[(laps_df["session"] == s) & (laps_df["time"] < 47) & (laps_df["lap"] > 1)]
        ax.hist(sub["time"], bins=15, alpha=0.5, label=s.split("on ")[-1].replace(".csv", ""))
    ax.set_xlabel("Час кола, с")
    ax.set_ylabel("К-сть кіл")
    ax.set_title("Розподіл часів кіл (вужче = стабільніше)")
    ax.legend(fontsize=8)
    ax.grid(alpha=0.2)
    plt.tight_layout()
    plt.savefig(IMG / "07_pace_consistency.png", dpi=140)
    plt.close()
    print("Saved 07_pace_consistency.png")


if __name__ == "__main__":
    main()
