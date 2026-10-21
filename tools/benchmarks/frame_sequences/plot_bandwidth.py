"""uv run --with matplotlib python tools/benchmarks/frame_sequences/plot_bandwidth.py DIR"""
import csv
import json
import sys
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator

root = Path(sys.argv[1])
workloads = [("moonlander", "Standalone Moonlander"), ("corgi-moonlander", "Moonlander inside Corgi"), ("corgi", "Corgi: shell output + help panel")]
fig, axes = plt.subplots(3, 1, figsize=(12, 10), sharex=True, constrained_layout=True)
colors = {"before": "#d56a2f", "after": "#176ec0"}
summary = []
flat = []
for ax, (workload, title) in zip(axes, workloads):
    values = {}
    for variant in ["before", "after"]:
        record = json.loads((root / f"{variant}-{workload}" / "bandwidth.json").read_text())
        samples = record["samples"]
        kb = [sample["bytes"] / 1000 for sample in samples]
        values[variant] = {"meanKBps": sum(kb) / len(kb), "peakKBps": max(kb), "frames": sum(s["frames"] for s in samples), "startupKB": record["startupBytes"] / 1000, "revision": record["revision"]}
        ax.step(range(len(kb)+1), kb + [kb[-1]], where="post", color=colors[variant], linewidth=2.1, label=f"{variant.capitalize()}  ·  {sum(kb)/len(kb):.1f} KB/s average")
        for sample in samples:
            flat.append({"workload": workload, "variant": variant, "second": sample["second"], "bytes": sample["bytes"], "frames": sample["frames"]})
    reduction = 100 * (1 - values["after"]["meanKBps"] / values["before"]["meanKBps"])
    summary.append({"workload": workload, **values, "reductionPercent": reduction})
    ax.set_title(f"{title}   |   {reduction:.1f}% less output", loc="left", fontsize=13, fontweight="bold", pad=12)
    ax.set_ylabel("KB/s")
    ax.set_ylim(bottom=0)
    ax.grid(axis="y", alpha=.2)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(loc="upper right", frameon=False, fontsize=10)
    if workload == "corgi":
        phases = [(0,6,"Sparse counters"),(6,12,"Scrolling"),(12,16,"Sparse counters"),(16,20,"Idle / help")]
    else:
        phases = [(0,6,"Thrust / tilt"),(6,10,"Coast"),(10,14,"Thrust / tilt"),(14,20,"Coast")]
    for i, (start,end,label) in enumerate(phases):
        if i%2 == 0: ax.axvspan(start,end,color="#6b7a89",alpha=.06)
        ax.text((start+end)/2, .02, label, transform=ax.get_xaxis_transform(), ha="center", va="bottom", fontsize=8, color="#555555")
axes[-1].set_xlabel("Seconds since first scripted input")
axes[-1].set_xlim(0,20)
axes[-1].xaxis.set_major_locator(MaxNLocator(integer=True))
fig.suptitle("Terminal bandwidth before / after cell-run rendering", fontsize=17, fontweight="bold")
fig.supxlabel(f"Before: main {values['before']['revision'][:8]} · After: {values['after']['revision'][:8]}\n120×40 cells · 1-second buckets · decimal KB · includes Kitty traffic · excludes startup and SSH framing\nLive, separate runs with identical inputs; game worlds and frame scheduling can vary.",fontsize=9,color="#555555")
fig.savefig(root/"bandwidth.png",dpi=170)
fig.savefig(root/"bandwidth.svg")
(root/"summary.json").write_text(json.dumps(summary,indent=2)+"\n")
with (root/"bandwidth.csv").open("w") as f:
    writer=csv.DictWriter(f,fieldnames=list(flat[0]));writer.writeheader();writer.writerows(flat)
print(json.dumps(summary,indent=2))
