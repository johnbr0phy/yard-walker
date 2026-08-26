/* YARD WALKER — first-person sandbox over the three yard generators.
   The yards (window.SHIPYARD / BASEYARD / MECHYARD) are imported verbatim by
   build.js; everything here is the game: a mesh adapter from their shared
   7-solid part list to Three.js, a seeded lunar terrain, base streaming, and
   the FOOT → MECH → SHIP state machine. */
import * as THREE from "three";

/* ===================== seeds ===================== */
const SEED_MAX = 4294967296;
function hash2(a, b) {
  let h = (a | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = (h ^ (b | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const hash3 = (a, b, c) => hash2(hash2(a, b), c);
const r01 = h => (h >>> 8) / 16777216;

const worldSeed = (() => {
  const m = location.hash.match(/\d+/);
  if (m) return (+m[0] >>> 0) % SEED_MAX;
  return Math.floor(Math.random() * SEED_MAX);
})();
location.hash = worldSeed;

/* ===================== tuning ===================== */
const U_MECH = 0.155;             /* mech build units → metres (the yard's own U2M) */
const G = 1.62;                   /* lunar gravity */
const CELL = 4000;                /* one base site per ~cell */
const FLAT_R = 340, FEATHER = 240;/* graded apron around each site */
const BUILD_R = 2600, DISPOSE_R = 6800, BEACON_R = 52000;
const EDGE_DEG = 30;
const COLOR = {
  bgGround: new THREE.Color(0x071019), bgSpace: new THREE.Color(0x02040a),
  fill: 0x0b151f, baseLine: 0x4f92a8, vehLine: 0x9fe2f4,
  ground: new THREE.Color(0x0a1622), grid: new THREE.Color(0x35606f),
  marker: 0x35e0c8, beacon: 0x2fa8c8,
};
const PARAMS = { fuse: 0.75, detail: 0.6, line: 1.0 };
const PARAMS_FAR = { fuse: 0.75, detail: 0.42, line: 1.0 };

/* ===================== sites ===================== */
const siteCache = new Map();
function siteAt(cx, cz) {
  const k = cx + "," + cz;
  if (siteCache.has(k)) return siteCache.get(k);
  let s = null;
  if (cx === 0 && cz === 0) {
    s = { cx, cz, x: 0, z: 0, seed: hash3(worldSeed, 11, 13), key: k };
  } else {
    const h = hash3(worldSeed, cx * 3 + 1000003, cz * 7 + 2000003);
    if (r01(h) < 0.62) {
      s = { cx, cz,
        x: cx * CELL + (r01(hash2(h, 1)) - 0.5) * 1500,
        z: cz * CELL + (r01(hash2(h, 2)) - 0.5) * 1500,
        seed: hash2(h, 777), key: k };
    }
  }
  if (s) s.label = siteLabel(s.seed);
  siteCache.set(k, s);
  return s;
}
function siteLabel(seed) {          /* same digit extraction the moonbase plate uses */
  const CR = BASEYARD.CRATERS, NB = CR.length, AZ = 26;
  let u = seed >>> 0;
  const name = CR[u % NB]; u = (u - (u % NB)) / NB;
  const b1 = u % AZ; u = (u - b1) / AZ;
  const b2 = u % AZ; u = (u - b2) / AZ;
  return String.fromCharCode(65 + b1, 65 + b2) + String(u).padStart(5, "0") + " " + name;
}
function nearSites(x, z) {
  const cx = Math.round(x / CELL), cz = Math.round(z / CELL), out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const s = siteAt(cx + i, cz + j);
    if (s) out.push(s);
  }
  return out;
}
function siteDist(x, z) {
  let d = 1e9;
  for (const s of nearSites(x, z)) d = Math.min(d, Math.hypot(x - s.x, z - s.z));
  return d;
}

/* ===================== terrain height ===================== */
const NS1 = hash2(worldSeed, 41), NS2 = hash2(worldSeed, 42), NS3 = hash2(worldSeed, 43),
      CRS = hash2(worldSeed, 44);
function vnoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const g = (i, j) => r01(hash3(s, xi + i, zi + j));
  const a = g(0, 0), b = g(1, 0), c = g(0, 1), d = g(1, 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const CRCELL = 900;
function craterOf(ci, cj) {
  const h = hash3(CRS, ci, cj);
  if (r01(h) > 0.58) return null;
  return {
    x: ci * CRCELL + (r01(hash2(h, 1)) - 0.5) * CRCELL * 0.8,
    z: cj * CRCELL + (r01(hash2(h, 2)) - 0.5) * CRCELL * 0.8,
    r: 25 + r01(hash2(h, 3)) * 90,
  };
}
function craterH(x, z) {
  const ci = Math.round(x / CRCELL), cj = Math.round(z / CRCELL);
  let h = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const c = craterOf(ci + i, cj + j);
    if (!c) continue;
    const t = Math.hypot(x - c.x, z - c.z) / c.r;
    if (t < 1.3) {
      const depth = c.r * 0.09;
      const bowl = t < 1 ? (t * t - 1) : 0;
      const rim = Math.exp(-(((t - 1) / 0.17) ** 2)) * 0.5;
      h += depth * (bowl + rim);
    }
  }
  return h;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function terrainH(x, z) {
  const f = smooth(FLAT_R, FLAT_R + FEATHER, siteDist(x, z));
  if (f <= 0) return -0.02;
  let h = (vnoise(x / 950, z / 950, NS1) - 0.5) * 26
        + (vnoise(x / 270, z / 270, NS2) - 0.5) * 8
        + (vnoise(x / 72, z / 72, NS3) - 0.5) * 2.2
        + craterH(x, z);
  return -0.02 + h * f;
}

/* ===================== renderer / scene ===================== */
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = COLOR.bgGround.clone();
scene.fog = new THREE.Fog(COLOR.bgGround.clone(), 500, 3600);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.12, 90000);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const fillMat = new THREE.MeshBasicMaterial({ color: COLOR.fill, polygonOffset: true,
  polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const baseLineMat = new THREE.LineBasicMaterial({ color: COLOR.baseLine });
const vehLineMat = new THREE.LineBasicMaterial({ color: COLOR.vehLine });
const markerMat = new THREE.MeshBasicMaterial({ color: COLOR.marker, transparent: true,
  opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

/* stars — the Moon has no sky to hide them; they brighten with altitude */
const stars = (() => {
  const N = 2600, pos = new Float32Array(N * 3);
  let sr = worldSeed ^ 0x5f3759df;
  const srand = () => { sr = (Math.imul(sr, 1664525) + 1013904223) >>> 0; return sr / 4294967296; };
  for (let i = 0; i < N; i++) {
    const u = srand() * 2 - 1, a = srand() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos[i * 3] = Math.cos(a) * r * 26000;
    pos[i * 3 + 1] = Math.abs(u) * 26000;   /* upper hemisphere, denser overhead */
    pos[i * 3 + 2] = Math.sin(a) * r * 26000;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  /* additive + non-transparent keeps the dome in the opaque pass: renderOrder -1
     paints it first and everything else simply covers it — occlusion by paint
     order, dodging the Points/log-depth interaction entirely */
  const m = new THREE.PointsMaterial({ color: 0xbfe4f0, size: 1.6, sizeAttenuation: false,
    blending: THREE.AdditiveBlending, opacity: 0.4, fog: false,
    depthWrite: false, depthTest: false });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -1;
  scene.add(p);
  return p;
})();

/* ===================== terrain chunks ===================== */
function terrainMaterial(grid) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uGround: { value: COLOR.ground }, uGridC: { value: COLOR.grid },
      uFogC: { value: scene.fog.color }, uFogN: { value: 500 }, uFogF: { value: 3600 },
      uGrid: { value: grid },
    },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vw;
      void main(){ vec4 w=modelMatrix*vec4(position,1.0); vw=w.xyz;
        gl_Position=projectionMatrix*viewMatrix*w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <common>
      #include <logdepthbuf_pars_fragment>
      varying vec3 vw;
      uniform vec3 uGround,uGridC,uFogC; uniform float uFogN,uFogF,uGrid;
      float gridf(vec2 p,float s){ vec2 q=p/s;
        vec2 g=abs(fract(q-0.5)-0.5)/fwidth(q); return 1.0-min(min(g.x,g.y),1.0); }
      void main(){
        #include <logdepthbuf_fragment>
        vec3 col=uGround;
        if(uGrid>0.0){
          float g1=gridf(vw.xz,16.0)*0.16, g2=gridf(vw.xz,128.0)*0.26;
          col=mix(col,uGridC,(g1+g2)*uGrid); }
        float d=distance(cameraPosition,vw);
        col=mix(col,uFogC,smoothstep(uFogN,uFogF,d));
        gl_FragColor=vec4(col,1.0); }`,
  });
}
const TIERS = [
  { S: 256, res: 32, R: 1250, yoff: 0, mat: terrainMaterial(1.0), live: new Map() },
  { S: 1024, res: 24, R: 5500, yoff: -0.6, mat: terrainMaterial(0.5), live: new Map() },
  { S: 4096, res: 16, R: 22000, yoff: -2.5, mat: terrainMaterial(0), live: new Map() },
];
const chunkQueue = [];
function buildChunk(tier, i, j) {
  const S = tier.S, n = tier.res, x0 = i * S, z0 = j * S;
  const verts = new Float32Array((n + 1) * (n + 1) * 3);
  let k = 0;
  for (let a = 0; a <= n; a++) for (let b = 0; b <= n; b++) {
    const x = x0 + (b / n) * S, z = z0 + (a / n) * S;
    verts[k++] = x; verts[k++] = terrainH(x, z) + tier.yoff; verts[k++] = z;
  }
  const idx = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const q = a * (n + 1) + b;
    idx.push(q, q + n + 1, q + 1, q + 1, q + n + 1, q + n + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, tier.mat);
  scene.add(m);
  return m;
}
let lastChunkX = 1e9, lastChunkZ = 1e9;
function updateChunks(cx, cz, force) {
  if (!force && Math.hypot(cx - lastChunkX, cz - lastChunkZ) < 48) return;
  lastChunkX = cx; lastChunkZ = cz;
  for (const tier of TIERS) {
    const S = tier.S, r = Math.ceil(tier.R / S);
    const ci = Math.round(cx / S), cj = Math.round(cz / S);
    const want = new Set();
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      if (Math.hypot((i + 0.5) * S - cx, (j + 0.5) * S - cz) > tier.R + S) continue;
      const key = i + "," + j;
      want.add(key);
      if (!tier.live.has(key)) {
        tier.live.set(key, null);
        chunkQueue.push({ tier, i, j, key });
      }
    }
    for (const [key, mesh] of tier.live) if (!want.has(key)) {
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      tier.live.delete(key);
    }
  }
}
function pumpChunks(budgetMs) {
  const t0 = performance.now();
  while (chunkQueue.length && performance.now() - t0 < budgetMs) {
    const job = chunkQueue.shift();
    if (job.tier.live.get(job.key) !== null) continue;   /* culled, or already built */
    job.tier.live.set(job.key, buildChunk(job.tier, job.i, job.j));
  }
}

/* ===================== yard → three adapter ===================== */
function adaptMesh(result, yard, scale, lineMat) {
  const m = yard.mesh(result);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(m.t, 3));
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geom, fillMat));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geom, EDGE_DEG), lineMat));
  g.scale.setScalar(scale);
  return g;
}
/* collision proxies: floors (walk surfaces) + wall AABBs, from the part list */
function extractStatics(parts, partExtents, ox, oz) {
  const floors = [], walls = [];
  for (const p of parts) {
    if (p.k === "panel" && Math.abs(p.n[1]) > 0.8) {
      let top = -1e9, minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
      const poly = [];
      for (const q of p.pts) {
        top = Math.max(top, q[1]);
        const x = q[0] + ox, z = q[2] + oz;
        poly.push([x, z]);
        minx = Math.min(minx, x); maxx = Math.max(maxx, x);
        minz = Math.min(minz, z); maxz = Math.max(maxz, z);
      }
      top += p.th * 0.5;
      if (top < 3) { floors.push({ poly, top, minx, maxx, minz, maxz }); continue; }
    }
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, minz = 1e9, maxz = -1e9;
    for (const [q, r] of partExtents(p)) {
      const rr = r || 0;
      minx = Math.min(minx, q[0] - rr); maxx = Math.max(maxx, q[0] + rr);
      miny = Math.min(miny, q[1] - rr); maxy = Math.max(maxy, q[1] + rr);
      minz = Math.min(minz, q[2] - rr); maxz = Math.max(maxz, q[2] + rr);
    }
    if (maxy < 0.35) continue;                       /* flat ground dressing */
    if (p.k === "panel" && (maxx - minx) * (maxz - minz) > 700) continue; /* diagonal fin AABBs lie */
    walls.push({ minx: minx + ox, maxx: maxx + ox, minz: minz + oz, maxz: maxz + oz,
      top: maxy, bot: miny });
  }
  return { floors, walls };
}
function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1])) c = !c;
  }
  return c;
}

/* ===================== bases (streamed) ===================== */
const bases = new Map();          /* site.key → base record */
const buildQueue = [];            /* staged jobs, one per frame slice */
const flown = new Set();          /* vehicle keys the player moved — never respawn */
const orphans = [];               /* moved vehicles that outlive their base */
const visited = new Set();

function makeMarker() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.06, 6, 40), markerMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), markerMat);
  gem.position.y = 2.4;
  g.add(ring, gem);
  return g;
}

function makeVehicle(kind, seed, key, spawn) {
  const yard = kind === "mech" ? MECHYARD : SHIPYARD;
  const built = yard.build(seed, spawn.far ? PARAMS_FAR : PARAMS);
  let scale;
  if (kind === "mech") scale = U_MECH;
  else {
    const L = Math.max(built.meta.length, built.meta.beam, built.meta.height);
    scale = L > 52 ? 52 / L : L < 18 ? 18 / L : 1;
  }
  const group = adaptMesh(built, yard, scale, vehLineMat);
  const bb = built.bb;
  const v = {
    kind, seed, key, built, scale, group,
    spawnX: spawn.x, spawnZ: spawn.z,
    pos: new THREE.Vector3(spawn.x, 0, spawn.z),
    yaw: spawn.yaw, quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.yaw),
    gc: -bb[0][1] * scale + 0.12,           /* origin height above the ground when parked */
    hx: (bb[1][0] - bb[0][0]) * 0.5 * scale,
    hz: (bb[1][2] - bb[0][2]) * 0.5 * scale,
    cx: (bb[1][0] + bb[0][0]) * 0.5 * scale,  /* obb centre offset, vehicle local */
    cz: (bb[1][2] + bb[0][2]) * 0.5 * scale,
    topY: bb[1][1] * scale,
    vel: new THREE.Vector3(), throttle: 0, landed: true,
    marker: makeMarker(),
  };
  /* cockpit camera, vehicle local */
  if (kind === "mech") {
    const head = built.envs.find(e => e.id === "head");
    v.cockpit = head
      ? new THREE.Vector3((head.c[0] + head.v[0] * 1.15) * scale,
                          (head.c[1] + head.v[1] * 1.15) * scale,
                          (head.c[2] + head.v[2] * 1.15) * scale)
      : new THREE.Vector3(1.2, bb[1][1] * 0.85 * scale, 0);
    v.radius = Math.max(v.hx, v.hz) * 0.55 + 0.6;
  } else {
    /* the eye must clear the hull: from the cockpit socket, walk out along its
       axis until no solid contains the point, else the view is the back of the
       nose cone */
    const cp = built.envs.find(e => e.id === "cockpit");
    let q = cp ? [cp.c[0] + cp.u[0] * 0.8, cp.c[1] + cp.u[1] * 0.8, cp.c[2] + cp.u[2] * 0.8]
               : [bb[1][0] * 0.75, bb[1][1] * 0.55, 0];
    const ul = cp ? Math.hypot(cp.u[0], cp.u[1], cp.u[2]) || 1 : 1;
    const dir = cp ? [cp.u[0] / ul, cp.u[1] / ul, cp.u[2] / ul] : [1, 0, 0];
    for (let i = 0; i < 60; i++) {
      if (!built.parts.some(p => SHIPYARD.inSolid(q, p))) break;
      q = [q[0] + dir[0] * 0.4, q[1] + dir[1] * 0.4, q[2] + dir[2] * 0.4];
    }
    q = [q[0] + dir[0] * 0.5, q[1] + dir[1] * 0.5, q[2] + dir[2] * 0.5];
    v.cockpit = new THREE.Vector3(q[0] * scale, q[1] * scale, q[2] * scale);
  }
  v.pos.y = groundForShip(v.pos.x, v.pos.z) + v.gc;
  scene.add(group);
  scene.add(v.marker);
  syncVehicle(v);
  return v;
}
function syncVehicle(v) {
  v.group.position.copy(v.pos);
  if (v.kind === "mech") v.group.rotation.set(0, v.yaw, 0);
  else v.group.quaternion.copy(v.quat);
  const g = v.kind === "mech" ? v.pos.y : v.pos.y - v.gc;
  v.marker.position.set(v.pos.x, (v.kind === "mech" ? groundAtSimple(v.pos.x, v.pos.z) : g) + 0.1, v.pos.z);
}
function disposeGroup(g) {
  g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  scene.remove(g);
}

function scheduleBase(site) {
  const rec = { site, state: "building", group: null, floors: [], walls: [], hash: new Map(),
    vehicles: [], meta: null, pad: null, extent: 500 };
  bases.set(site.key, rec);
  const isSpawn = site.key === "0,0";
  buildQueue.push(() => {                       /* 1: generate the base part list */
    const b = BASEYARD.build(site.seed, PARAMS);
    b.parts = b.parts.filter(p => !p.ter);      /* real terrain replaces the survey slab */
    rec.built = b;
    rec.meta = b.meta;
  });
  buildQueue.push(() => {                       /* 2: colliders */
    const st = extractStatics(rec.built.parts, BASEYARD.partExtents, site.x, site.z);
    rec.floors = st.floors; rec.walls = st.walls;
    let ext = 120;
    for (const w of st.walls)
      ext = Math.max(ext, Math.hypot(Math.max(Math.abs(w.minx - site.x), Math.abs(w.maxx - site.x)),
                                     Math.max(Math.abs(w.minz - site.z), Math.abs(w.maxz - site.z))));
    rec.extent = ext + 60;
    for (let i = 0; i < st.walls.length; i++) {
      const w = st.walls[i];
      for (let a = Math.floor(w.minx / 24); a <= Math.floor(w.maxx / 24); a++)
        for (let c = Math.floor(w.minz / 24); c <= Math.floor(w.maxz / 24); c++) {
          const k = a + "," + c;
          if (!rec.hash.has(k)) rec.hash.set(k, []);
          rec.hash.get(k).push(w);
        }
    }
  });
  buildQueue.push(() => {                       /* 3: mesh + edge lines */
    rec.group = adaptMesh(rec.built, BASEYARD, 1, baseLineMat);
    rec.group.position.set(site.x, 0, site.z);
    scene.add(rec.group);
  });
  buildQueue.push(() => {                       /* 4+: vehicles */
    const envs = rec.built.envs;
    const garage = envs.find(e => e.id === "garage"), pad = envs.find(e => e.id === "pad");
    rec.pad = pad ? { x: pad.c[0] + site.x, z: pad.c[2] + site.z } : null;
    const jobs = [];
    if (garage) {
      const vlen = Math.hypot(garage.v[0], garage.v[2]) || 1;
      const dirx = garage.v[0] / vlen, dirz = garage.v[2] / vlen;
      const n = 1 + (hash2(site.seed, 91) & 1);
      for (let i = 0; i < n; i++) {
        const key = site.key + ":mech" + i;
        if (flown.has(key)) continue;
        const off = (i - (n - 1) / 2) * 16;
        jobs.push({ kind: "mech", seed: hash3(site.seed, 0x4d45, i), key,
          x: site.x + garage.c[0] - dirz * off + dirx * 18,
          z: site.z + garage.c[2] + dirx * off + dirz * 18,
          yaw: Math.atan2(-dirz, dirx), far: !isSpawn });
      }
    }
    if (pad) {
      const vlen = Math.hypot(pad.v[0], pad.v[2]) || 1;
      const ox = -pad.v[0] / vlen, oz = -pad.v[2] / vlen;   /* the berm's open side */
      const key = site.key + ":ship0";
      if (!flown.has(key))
        jobs.push({ kind: "ship", seed: hash3(site.seed, 0x5348, 0), key,
          x: site.x + pad.c[0] + ox * 52, z: site.z + pad.c[2] + oz * 52,
          yaw: Math.atan2(-oz, ox), far: false });
    }
    for (const j of jobs)
      buildQueue.push(() => { rec.vehicles.push(makeVehicle(j.kind, j.seed, j.key, j)); });
    buildQueue.push(() => { rec.state = "built"; });
  });
  return rec;
}
function disposeBase(rec) {
  if (rec.group) disposeGroup(rec.group);
  for (const v of rec.vehicles) {
    const moved = Math.hypot(v.pos.x - v.spawnX, v.pos.z - v.spawnZ) > 5;
    if (v === player.vehicle || moved) { flown.add(v.key); orphans.push(v); }
    else { disposeGroup(v.group); scene.remove(v.marker); }
  }
  bases.delete(rec.site.key);
}
function pumpBuild() {
  if (!buildQueue.length) return;
  const job = buildQueue.shift();
  job();
}
function updateStreaming(px, pz) {
  for (const s of nearSites(px, pz)) {
    const d = Math.hypot(px - s.x, pz - s.z);
    if (d < BUILD_R && !bases.has(s.key)) scheduleBase(s);
  }
  for (const rec of [...bases.values()]) {
    if (rec.state !== "built") continue;
    const d = Math.hypot(px - rec.site.x, pz - rec.site.z);
    if (d > DISPOSE_R && (!player.vehicle || !rec.vehicles.includes(player.vehicle)))
      disposeBase(rec);
  }
}
function* liveVehicles() {
  for (const rec of bases.values()) for (const v of rec.vehicles) yield v;
  for (const v of orphans) yield v;
}

/* ===================== ground / collision ===================== */
function groundAtSimple(x, z) { return terrainH(x, z); }
function groundForShip(x, z) {
  let g = terrainH(x, z);
  for (const rec of bases.values()) {
    if (!rec.floors.length) continue;
    if (Math.hypot(x - rec.site.x, z - rec.site.z) > rec.extent) continue;
    for (const f of rec.floors) {
      if (x < f.minx || x > f.maxx || z < f.minz || z > f.maxz) continue;
      if (inPoly(f.poly, x, z)) g = Math.max(g, f.top);
    }
  }
  return g;
}
/* capsule vs world: mutates p.x/p.z for pushout, returns the supporting ground */
function collideCapsule(p, rad, step, height) {
  let ground = terrainH(p.x, p.z);
  const head = p.y + height;
  for (const rec of bases.values()) {
    if (Math.hypot(p.x - rec.site.x, p.z - rec.site.z) > rec.extent) continue;
    for (const f of rec.floors) {
      if (p.x < f.minx - rad || p.x > f.maxx + rad || p.z < f.minz - rad || p.z > f.maxz + rad) continue;
      if (f.top <= p.y + step && inPoly(f.poly, p.x, p.z)) ground = Math.max(ground, f.top);
    }
    const seen = new Set();
    for (const a of [Math.floor((p.x - rad) / 24), Math.floor((p.x + rad) / 24)])
      for (const c of [Math.floor((p.z - rad) / 24), Math.floor((p.z + rad) / 24)]) {
        const list = rec.hash.get(a + "," + c);
        if (!list) continue;
        for (const w of list) {
          if (seen.has(w)) continue;
          seen.add(w);
          const ex0 = w.minx - rad, ex1 = w.maxx + rad, ez0 = w.minz - rad, ez1 = w.maxz + rad;
          if (p.x < ex0 || p.x > ex1 || p.z < ez0 || p.z > ez1) continue;
          if (w.top <= p.y + step) {
            if (p.x > w.minx && p.x < w.maxx && p.z > w.minz && p.z < w.maxz)
              ground = Math.max(ground, w.top);
            continue;
          }
          if (w.bot >= head) continue;
          const dx0 = p.x - ex0, dx1 = ex1 - p.x, dz0 = p.z - ez0, dz1 = ez1 - p.z;
          const m = Math.min(dx0, dx1, dz0, dz1);
          if (m === dx0) p.x = ex0; else if (m === dx1) p.x = ex1;
          else if (m === dz0) p.z = ez0; else p.z = ez1;
        }
      }
  }
  /* parked vehicles are obstacles too */
  for (const v of liveVehicles()) {
    if (v === player.vehicle) continue;
    if (v.kind === "mech") {
      const dx = p.x - v.pos.x, dz = p.z - v.pos.z, d = Math.hypot(dx, dz), r = v.radius + rad;
      if (d < r && d > 1e-6) { p.x = v.pos.x + dx / d * r; p.z = v.pos.z + dz / d * r; }
    } else {
      const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
      const wx = p.x - v.pos.x, wz = p.z - v.pos.z;
      let lx = c * wx - s * wz - v.cx, lz = s * wx + c * wz - v.cz;
      const hx = v.hx + rad, hz = v.hz + rad;
      if (Math.abs(lx) < hx && Math.abs(lz) < hz && v.pos.y - v.gc < p.y + height && v.pos.y - v.gc + v.topY + v.gc > p.y) {
        const px = hx - Math.abs(lx), pz2 = hz - Math.abs(lz);
        if (px < pz2) lx += Math.sign(lx || 1) * px; else lz += Math.sign(lz || 1) * pz2;
        p.x = v.pos.x + (c * (lx + v.cx) + s * (lz + v.cz));
        p.z = v.pos.z + (-s * (lx + v.cx) + c * (lz + v.cz));
      }
    }
  }
  return ground;
}

/* ===================== input ===================== */
const keys = new Set();
let mouseDX = 0, mouseDY = 0, locked = false;
addEventListener("keydown", e => {
  if (e.code === "Space") e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === "KeyE") onUse();
  if (e.code === "Backquote") dbgOn = !dbgOn, dbg.style.display = dbgOn ? "block" : "none";
});
addEventListener("keyup", e => keys.delete(e.code));
addEventListener("mousemove", e => { if (locked) { mouseDX += e.movementX; mouseDY += e.movementY; } });
document.addEventListener("pointerlockchange", () => { locked = document.pointerLockElement === renderer.domElement; });
renderer.domElement.addEventListener("click", () => {
  if (mode !== "title" && !locked) renderer.domElement.requestPointerLock();
});

/* ===================== HUD ===================== */
const $ = id => document.getElementById(id);
const plateEl = $("plate"), promptEl = $("prompt"), statEl = $("stat"), navEl = $("nav"),
      helpEl = $("help"), dbg = $("dbg");
let dbgOn = false, plateTimer = 0;
function showPlate(d, k, secs) {
  plateEl.children[0].textContent = d;
  plateEl.children[1].textContent = k;
  plateEl.style.opacity = 1;
  plateTimer = secs || 5;
}
const HELP = {
  foot: "WASD MOVE · SHIFT RUN · SPACE JUMP · E BOARD",
  mech: "W/S DRIVE · A/D TURN · MOUSE LOOK · E DISMOUNT",
  ship: "W/S THROTTLE · MOUSE PITCH/YAW · A/D ROLL · SPACE LIFT · SHIFT DESCEND · X BRAKE · E EXIT WHEN LANDED",
};
const navMarks = [];
for (let i = 0; i < 5; i++) {
  const d = document.createElement("div");
  d.className = "mark"; d.style.display = "none";
  document.body.appendChild(d);
  navMarks.push(d);
}

/* ===================== beacons ===================== */
const beaconMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true,
  opacity: 0.6, fog: false });
const beaconLines = new THREE.LineSegments(new THREE.BufferGeometry(), beaconMat);
beaconLines.frustumCulled = false;
scene.add(beaconLines);
let beaconStamp = "";
const beaconCol = new THREE.Color(COLOR.beacon);
function updateBeacons(px, pz) {
  const cx = Math.round(px / CELL), cz = Math.round(pz / CELL), R = Math.ceil(BEACON_R / CELL);
  const list = [];
  for (let i = cx - R; i <= cx + R; i++) for (let j = cz - R; j <= cz + R; j++) {
    const s = siteAt(i, j);
    if (s && Math.hypot(px - s.x, pz - s.z) < BEACON_R) list.push(s);
  }
  const stamp = list.map(s => s.key).join("|");
  if (stamp !== beaconStamp) {
    beaconStamp = stamp;
    const pos = new Float32Array(list.length * 6), col = new Float32Array(list.length * 6);
    list.forEach((s, i) => {
      pos.set([s.x, 0, s.z, s.x, 1100, s.z], i * 6);
      const k = Math.pow(Math.max(0, 1 - Math.hypot(px - s.x, pz - s.z) / BEACON_R), 1.6);
      col.set([beaconCol.r * k, beaconCol.g * k, beaconCol.b * k,
               beaconCol.r * k, beaconCol.g * k, beaconCol.b * k], i * 6);
    });
    beaconLines.geometry.dispose();
    beaconLines.geometry = new THREE.BufferGeometry();
    beaconLines.geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    beaconLines.geometry.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  return list;
}
let beaconList = [];

/* ===================== player & modes ===================== */
const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0,
  grounded: false, vehicle: null, look: { yaw: 0, pitch: 0 }, phase: 0, bob: 0,
};
let mode = "title";
let lerpT = 0, lerpDur = 0.7, lerpFrom = null, lerpNext = "", nearVeh = null;
const EYE = 1.7;

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v1 = new THREE.Vector3();
const Q_ALIGN = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);

function footPose(out) {
  out.pos.copy(player.pos).y += EYE;
  out.quat.setFromEuler(new THREE.Euler(0, player.yaw, 0, "YXZ"));
  _q1.setFromAxisAngle(new THREE.Vector3(1, 0, 0), player.pitch);
  out.quat.multiply(_q1);
}
function mechPose(out) {
  const v = player.vehicle;
  out.pos.copy(v.cockpit).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.yaw).add(v.pos);
  out.pos.y += player.bob;
  out.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), v.yaw).multiply(Q_ALIGN);
  _q1.setFromAxisAngle(new THREE.Vector3(0, 1, 0), player.look.yaw);
  _q2.setFromAxisAngle(new THREE.Vector3(1, 0, 0), player.look.pitch);
  out.quat.multiply(_q1).multiply(_q2);
}
function shipPose(out) {
  const v = player.vehicle;
  out.pos.copy(v.cockpit).applyQuaternion(v.quat).add(v.pos);
  out.quat.copy(v.quat).multiply(Q_ALIGN);
}
const poseA = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const poseB = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
function startLerp(next) {
  poseA.pos.copy(camera.position); poseA.quat.copy(camera.quaternion);
  lerpFrom = poseA; lerpT = 0; lerpNext = next; mode = "lerp";
}

function onUse() {
  if (mode === "foot" && (nearVeh = findNearVehicle())) {
    player.vehicle = nearVeh;
    player.look.yaw = 0; player.look.pitch = -0.04;
    showPlate(nearVeh.built.meta.desig, nearVeh.built.meta.klass, 5);
    startLerp(nearVeh.kind);
  } else if (mode === "mech") {
    const v = player.vehicle;
    _v1.set(0, 0, v.hz + 2.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.yaw);
    player.pos.set(v.pos.x + _v1.x, 0, v.pos.z + _v1.z);
    player.pos.y = terrainH(player.pos.x, player.pos.z) + 0.1;
    player.pos.y = collideCapsule(player.pos, 0.4, 0.7, 1.9);
    player.vel.set(0, 0, 0);
    const d = camera.getWorldDirection(_v1);
    player.yaw = Math.atan2(-d.x, -d.z); player.pitch = 0;
    player.vehicle = null;
    startLerp("foot");
  } else if (mode === "ship" && player.vehicle.landed) {
    const v = player.vehicle;
    _v1.set(0, 0, v.hz + 3).applyQuaternion(v.quat);
    player.pos.set(v.pos.x + _v1.x, 0, v.pos.z + _v1.z);
    player.pos.y = terrainH(player.pos.x, player.pos.z) + 0.1;
    player.pos.y = collideCapsule(player.pos, 0.4, 0.7, 1.9);
    player.vel.set(0, 0, 0);
    const d = camera.getWorldDirection(_v1);
    player.yaw = Math.atan2(-d.x, -d.z); player.pitch = 0;
    player.vehicle = null;
    startLerp("foot");
  }
}

/* ---------- per-mode simulation ---------- */
function stepFoot(dt) {
  player.yaw -= mouseDX * 0.0022;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - mouseDY * 0.0022));
  const run = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const sp = run ? 6 : 2.8;
  let wx = 0, wz = 0;
  if (keys.has("KeyW")) wz -= 1;
  if (keys.has("KeyS")) wz += 1;
  if (keys.has("KeyA")) wx -= 1;
  if (keys.has("KeyD")) wx += 1;
  const L = Math.hypot(wx, wz) || 1;
  const c = Math.cos(player.yaw), s = Math.sin(player.yaw);
  const tx = (wx * c + wz * s) / L * sp, tz = (wz * c - wx * s) / L * sp;
  const k = 1 - Math.exp(-(player.grounded ? 12 : 2.2) * dt);
  player.vel.x += (tx - player.vel.x) * k;
  player.vel.z += (tz - player.vel.z) * k;
  player.vel.y -= G * dt;
  if (player.grounded && keys.has("Space")) { player.vel.y = 2.9; player.grounded = false; }
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.pos.y += player.vel.y * dt;
  const ground = collideCapsule(player.pos, 0.42, 0.65, 1.9);
  if (player.pos.y <= ground) {
    player.pos.y = ground;
    player.vel.y = Math.max(0, player.vel.y);
    player.grounded = true;
  } else player.grounded = player.pos.y - ground < 0.05;
  nearVeh = findNearVehicle();
}
function findNearVehicle() {
  let found = null, best = 1e9;
  for (const v of liveVehicles()) {
    const r = v.kind === "mech" ? v.radius + 4.5 : Math.max(v.hx, v.hz) + 5;
    const d = Math.hypot(player.pos.x - v.pos.x, player.pos.z - v.pos.z);
    if (d < r && d < best) { best = d; found = v; }
  }
  return found;
}
function stepMech(dt) {
  const v = player.vehicle;
  player.look.yaw = Math.max(-2.6, Math.min(2.6, player.look.yaw - mouseDX * 0.0022));
  player.look.pitch = Math.max(-1.1, Math.min(0.9, player.look.pitch - mouseDY * 0.0022));
  const fwd = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  const trn = (keys.has("KeyA") ? 1 : 0) - (keys.has("KeyD") ? 1 : 0);
  v.speed = v.speed || 0;
  const max = fwd >= 0 ? (keys.has("ShiftLeft") ? 13 : 10) : 4;
  v.speed += ((fwd ? fwd * max : 0) - v.speed) * (1 - Math.exp(-2.4 * dt));
  v.yaw += trn * 1.05 * dt * (1 - Math.abs(v.speed) / 40);
  const c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  _v1.set(v.pos.x + c * v.speed * dt, v.pos.y, v.pos.z - s * v.speed * dt);
  const g = collideCapsule(_v1, 3.2, 3.2, (v.topY - v.gc) || 12);
  v.pos.x = _v1.x; v.pos.z = _v1.z;
  const ty = g + v.gc;
  v.pos.y += (ty - v.pos.y) * (1 - Math.exp(-7 * dt));
  /* gait: a stride fake, honest about speed */
  player.phase += Math.abs(v.speed) * dt * 0.9;
  player.bob = Math.sin(player.phase * Math.PI) * 0.22 * Math.min(1, Math.abs(v.speed) / 4);
  syncVehicle(v);
}
function stepShip(dt) {
  const v = player.vehicle;
  const alt = v.pos.y - v.gc - groundForShip(v.pos.x, v.pos.z);
  const inSpace = alt > 2000;
  if (v.landed) {
    v.throttle = 0;
    /* settle level, yaw only */
    _v1.set(1, 0, 0).applyQuaternion(v.quat);
    const yaw = Math.atan2(-_v1.z, _v1.x);
    _q1.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    v.quat.slerp(_q1, 1 - Math.exp(-6 * dt));
    v.yaw = yaw;
    if (keys.has("Space") || keys.has("KeyW")) { v.landed = false; v.vel.y = 3.5; }
    syncVehicle(v);
    return;
  }
  v.throttle = Math.max(0, Math.min(1, v.throttle
    + ((keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0)) * 0.55 * dt));
  if (keys.has("KeyX")) { v.throttle = 0; v.vel.multiplyScalar(Math.exp(-1.6 * dt)); }
  v.pv = v.pv || 0; v.yv = v.yv || 0; v.rv = v.rv || 0;
  v.pv += -mouseDY * 0.0011; v.yv += -mouseDX * 0.0011;
  v.rv += ((keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0)) * 2.4 * dt;
  const ad = Math.exp(-3.2 * dt);
  v.pv *= ad; v.yv *= ad; v.rv *= ad;
  _q1.setFromAxisAngle(new THREE.Vector3(0, 0, 1), v.pv * dt * 60 * 0.02); v.quat.multiply(_q1);
  _q1.setFromAxisAngle(new THREE.Vector3(0, 1, 0), v.yv * dt * 60 * 0.02); v.quat.multiply(_q1);
  _q1.setFromAxisAngle(new THREE.Vector3(1, 0, 0), v.rv * dt * 60 * 0.02); v.quat.multiply(_q1);
  v.quat.normalize();
  const ACC = inSpace ? 60 : 30;
  _v1.set(1, 0, 0).applyQuaternion(v.quat);
  v.vel.addScaledVector(_v1, v.throttle * ACC * dt);
  _v1.set(0, 1, 0).applyQuaternion(v.quat);
  if (keys.has("Space")) v.vel.addScaledVector(_v1, 15 * dt);
  if (keys.has("ShiftLeft")) v.vel.addScaledVector(_v1, -11 * dt);
  const g = G * Math.max(0, Math.min(1, 1 - (alt - 2000) / 3000));
  v.vel.y -= g * dt;
  v.vel.multiplyScalar(Math.exp(-0.22 * dt));
  v.pos.addScaledVector(v.vel, dt);
  const gy = groundForShip(v.pos.x, v.pos.z);
  if (v.pos.y - v.gc <= gy) {
    v.pos.y = gy + v.gc;
    const vs = v.vel.y, sp = v.vel.length();
    if (Math.abs(vs) < 10 && sp < 30) {
      v.landed = true; v.vel.set(0, 0, 0); v.pv = v.yv = v.rv = 0;
      /* arrival: which base is this? */
      for (const rec of bases.values()) {
        if (!rec.pad) continue;
        if (Math.hypot(v.pos.x - rec.pad.x, v.pos.z - rec.pad.z) < 180 && !visited.has(rec.site.key)) {
          visited.add(rec.site.key);
          showPlate(rec.meta.desig, rec.meta.klass + " · PAD SECURED", 6);
        }
      }
    } else {
      v.vel.y = Math.abs(vs) * 0.35;
      v.vel.x *= 0.55; v.vel.z *= 0.55;
    }
  }
  syncVehicle(v);
}

/* ===================== atmosphere / hud refresh ===================== */
const fogC = new THREE.Color();
function updateAtmos() {
  const alt = Math.max(0, camera.position.y - terrainH(camera.position.x, camera.position.z));
  const t = Math.min(1, alt / 2600);
  fogC.copy(COLOR.bgGround).lerp(COLOR.bgSpace, t);
  scene.background.copy(fogC);
  scene.fog.color.copy(fogC);
  scene.fog.near = 500 + alt * 2.2;
  scene.fog.far = 3800 + alt * 14;
  for (const tier of TIERS) {
    tier.mat.uniforms.uFogN.value = scene.fog.near;
    tier.mat.uniforms.uFogF.value = scene.fog.far;
    tier.mat.uniforms.uFogC.value = scene.fog.color;
  }
  stars.material.opacity = 0.35 + 0.65 * t;
  stars.position.copy(camera.position);
}
let hudT = 0;
function updateHUD(dt) {
  if (plateTimer > 0) { plateTimer -= dt; if (plateTimer <= 0) plateEl.style.opacity = 0; }
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.12;
  helpEl.textContent = HELP[mode] || "";
  if (mode === "foot" && nearVeh) {
    promptEl.innerHTML = "<b>E</b> BOARD " + nearVeh.built.meta.desig;
    promptEl.style.opacity = 1;
  } else if (mode === "ship" && player.vehicle && player.vehicle.landed) {
    promptEl.innerHTML = "<b>E</b> DISEMBARK &nbsp;·&nbsp; <b>SPACE</b> LIFT OFF";
    promptEl.style.opacity = 1;
  } else promptEl.style.opacity = 0;
  let s = "";
  if (mode === "foot") s = "<span class=m>ON FOOT</span>";
  else if (mode === "mech" && player.vehicle)
    s = "<span class=m>MECH</span><br>SPD " + Math.abs(player.vehicle.speed || 0).toFixed(1) + " M/S";
  else if (mode === "ship" && player.vehicle) {
    const v = player.vehicle;
    const alt = Math.max(0, v.pos.y - v.gc - groundForShip(v.pos.x, v.pos.z));
    s = "<span class=m>" + (alt > 2000 ? "SPACE" : v.landed ? "LANDED" : "FLIGHT") + "</span><br>"
      + "SPD " + v.vel.length().toFixed(0) + " M/S<br>ALT " + alt.toFixed(0) + " M<br>"
      + "THR " + Math.round(v.throttle * 100) + "%";
  }
  statEl.innerHTML = s;
  /* current site, by proximity */
  let here = null, hd = 1e9;
  for (const rec of bases.values()) {
    if (!rec.meta) continue;
    const d = Math.hypot(camera.position.x - rec.site.x, camera.position.z - rec.site.z);
    if (d < 900 && d < hd) { hd = d; here = rec; }
  }
  navEl.innerHTML = here ? "<span class=t>" + here.meta.desig + "</span><br>" + here.meta.klass
    : (mode === "ship" ? "OPEN MARE" : "");
  /* nav markers to other sites, flight only */
  const wantMarks = (mode === "ship" && player.vehicle && !player.vehicle.landed);
  const sorted = wantMarks
    ? beaconList.map(sSite => ({ sSite, d: Math.hypot(camera.position.x - sSite.x, camera.position.z - sSite.z) }))
        .filter(o => o.d > 500).sort((a, b) => a.d - b.d).slice(0, 5)
    : [];
  for (let i = 0; i < navMarks.length; i++) {
    const mk = navMarks[i];
    if (i >= sorted.length) { mk.style.display = "none"; continue; }
    const { sSite, d } = sorted[i];
    _v1.set(sSite.x, terrainH(sSite.x, sSite.z) + 120, sSite.z).project(camera);
    if (_v1.z > 1 || Math.abs(_v1.x) > 1.05 || Math.abs(_v1.y) > 1.05) { mk.style.display = "none"; continue; }
    mk.style.display = "block";
    mk.style.left = ((_v1.x * 0.5 + 0.5) * innerWidth) + "px";
    mk.style.top = ((-_v1.y * 0.5 + 0.5) * innerHeight) + "px";
    mk.textContent = sSite.label + " · " + (d / 1000).toFixed(1) + " KM";
  }
}

/* ===================== boot ===================== */
$("tseed").textContent = "WORLD SEED " + worldSeed;
const spawnSite = siteAt(0, 0);
scheduleBase(spawnSite);
while (buildQueue.length) buildQueue.shift()();      /* home base builds behind the title card */
const homeRec = bases.get("0,0");
{
  const hab = homeRec.built.envs.find(e => e.id === "hab");
  const vl = Math.hypot(hab.v[0], hab.v[2]) || 1;
  player.pos.set(hab.c[0] + hab.v[0] / vl * 55, 0, hab.c[2] + hab.v[2] / vl * 55);
  player.pos.y = terrainH(player.pos.x, player.pos.z);
  player.yaw = Math.atan2(hab.v[0] / vl, hab.v[2] / vl) + Math.PI;
  /* face the hab */
  const dx = hab.c[0] - player.pos.x, dz = hab.c[2] - player.pos.z;
  player.yaw = Math.atan2(-dx, -dz);
}
updateChunks(player.pos.x, player.pos.z, true);
pumpChunks(1e9);                                     /* first ring, synchronously */
$("tgo").textContent = "CLICK TO ENTER";
$("title").addEventListener("click", () => {
  if (mode !== "title") return;
  mode = "foot";
  $("title").style.opacity = 0;
  setTimeout(() => $("title").remove(), 900);
  renderer.domElement.requestPointerLock();
  showPlate(homeRec.meta.desig, homeRec.meta.klass, 7);
});

/* ===================== main loop ===================== */
let last = performance.now(), fps = 60, worst = 0, beaconT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  const ms = now - last;
  last = now;
  fps = fps * 0.95 + (1000 / Math.max(ms, 1e-3)) * 0.05;
  worst = Math.max(worst * 0.98, ms);
  tick(dt, now);
  renderer.render(scene, camera);
}
function tick(dt, now) {
  if (mode === "foot") stepFoot(dt);
  else if (mode === "mech") stepMech(dt);
  else if (mode === "ship") stepShip(dt);
  else if (mode === "lerp") {
    lerpT += dt / lerpDur;
    if (lerpT >= 1) { mode = lerpNext; lerpT = 0; }
  }
  mouseDX = 0; mouseDY = 0;

  /* camera */
  if (mode === "foot") footPose(poseB);
  else if (mode === "mech") mechPose(poseB);
  else if (mode === "ship") shipPose(poseB);
  else if (mode === "lerp") {
    const target = { pos: poseB.pos, quat: poseB.quat };
    if (lerpNext === "foot") footPose(target);
    else if (lerpNext === "mech") mechPose(target);
    else shipPose(target);
    const t = lerpT * lerpT * (3 - 2 * lerpT);
    poseB.pos.lerpVectors(lerpFrom.pos, target.pos, t);
    poseB.quat.slerpQuaternions(lerpFrom.quat, target.quat, t);
  }
  if (mode !== "title") {
    camera.position.copy(poseB.pos);
    camera.quaternion.copy(poseB.quat);
  } else {
    /* slow establishing orbit behind the title card */
    const a = now * 0.00004;
    camera.position.set(Math.cos(a) * 420, 150, Math.sin(a) * 420);
    camera.lookAt(0, 10, 0);
  }

  /* pulse markers */
  const pulse = 0.72 + Math.sin(now * 0.004) * 0.25;
  markerMat.opacity = pulse;
  for (const v of liveVehicles())
    v.marker.visible = mode === "foot" && v !== player.vehicle
      && v.marker.position.distanceTo(camera.position) < 260;

  updateStreaming(camera.position.x, camera.position.z);
  pumpBuild();
  updateChunks(camera.position.x, camera.position.z, false);
  pumpChunks(5);
  beaconT -= dt;
  if (beaconT <= 0) { beaconT = 1.2; beaconList = updateBeacons(camera.position.x, camera.position.z); }
  updateAtmos();
  updateHUD(dt);

  if (dbgOn) {
    const info = renderer.info.render;
    dbg.textContent =
      `fps ${fps.toFixed(0)}  worst ${worst.toFixed(1)}ms\n` +
      `calls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k\n` +
      `pos ${camera.position.x.toFixed(0)},${camera.position.y.toFixed(0)},${camera.position.z.toFixed(0)}\n` +
      `mode ${mode}  bases ${bases.size}  buildQ ${buildQueue.length}\n` +
      `chunks ${TIERS.map(t => t.live.size).join("/")}  chunkQ ${chunkQueue.length}\n` +
      `seed ${worldSeed}  visited ${visited.size}`;
  }
}
requestAnimationFrame(frame);

/* debug handle (also used by the automated flythrough tests) */
window.YW = { player, bases, camera, keys, get mode() { return mode; }, set mode(m) { mode = m; },
  onUse, terrainH, groundForShip, liveVehicles, showPlate, renderer,
  step: (dt = 0.05, n = 1) => { for (let i = 0; i < n; i++) tick(dt, performance.now()); renderer.render(scene, camera); },
  stats: () => ({ fps, worst, bases: bases.size, queue: buildQueue.length }) };
