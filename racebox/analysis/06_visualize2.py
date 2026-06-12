"""
Спеціалізовані графіки:
1. Throttle/brake "trace": для best lap — момент гальма, накату, газу як ширина смуги.
2. Heatmap (corner × session) — exit_speed і min_speed, де видно різницю між картами.
3. "Trail-braking" показник на кожному повороті (коли кермуєш одночасно з гальмом).
4. Фінальна траєкторія найкращого кола з підписами всіх ключових точок.
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

    valid_laps = laps_df[(laps_df["time"] < 47) & (laps_df["lap"] > 1)].copy().sort_values("time")
    best = valid_laps.iloc[0]
    sub_b = df[(df["session_file"] == best["session"]) & (df["lap"] == best["lap"])].sort_values("s").reset_index(drop=True)

    # ---- 1. Throttle/brake trace (best lap)
    fig, axes = plt.subplots(3, 1, figsize=(14, 9), sharex=True)
    s = sub_b["s"].values
    v = smooth(sub_b["speed_kmh"].values)
    gx = smooth(sub_b["gx"].values)
    gy = smooth(sub_b["gy"].values)

    # Класифікація: BRAKE (gx<-0.15), COAST (-0.15<gx<0.1), GAS (gx>0.1)
    state = np.full(len(gx), 1, dtype=int)  # 0 brake, 1 coast, 2 gas
    state[gx < -0.15] = 0
    state[gx > 0.1] = 2
    colors = {0: "#ff3060", 1: "#ffcc00", 2: "#39ff14"}
    labels = {0: "ГАЛЬМО (gx<-0.15g)", 1: "НАКАТ", 2: "ГАЗ (gx>+0.1g)"}

    ax = axes[0]
    ax.plot(s, v, color="#fff", lw=1.5)
    for st, col in colors.items():
        mask = state == st
        ax.fill_between(s, 0, v, where=mask, color=col, alpha=0.5, label=labels[st])
    for c in corners:
        ax.axvline(c["apex_s"], color="#888", alpha=0.4, lw=1)
        ax.text(c["apex_s"], v.max() + 1, f"T{c['n']}", ha="center", color="#fff", fontweight="bold")
    ax.set_ylabel("Швидкість, км/год")
    ax.set_title(f"BEST LAP {best['time']:.3f} с — фази гальмо/накат/газ", fontsize=13)
    ax.legend(loc="lower right")
    ax.set_ylim(15, v.max() + 5)
    ax.grid(alpha=0.15)

    ax = axes[1]
    ax.fill_between(s, 0, gx, where=gx >= 0, color="#39ff14", alpha=0.7, label="газ")
    ax.fill_between(s, 0, gx, where=gx < 0, color="#ff3060", alpha=0.7, label="гальмо")
    for c in corners:
        ax.axvline(c["apex_s"], color="#888", alpha=0.4, lw=1)
    ax.axhline(0, color="#666", lw=0.7)
    ax.set_ylabel("gx, g (поздовжнє)")
    ax.legend(loc="lower right")
    ax.grid(alpha=0.15)

    ax = axes[2]
    ax.fill_between(s, 0, gy, where=gy >= 0, color="#3a8eff", alpha=0.7, label="вліво")
    ax.fill_between(s, 0, gy, where=gy < 0, color="#ff8c1a", alpha=0.7, label="вправо")
    for c in corners:
        ax.axvline(c["apex_s"], color="#888", alpha=0.4, lw=1)
    ax.axhline(0, color="#666", lw=0.7)
    ax.set_ylabel("gy, g (бічне)")
    ax.set_xlabel("Дистанція, м")
    ax.legend(loc="lower right")
    ax.grid(alpha=0.15)
    plt.tight_layout()
    plt.savefig(IMG / "08_best_lap_traces.png", dpi=140)
    plt.close()
    print("Saved 08_best_lap_traces.png")

    # ---- 2. Heatmap corner × session
    fig, axes = plt.subplots(1, 3, figsize=(16, 5))
    for ax, metric, title, cmap in [
        (axes[0], "min_speed", "Min швидкість в апексі (км/год)", "viridis"),
        (axes[1], "exit_speed", "Exit швидкість (км/год)", "viridis"),
        (axes[2], "brake_time_s", "Тривалість гальмування (с)", "magma_r"),
    ]:
        pivot = metrics.groupby(["session", "corner"])[metric].mean().unstack().round(1)
        sessions_sorted = sorted(pivot.index)
        pivot = pivot.reindex(sessions_sorted)
        im = ax.imshow(pivot.values, aspect="auto", cmap=cmap)
        ax.set_xticks(range(len(pivot.columns)))
        ax.set_xticklabels([f"T{c}" for c in pivot.columns])
        ax.set_yticks(range(len(pivot.index)))
        ax.set_yticklabels([f"#{i+1} {s.split('on ')[-1].replace('.csv','')}" for i, s in enumerate(pivot.index)], fontsize=9)
        ax.set_title(title)
        for i in range(pivot.shape[0]):
            for j in range(pivot.shape[1]):
                v = pivot.values[i, j]
                ax.text(j, i, f"{v:.1f}", ha="center", va="center", color="#fff", fontsize=9, fontweight="bold")
        plt.colorbar(im, ax=ax, shrink=0.8)
    plt.tight_layout()
    plt.savefig(IMG / "09_heatmaps.png", dpi=140)
    plt.close()
    print("Saved 09_heatmaps.png")

    # ---- 3. Bar chart: time loss potential per corner
    # Час, що ти втрачаєш, якщо в кожному повороті ти на середньому замість best 25%-ної min-швидкості
    fig, ax = plt.subplots(figsize=(11, 6))
    rows = []
    for c_n in [1, 2, 3, 4, 5, 6]:
        sub = metrics[metrics["corner"] == c_n]
        rows.append({
            "corner": f"T{c_n}",
            "min_p25": sub["min_speed"].quantile(0.25),
            "min_p75": sub["min_speed"].quantile(0.75),
            "min_p50": sub["min_speed"].median(),
            "exit_p25": sub["exit_speed"].quantile(0.25),
            "exit_p75": sub["exit_speed"].quantile(0.75),
            "exit_p50": sub["exit_speed"].median(),
            "exit_best": sub["exit_speed"].quantile(0.95),
            "min_best": sub["min_speed"].quantile(0.95),
        })
    bdf = pd.DataFrame(rows)
    x = np.arange(len(bdf))
    w = 0.35

    ax.bar(x - w/2, bdf["min_p50"], w, color="#3a8eff", label="median min")
    ax.bar(x - w/2, bdf["min_best"] - bdf["min_p50"], w, bottom=bdf["min_p50"], color="#3a8eff", alpha=0.4, label="до p95")
    ax.bar(x + w/2, bdf["exit_p50"], w, color="#39ff14", label="median exit")
    ax.bar(x + w/2, bdf["exit_best"] - bdf["exit_p50"], w, bottom=bdf["exit_p50"], color="#39ff14", alpha=0.4, label="до p95")

    ax.set_xticks(x)
    ax.set_xticklabels(bdf["corner"], fontsize=12)
    ax.set_ylabel("Швидкість, км/год")
    ax.set_title("Min vs Exit швидкість по поворотах: medianна (заповнено) і потенціал до p95 (прозоре)")
    ax.legend()
    ax.grid(alpha=0.15, axis="y")
    plt.tight_layout()
    plt.savefig(IMG / "10_potential.png", dpi=140)
    plt.close()
    print("Saved 10_potential.png")


if __name__ == "__main__":
    main()
