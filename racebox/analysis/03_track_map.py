"""
Карта траси: малює траєкторію референсного кола, повороти, і теплову карту швидкості.
Також малює оверлей всіх кіл щоб переконатися, що кільце замкнуте.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "analysis" / "out"
IMG = ROOT / "analysis" / "img"
IMG.mkdir(parents=True, exist_ok=True)

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


def colored_line(ax, x, y, c, cmap="turbo", lw=3, vmin=None, vmax=None):
    points = np.array([x, y]).T.reshape(-1, 1, 2)
    segments = np.concatenate([points[:-1], points[1:]], axis=1)
    norm = plt.Normalize(vmin if vmin is not None else c.min(), vmax if vmax is not None else c.max())
    lc = LineCollection(segments, cmap=cmap, norm=norm, linewidth=lw)
    lc.set_array(c)
    ax.add_collection(lc)
    return lc


def main() -> None:
    ref = pd.read_parquet(OUT / "reference_lap.parquet")
    df = pd.read_parquet(OUT / "telemetry_with_s.parquet")
    with (OUT / "corners.json").open() as f:
        corners = json.load(f)

    # ---- 1. Карта референсного кола з кольоровою швидкістю + повороти
    fig, ax = plt.subplots(figsize=(12, 9))
    x, y = ref["x"].values, ref["y"].values
    v = ref["speed_kmh"].values

    lc = colored_line(ax, x, y, v, cmap="turbo", lw=4, vmin=20, vmax=v.max())
    cb = plt.colorbar(lc, ax=ax, shrink=0.8)
    cb.set_label("Швидкість, км/год")

    # Стартова точка
    ax.plot(x[0], y[0], "o", color="#fff", markersize=10, label="Start/Finish")

    # Підписи поворотів
    for c in corners:
        ax.plot(c["apex_x"], c["apex_y"], "o", color="#ff3060", markersize=14, mec="#fff", mew=1.5, zorder=5)
        ax.annotate(
            f"T{c['n']} ({c['direction']})\n{c['min_speed_kmh']:.0f} км/год",
            (c["apex_x"], c["apex_y"]),
            xytext=(12, 12),
            textcoords="offset points",
            color="#fff",
            fontsize=11,
            fontweight="bold",
            bbox=dict(boxstyle="round,pad=0.3", fc="#ff3060", ec="none", alpha=0.85),
        )

    ax.set_aspect("equal")
    ax.set_title(f"Карта траси — референсне коло (best lap 42.636 с, довжина {ref['s'].iloc[-1]:.0f} м)\n"
                 f"Колір — швидкість, точки — апекси поворотів", fontsize=13)
    ax.set_xlabel("x, м")
    ax.set_ylabel("y, м")
    ax.grid(alpha=0.15)
    plt.tight_layout()
    plt.savefig(IMG / "01_track_map.png", dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved {IMG / '01_track_map.png'}")

    # ---- 2. Оверлей всіх "хороших" кіл щоб переконатися, що геометрія співпадає
    fig, ax = plt.subplots(figsize=(12, 9))
    laps_df = pd.read_csv(OUT / "laps.csv")
    median_t = laps_df["time"].median()
    good = laps_df[laps_df["time"] < median_t * 1.05]
    for _, row in good.iterrows():
        sub = df[(df["session_file"] == row["session"]) & (df["lap"] == row["lap"])]
        ax.plot(sub["x"], sub["y"], color="#39ff14", alpha=0.15, lw=1)
    ax.plot(x, y, color="#ff3060", lw=2, label="Best lap")
    for c in corners:
        ax.plot(c["apex_x"], c["apex_y"], "o", color="#fff", markersize=10, zorder=5)
        ax.annotate(f"T{c['n']}", (c["apex_x"], c["apex_y"]), xytext=(8, 8),
                    textcoords="offset points", color="#fff", fontweight="bold")
    ax.set_aspect("equal")
    ax.set_title("Оверлей всіх якісних кіл (зелений) і референсного (червоний)", fontsize=13)
    ax.set_xlabel("x, м")
    ax.set_ylabel("y, м")
    ax.grid(alpha=0.15)
    ax.legend()
    plt.tight_layout()
    plt.savefig(IMG / "02_all_laps_overlay.png", dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Saved {IMG / '02_all_laps_overlay.png'}")


if __name__ == "__main__":
    main()
