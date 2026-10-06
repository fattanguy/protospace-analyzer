"""
ProtoSpace Analyzer — export the cube lattice of one or more frames from Blender.

The slab is a grid of points (0.14 apart = 1 m) with a cube instanced on every point; the pattern
sets each cube's size (0 = void … 1 = touching). For every frame asked for, this script evaluates
the animation, reads every instance's position and size, snaps it to the lattice and writes a small
file that the analyzer website imports ("Import a Blender frame" → drop the .json):

    frame_0093.json   {dims, sizes (4-bit, base64), camera, …}

The site shows the real 3D lattice and rates the frame on the twelve descriptors from the true
geometry — a cube counts as mass when its size is at least the threshold you choose (default 0.5).

HOW TO RUN
  Inside Blender:  Scripting workspace → Python console →  exec(open("/path/to/export_frame.py").read())
                   (set os.environ["PS_FRAMES"] = "1-250" first to export a range)
                   or Text editor → Open this file → Run Script (Alt+P). Edit SETTINGS first.
  From a terminal: blender -b "Voxel Animation Controls.blend" -P export_frame.py -- --frames 25-250 --out frames

The exporter never changes your scene (it restores the frame it found when it started).
"""

import bpy
import json
import math
import os
import sys
import time
import base64
from mathutils import Vector

# ----------------------------------------------------------------------------------------- SETTINGS
FRAMES = None            # None = the current frame; or [93]; or "25-250"; or [10, 20, 30]
OUT_DIR = None           # None = a "protospace_frames" folder next to the .blend file
OBJECT = None            # name of the slab object; None = the first object with a Geometry Nodes modifier
SPACING = None           # point spacing (one metre); None = read "Point Spacing" from the modifier, else 0.14
WRITE_INDEX = True       # also write index.json listing the exported frames
LOG_FILE = None          # None = export_log.txt in OUT_DIR
# -------------------------------------------------------------------------------------------------

_log_lines = []


def log(*a):
    line = " ".join(str(x) for x in a)
    _log_lines.append(line)
    print("ProtoSpace:", line)


def parse_frames(spec, scene):
    if spec is None:
        return [scene.frame_current]
    if isinstance(spec, int):
        return [spec]
    if isinstance(spec, str):
        out = []
        for part in spec.split(","):
            part = part.strip()
            if "-" in part:
                a, b = part.split("-")
                out.extend(range(int(a), int(b) + 1))
            elif part:
                out.append(int(part))
        return out
    return [int(f) for f in spec]


def cli_overrides():
    """`-- --frames 1-250 --out dir` on the command line, or PS_FRAMES / PS_OUT / PS_OBJECT / PS_SPACING in the environment."""
    global FRAMES, OUT_DIR, OBJECT, SPACING
    env = os.environ
    if env.get("PS_FRAMES"): FRAMES = env["PS_FRAMES"]
    if env.get("PS_OUT"): OUT_DIR = env["PS_OUT"]
    if env.get("PS_OBJECT"): OBJECT = env["PS_OBJECT"]
    if env.get("PS_SPACING"): SPACING = float(env["PS_SPACING"])
    if "--" not in sys.argv:
        return
    args = sys.argv[sys.argv.index("--") + 1:]
    i = 0
    while i < len(args):
        a = args[i]
        nxt = args[i + 1] if i + 1 < len(args) else None
        if a == "--frames" and nxt: FRAMES = nxt; i += 2
        elif a == "--out" and nxt: OUT_DIR = nxt; i += 2
        elif a == "--object" and nxt: OBJECT = nxt; i += 2
        elif a == "--spacing" and nxt: SPACING = float(nxt); i += 2
        else: i += 1


def find_slab(scene):
    if OBJECT:
        ob = bpy.data.objects.get(OBJECT)
        if not ob:
            raise RuntimeError(f"Object '{OBJECT}' not found.")
        return ob
    best = None
    for ob in scene.objects:
        if ob.type != "MESH":
            continue
        for m in ob.modifiers:
            if m.type == "NODES" and m.node_group:
                if best is None or len(m.node_group.nodes) > len(best[1].node_group.nodes):
                    best = (ob, m)
    if not best:
        raise RuntimeError("No object with a Geometry Nodes modifier found. Set OBJECT to the slab's name.")
    return best[0]


