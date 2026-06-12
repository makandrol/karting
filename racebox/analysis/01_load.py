"""Load all RaceBox CSVs into a unified DataFrame and dump per-lap header info."""
from __future__ import annotations

import os
import re
import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "analysis" / "out"
OUT.mkdir(parents=True, exist_ok=True)

CSVS = sorted([p for p in ROOT.glob("*.csv")])


def parse_header(path: Path) -> dict:
    info = {"file": path.name, "laps": []}
    with path.open("r") as f:
        for line in f:
            line = line.rstrip("\n")
            if line.startswith("Record,"):
                break
            if "," not in line:
                continue
            parts = [p.strip() for p in line.split(",")]
            key = parts[0]
            if key == "Best Lap Time":
                info["best_lap"] = float(parts[1])
            elif key in ("Date", "Time", "Track", "Session Type", "Session Index"):
                info[key.lower().replace(" ", "_")] = parts[1] if len(parts) > 1 else ""
            elif key == "Laps":
                info["lap_count"] = int(parts[1])
            elif key.startswith("Lap "):
                # "Lap N", time, sectors, s1, s2, s3, s4, s5
                m = re.match(r"Lap (\d+)", key)
                if not m:
                    continue
                lap_no = int(m.group(1))
                lap_time = float(parts[1])
                # parts[2] == 'sectors'
                sectors = [float(x) for x in parts[3:] if x]
                info["laps"].append({"lap": lap_no, "time": lap_time, "sectors": sectors})
            elif key == "Incomplete lap":
                info.setdefault("incomplete", []).append(
                    {"time": float(parts[1]), "sectors": [float(x) for x in parts[3:] if x]}
                )
    return info


def load_telemetry(path: Path) -> pd.DataFrame:
    # Find the data start
    with path.open("r") as f:
        for i, line in enumerate(f):
            if line.startswith("Record,"):
                skip = i
                break
    df = pd.read_csv(path, skiprows=skip)
    df.columns = [c.strip() for c in df.columns]
    df["t"] = pd.to_datetime(df["Time"], utc=True)
    df["t_s"] = (df["t"] - df["t"].iloc[0]).dt.total_seconds()
    df["session_file"] = path.name
    # Speed in km/h
    df["speed_kmh"] = df["Speed (m/s)"] * 3.6
    df.rename(
        columns={
            "GForceX (g)": "gx",  # longitudinal: + accel (gas) / - braking (зазвичай)
            "GForceY (g)": "gy",  # lateral
            "GForceZ (g)": "gz",
            "Latitude": "lat",
            "Longitude": "lon",
            "Altitude (m)": "alt",
            "Speed (m/s)": "speed_ms",
            "Lap": "lap",
            "Heading": "heading",
        },
        inplace=True,
    )
    return df


def main() -> None:
    headers = []
    frames = []
    for p in CSVS:
        h = parse_header(p)
        headers.append(h)
        df = load_telemetry(p)
        df["session"] = p.stem.replace("RaceBox Track Sessionon ", "")
        frames.append(df)
        print(f"{p.name}: {len(df)} samples, {h.get('lap_count')} laps, best={h.get('best_lap')}")

    all_df = pd.concat(frames, ignore_index=True)
    all_df.to_parquet(OUT / "telemetry.parquet")
    with (OUT / "headers.json").open("w") as f:
        json.dump(headers, f, indent=2, ensure_ascii=False)

    # Lap-level summary
    rows = []
    for h in headers:
        for L in h["laps"]:
            rows.append({"session": h["file"], "lap": L["lap"], "time": L["time"], **{f"s{i+1}": s for i, s in enumerate(L["sectors"])}})
    laps_df = pd.DataFrame(rows)
    laps_df.to_csv(OUT / "laps.csv", index=False)
    print("\nLap summary:")
    print(laps_df.to_string(index=False))


if __name__ == "__main__":
    main()