def modifier_input(ob, name, default):
    for m in ob.modifiers:
        if m.type != "NODES" or not m.node_group:
            continue
        for item in m.node_group.interface.items_tree:
            if getattr(item, "in_out", None) == "INPUT" and item.name == name:
                try:
                    return float(m[item.identifier])
                except Exception:
                    pass
    return default


def camera_info(scene):
    cam = scene.camera
    if not cam:
        return None
    m = cam.matrix_world
    R = m.to_3x3()
    pos = m.translation
    d, r = cam.data, scene.render
    return {
        "name": cam.name, "position": [pos.x, pos.y, pos.z],
        "right": list((R @ Vector((1, 0, 0))).normalized()), "up": list((R @ Vector((0, 1, 0))).normalized()),
        "forward": list((R @ Vector((0, 0, -1))).normalized()),
        "lens_mm": d.lens, "sensor_mm": d.sensor_width, "sensor_fit": d.sensor_fit, "type": d.type, "ortho_scale": d.ortho_scale,
        "resolution": [r.resolution_x, r.resolution_y], "resolution_percentage": r.resolution_percentage,
    }


def pick_axes(cam):
    """(world axis index, sign) for the analyzer's across, up and depth directions."""
    def snap(v):
        i = max(range(3), key=lambda k: abs(v[k]))
        return i, (1 if v[i] >= 0 else -1)
    if cam:
        ax, sx = snap(cam["right"]); az, sz = snap(cam["forward"]); ay, sy = snap(cam["up"])
        if len({ax, ay, az}) == 3:
            return (ax, sx), (ay, sy), (az, sz)
    return (1, 1), (2, 1), (0, -1)        # the slab: Y across, Z up, looking along -X


def read_instances(ob, depsgraph):
    """Positions and sizes of every instanced cube at the current frame (numpy if available)."""
    ev = ob.evaluated_get(depsgraph)
    geo = ev.evaluated_geometry()
    inst = geo.instances_pointcloud()
    if not inst or len(inst.points) == 0:
        raise RuntimeError("The evaluated geometry has no instances — is the modifier enabled?")
    n = len(inst.points)
    mw = ev.matrix_world
    try:
        import numpy as np
        m = np.empty(n * 16, np.float32)
        inst.attributes["instance_transform"].data.foreach_get("value", m)
        m = m.reshape(n, 4, 4)
        # the attribute is column-major-looking per Blender's foreach layout; translation is the last column
        pos = m[:, :3, 3].astype(np.float64)
        size = np.linalg.norm(m[:, :3, 0], axis=1)
        if not (abs(pos).max() > 0) and abs(m[:, 3, :3]).max() > 0:        # row-major fallback
            pos = m[:, 3, :3].astype(np.float64)
            size = np.linalg.norm(m[:, 0, :3], axis=1)
        M = np.array(mw, dtype=np.float64)
        pos = pos @ M[:3, :3].T + M[:3, 3]
        return pos, size, n
    except ImportError:
        pos, size = [], []
        for i in range(n):
            t = inst.attributes["instance_transform"].data[i].value
            p = mw @ t.translation
            pos.append((p.x, p.y, p.z)); size.append(t.to_scale().x)
        return pos, size, n


def export_frame(scene, ob, frame, out_dir, spacing, cam, axes):
    scene.frame_set(frame)
    dg = bpy.context.evaluated_depsgraph_get()
    t0 = time.time()
    pos, size, n = read_instances(ob, dg)
    (ax, sx), (ay, sy), (az, sz) = axes
    try:
        import numpy as np
        P = np.asarray(pos); S = np.asarray(size)
        lo = P.min(axis=0); hi = P.max(axis=0)
        log(f"frame {frame}: {n} instances · position bbox min {np.round(lo, 3).tolist()} max {np.round(hi, 3).tolist()} · size min {S.min():.3f} max {S.max():.3f}")
        idx = np.rint((P - lo) / spacing).astype(np.int64)
        dims_w = idx.max(axis=0) + 1
        ia = idx[:, ax] if sx > 0 else dims_w[ax] - 1 - idx[:, ax]
        iy = idx[:, ay] if sy > 0 else dims_w[ay] - 1 - idx[:, ay]
        iz = idx[:, az] if sz > 0 else dims_w[az] - 1 - idx[:, az]
        nx, ny, nz = int(dims_w[ax]), int(dims_w[ay]), int(dims_w[az])
        q = np.clip(np.rint(S / max(1e-9, S.max() if S.max() > 1 else 1.0) * 15), 0, 15).astype(np.uint8)
        grid = np.zeros(nx * ny * nz, np.uint8)
        grid[ia + nx * (iy + ny * iz)] = q
        if grid.size % 2:
            grid = np.append(grid, np.uint8(0))
        packed = (grid[0::2] | (grid[1::2] << 4)).astype(np.uint8).tobytes()
        solid = int((S >= 0.5).sum())
        lattice_err = float(np.abs((P - lo) / spacing - idx).max())
        origin = [float(v) for v in lo]
    except ImportError:
        raise RuntimeError("numpy is not available in this Blender build.")
    data = {
        "format": "protospace-voxels", "version": 2,
        "source": os.path.basename(bpy.data.filepath) or "unsaved.blend", "object": ob.name, "frame": frame,
        "frame_range": [scene.frame_start, scene.frame_end], "fps": scene.render.fps,
        "spacing": spacing, "cube_metres": 1.0, "origin": origin,
        "axes": {"across": ("+-"[sx < 0]) + "XYZ"[ax], "up": ("+-"[sy < 0]) + "XYZ"[ay], "depth": ("+-"[sz < 0]) + "XYZ"[az]},
        "dims": [nx, ny, nz], "points": int(n), "solid_at_half": solid, "lattice_error": round(lattice_err, 4),
        "size_bits": 4, "sizes": base64.b64encode(packed).decode("ascii"),
        "camera": cam, "exported": time.strftime("%Y-%m-%dT%H:%M:%S"), "seconds": round(time.time() - t0, 2),
    }
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"frame_{frame:04d}.json")
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    return path, data


def main():
    cli_overrides()
    scene = bpy.context.scene
    frames = parse_frames(FRAMES, scene)
    base = os.path.dirname(bpy.data.filepath) if bpy.data.filepath else os.path.expanduser("~")
    out_dir = OUT_DIR or os.path.join(base, "protospace_frames")
    os.makedirs(out_dir, exist_ok=True)
    log_path = LOG_FILE or os.path.join(out_dir, "export_log.txt")
    keep = scene.frame_current
    written = []
    try:
        ob = find_slab(scene)
        spacing = SPACING or modifier_input(ob, "Point Spacing", 0.14)
        cam = camera_info(scene)
        axes = pick_axes(cam)
        log(f"blender {bpy.app.version_string} · file {bpy.data.filepath}")
        log(f"slab object '{ob.name}' · point spacing {spacing} · camera {cam['name'] if cam else 'none'} · axes across/up/depth = {axes}")
        for f in frames:
            path, data = export_frame(scene, ob, f, out_dir, spacing, cam, axes)
            written.append({"frame": f, "file": os.path.basename(path), "points": data["points"], "solid_at_half": data["solid_at_half"], "dims": data["dims"]})
            log(f"frame {f:4d} → {os.path.basename(path)}  lattice {data['dims']} · {data['points']} points · {data['solid_at_half']} solid at ≥ 0.5 · lattice error {data['lattice_error']} · {data['seconds']} s")
        if WRITE_INDEX:
            idx_path = os.path.join(out_dir, "index.json")
            old = []
            if os.path.exists(idx_path):
                try:
                    with open(idx_path) as fh:
                        old = json.load(fh).get("frames", [])
                except Exception:
                    old = []
            merged = {e["frame"]: e for e in old}
            for e in written:
                merged[e["frame"]] = e
            with open(idx_path, "w") as fh:
                json.dump({"format": "protospace-voxels-index", "source": os.path.basename(bpy.data.filepath), "frame_range": [scene.frame_start, scene.frame_end], "frames": [merged[k] for k in sorted(merged)]}, fh)
        log(f"wrote {len(written)} frame file(s) to {out_dir}")
    except Exception as exc:
        import traceback
        log("ERROR", traceback.format_exc())
        raise
    finally:
        scene.frame_set(keep)
        try:
            with open(log_path, "w") as fh:
                fh.write("\n".join(_log_lines) + "\n")
        except Exception:
            pass
    return written


_written = main()
