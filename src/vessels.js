// Model dimensions use metres. The origin is on the waterline and the bow points along -Z.
const coat = {
  ivory: '#f1f1ed', pearl: '#dce0df', whiteShade: '#becbd0',
  navy: '#1b2c44', navyShade: '#101e32', deck: '#323d45',
  graphite: '#263239', rubber: '#20272b', black: '#141d21',
  amber: '#f4b32d', metal: '#bdcbd0', steel: '#75848a', glass: '#183647'
};

const surveyLiveries = { A: '#edab45', B: '#46c9b7' };

const modelLibraries = new WeakMap();

function library(T) {
  if (!modelLibraries.has(T)) {
    const finish = (roughness, metalness) => new T.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness, metalness
    });
    const tread = finish(0.86, 0.04);
    const textureSize = 32;
    const pattern = new Uint8Array(textureSize * textureSize * 4);
    for (let y = 0; y < textureSize; y++) {
      for (let x = 0; x < textureSize; x++) {
        const u = (x + (Math.floor(y / 8) % 2) * 4) % 8 - 3.5;
        const v = (y % 8) - 3.5;
        const height = Math.round(65 + Math.max(0, 1 - (u * u + v * v) / 8) * 140);
        const offset = 4 * (y * textureSize + x);
        pattern.set([height, height, height, 255], offset);
      }
    }
    const relief = new T.DataTexture(pattern, textureSize, textureSize, T.RGBAFormat);
    relief.wrapS = relief.wrapT = T.RepeatWrapping;
    relief.magFilter = T.LinearFilter;
    relief.minFilter = T.LinearMipmapLinearFilter;
    relief.generateMipmaps = true;
    relief.needsUpdate = true;
    tread.bumpMap = relief;
    tread.bumpScale = 0.0018;
    modelLibraries.set(T, {
      materials: {
        paint: finish(0.47, 0.12), matte: finish(0.84, 0.04), tread,
        metal: finish(0.36, 0.53), glass: finish(0.19, 0.28),
        light: new T.MeshBasicMaterial({ color: 0xffffff, vertexColors: true })
      },
      models: new Map()
    });
  }
  return modelLibraries.get(T);
}

// Bake small fixtures into indexed, vertex-coloured meshes grouped by surface finish.
function makeParts(T) {
  const batches = new Map();
  const colours = new Map();
  const up = new T.Vector3(0, 1, 0);
  function add(geo, color, surface = 'paint') {
    if (!batches.has(surface)) {
      batches.set(surface, { vertices: [], normals: [], colors: [], indices: [] });
    }
    if (!colours.has(color)) colours.set(color, new T.Color(color));
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const batch = batches.get(surface);
    const pos = geo.getAttribute('position');
    const normal = geo.getAttribute('normal');
    const tint = colours.get(color);
    const base = batch.vertices.length / 3;
    for (let i = 0; i < pos.count; i++) {
      batch.vertices.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      batch.normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      batch.colors.push(tint.r, tint.g, tint.b);
    }
    const count = geo.index ? geo.index.count : pos.count;
    for (let i = 0; i < count; i++) {
      batch.indices.push(base + (geo.index ? geo.index.getX(i) : i));
    }
    geo.dispose();
  }
  function at(geo, point, color, surface) {
    add(geo.translate(...point), color, surface);
  }
  function box(point, size, color, surface = 'paint') {
    at(new T.BoxGeometry(...size), point, color, surface);
  }
  function cylinder(point, top, bottom, height, color, surface = 'paint', axis = 'y', segments = 20) {
    const geo = new T.CylinderGeometry(top, bottom, height, segments);
    if (axis === 'x') geo.rotateZ(-Math.PI / 2);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    at(geo, point, color, surface);
  }
  function ellipsoid(point, size, color, surface = 'paint') {
    const geo = new T.SphereGeometry(1, 16, 10).scale(...size);
    at(geo, point, color, surface);
  }
  function rod(a, b, radius, color, surface = 'metal', sides = 10) {
    const start = new T.Vector3(...a);
    const direction = new T.Vector3(...b).sub(start);
    const length = direction.length();
    const middle = start.addScaledVector(direction, 0.5);
    const geo = new T.CylinderGeometry(radius, radius, length, sides);
    geo.applyQuaternion(new T.Quaternion().setFromUnitVectors(up, direction.normalize()));
    at(geo, middle.toArray(), color, surface);
  }
  function hoop(point, major, minor, color, surface, axis = 'y') {
    const geo = new T.TorusGeometry(major, minor, 8, 32);
    if (axis === 'y') geo.rotateX(Math.PI / 2);
    if (axis === 'x') geo.rotateY(Math.PI / 2);
    at(geo, point, color, surface);
  }
  function tube(points, radius, color, surface = 'paint', closed = false) {
    const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p)), closed, 'centripetal');
    add(new T.TubeGeometry(curve, Math.max(15, points.length * 3), radius, 7, closed), color, surface);
  }
  function surfaceMesh(vertices, indices, color, surface = 'paint') {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    add(geo, color, surface);
  }
  function build(name) {
    const group = new T.Group();
    group.name = name;
    for (const [surface, batch] of batches) {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(batch.vertices, 3));
      geo.setAttribute('normal', new T.Float32BufferAttribute(batch.normals, 3));
      geo.setAttribute('color', new T.Float32BufferAttribute(batch.colors, 3));
      if (surface === 'tread') {
        const uv = [];
        for (let k = 0; k < batch.vertices.length; k += 3) {
          uv.push(batch.vertices[k] * 6, batch.vertices[k + 2] * 6);
        }
        geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      }
      geo.setIndex(batch.indices);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      const mesh = new T.Mesh(geo, library(T).materials[surface]);
      mesh.name = name + '-' + surface;
      mesh.castShadow = surface !== 'light';
      mesh.receiveShadow = surface !== 'light';
      group.add(mesh);
    }
    return group;
  }
  return { add, box, cylinder, ellipsoid, rod, hoop, tube, surfaceMesh, build };
}

// Each longitudinal station has a counterclockwise cross section as seen from the stern.
function loft(parts, rings, panels, capColor) {
  const n = rings[0].length;
  for (let k = 0; k < n; k++) {
    const vertices = [];
    const triangles = [];
    for (let i = 0; i < rings.length; i++) {
      vertices.push(...rings[i][k], ...rings[i][(k + 1) % n]);
      if (i + 1 < rings.length) {
        const a = 2 * i;
        triangles.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    parts.surfaceMesh(vertices, triangles, panels[k]);
  }
  for (const end of [0, rings.length - 1]) {
    const ring = rings[end];
    const center = [0, 0, 0];
    for (const point of ring) {
      for (let j = 0; j < 3; j++) center[j] += point[j] / n;
    }
    const triangles = [];
    for (let k = 0; k < n; k++) {
      const a = 1 + k;
      const b = 1 + (k + 1) % n;
      triangles.push(0, end === 0 ? b : a, end === 0 ? a : b);
    }
    parts.surfaceMesh([...center, ...ring.flat()], triangles, capColor);
  }
}

// Rounded polygon deck plates, extruded vertically from an X/Z plan.
function plate(T, parts, outline, y, height, color, surface = 'paint', corner = 0.035, bevel = 0.008) {
  const shape = new T.Shape();
  const corners = outline.map(([x, z], i) => {
    const cornerPoint = new T.Vector2(x, -z);
    const approach = (other) => {
      const v = new T.Vector2(other[0], -other[1]).sub(cornerPoint);
      const distance = Math.min(corner, v.length() * 0.40);
      return v.normalize().multiplyScalar(distance).add(cornerPoint);
    };
    return {
      p: cornerPoint, a: approach(outline[(i + outline.length - 1) % outline.length]),
      b: approach(outline[(i + 1) % outline.length])
    };
  });
  shape.moveTo(corners[0].a.x, corners[0].a.y);
  for (const { p, a, b } of corners) {
    shape.lineTo(a.x, a.y);
    shape.quadraticCurveTo(p.x, p.y, b.x, b.y);
  }
  shape.closePath();
  const geo = new T.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: bevel > 0, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: 2, steps: 1, curveSegments: 3
  });
  parts.add(geo.rotateX(-Math.PI / 2).translate(0, y, 0), color, surface);
}

function rectangle(x, z, width, length) {
  return [
    [x - width / 2, z - length / 2], [x + width / 2, z - length / 2],
    [x + width / 2, z + length / 2], [x - width / 2, z + length / 2]
  ];
}

const surveyStations = [
  // z, half breadth, rubbing-strake height, deck height, keel height
  [-1.79, 0.009, 0.230, 0.245, 0.183],
  [-1.66, 0.098, 0.234, 0.295, -0.017],
  [-1.44, 0.175, 0.242, 0.370, -0.213],
  [-1.09, 0.240, 0.247, 0.437, -0.263],
  [-0.64, 0.279, 0.249, 0.468, -0.282],
  [ 0.06, 0.286, 0.245, 0.470, -0.290],
  [ 0.94, 0.283, 0.234, 0.466, -0.279],
  [ 1.47, 0.275, 0.227, 0.455, -0.265],
  [ 1.61, 0.244, 0.225, 0.432, -0.247],
  [ 1.69, 0.197, 0.221, 0.406, -0.222]
];

function surveyPontoon(parts, cx, livery) {
  const rings = surveyStations.map(([z, half, strake, deck, keel]) => {
    const hardChine = keel + 0.47 * (strake - keel);
    const fenderTop = strake + 0.40 * (deck - strake);
    return [
      [0.75,deck],[-0.75,deck],[-0.90,fenderTop],[-1,strake],[-0.92,hardChine],
      [-0.75,keel + 0.02 * (strake - keel)],[-0.48,keel],
      [0.48,keel],[0.75,keel + 0.02 * (strake - keel)],[0.92,hardChine],[1,strake],[0.90,fenderTop]
    ].map(([u, y]) => [cx + u * half, y, z]);
  });
  loft(parts, rings, [
    coat.ivory, coat.pearl, livery, coat.navy, coat.navy, coat.navyShade,
    coat.navyShade, coat.navyShade, coat.navy, coat.navy, livery, coat.pearl
  ], coat.navy);
  const side = (sign) => surveyStations.map(([z, w, h]) => [cx + sign * w, h, z]);
  const rail = [...side(1), [cx, 0.22, 1.705], ...side(-1).reverse(), [cx, 0.23, -1.8]];
  parts.tube(rail, 0.021, livery, 'paint', true);
  // Fine waterline pinstriping on the outside face of the two floats.
  const stripe = surveyStations.slice(2, -1).map(([z, w, s, , k]) =>
    [cx + Math.sign(cx) * w * 0.935, k + (s - k) * 0.51, z]
  );
  parts.tube(stripe, 0.005, coat.whiteShade, 'matte');
}

function cleat(parts, x, y, z) {
  for (const sign of [-1, 1]) {
    parts.rod([x, y, z + sign * 0.037], [x, y + 0.049, z + sign * 0.06], 0.012, coat.metal);
  }
  parts.rod([x, y + 0.049, z - 0.113], [x, y + 0.049, z + 0.113], 0.015, coat.metal);
}

function sternThruster(parts, cx) {
  const cy = -0.086;
  parts.hoop([cx, cy, 1.738], 0.119, 0.027, coat.black, 'matte', 'z');
  parts.hoop([cx, cy, 1.776], 0.119, 0.021, coat.graphite, 'matte', 'z');
  parts.cylinder([cx, cy, 1.741], 0.030, 0.030, 0.088, coat.steel, 'metal', 'z', 14);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const b = a + 0.32;
    parts.rod(
      [cx + 0.022 * Math.cos(a), cy + 0.022 * Math.sin(a), 1.749],
      [cx + 0.082 * Math.cos(b), cy + 0.082 * Math.sin(b), 1.730],
      0.015, '#908a6a', 'metal', 6
    );
  }
}

function cameraGantry(parts) {
  for (const sign of [-1, 1]) {
    const footX = sign * 0.57;
    const topX = sign * 0.32;
    for (const z of [0.13, 0.69]) {
      parts.box([footX, 0.508, z], [0.135, 0.035, 0.135], coat.black, 'matte');
      parts.rod([footX, 0.522, z], [topX, 1.383, 0.38], 0.034, coat.graphite, 'matte', 14);
    }
    parts.rod([sign * 0.46, 0.90, 0.244], [sign * 0.46, 0.90, 0.553], 0.019, coat.graphite, 'matte');
    parts.cylinder([sign * 0.356, 1.43, 0.38], 0.013, 0.022, 0.062, coat.black, 'matte');
    parts.rod([sign * 0.356, 1.452, 0.38], [sign * 0.356, 1.68, 0.38], 0.006, coat.black, 'matte', 6);
  }
  parts.rod([-0.39, 1.390, 0.38], [0.39, 1.390, 0.38], 0.040, coat.graphite, 'matte');
  parts.cylinder([0, 1.455, 0.38], 0.043, 0.045, 0.10, coat.black, 'matte');
  parts.cylinder([0, 1.530, 0.38], 0.107, 0.082, 0.067, coat.whiteShade);
  parts.ellipsoid([0, 1.566, 0.38], [0.106, 0.038, 0.106], coat.ivory);
  parts.cylinder([0, 1.336, 0.353], 0.064, 0.060, 0.054, coat.whiteShade);
  parts.box([0, 1.308, 0.337], [0.228, 0.041, 0.108], coat.pearl);
  for (const s of [-1, 1]) {
    parts.box([s * 0.097, 1.263, 0.336], [0.027, 0.104, 0.100], coat.pearl);
    parts.cylinder([s * 0.103, 1.24, 0.333], 0.027, 0.027, 0.022, coat.steel, 'metal', 'x');
  }
  parts.ellipsoid([0, 1.234, 0.321], [0.092, 0.092, 0.104], coat.ivory);
  parts.cylinder([0, 1.236, 0.233], 0.069, 0.061, 0.052, coat.black, 'matte', 'z');
  parts.ellipsoid([0, 1.236, 0.201], [0.050, 0.050, 0.010], coat.glass, 'glass');
  parts.ellipsoid([-0.012, 1.249, 0.191], [0.011, 0.008, 0.002], '#9bb9bf', 'glass');
}

function aftEquipment(T, parts, livery) {
  // Open stern railing, cable reel to port and sealed sampling case to starboard.
  for (const s of [-1, 1]) {
    parts.tube([
      [s * 0.785, 0.466, 1.02], [s * 0.79, 0.632, 1.045],
      [s * 0.79, 0.64, 1.46], [s * 0.745, 0.64, 1.53],
      [s * 0.47, 0.64, 1.535], [s * 0.442, 0.48, 1.535]
    ], 0.014, coat.metal, 'metal');
  }
  const reelX = -0.59;
  for (const s of [-1, 1]) {
    parts.box([reelX + s * 0.15, 0.585, 1.263], [0.023, 0.215, 0.23], coat.graphite, 'matte');
    parts.cylinder([reelX + s * 0.135, 0.61, 1.263], 0.125, 0.125, 0.018, coat.black, 'matte', 'x');
  }
  parts.cylinder([reelX, 0.61, 1.263], 0.094, 0.094, 0.253, coat.amber, 'matte', 'x');
  for (let i = -4; i <= 4; i++) {
    parts.hoop([reelX + i * 0.024, 0.61, 1.263], 0.092, 0.005, '#e4a020', 'matte', 'x');
  }
  const cx = 0.595;
  plate(T, parts, rectangle(cx, 1.25, 0.34, 0.38), 0.477, 0.148, '#a5afb1', 'matte');
  plate(T, parts, rectangle(cx, 1.25, 0.35, 0.39), 0.625, 0.03, livery, 'matte');
  for (const s of [-1, 1]) {
    parts.box([cx + s * 0.100, 0.659, 1.25], [0.026, 0.010, 0.38], coat.black, 'matte');
    parts.box([cx + s * 0.100, 0.566, 1.446], [0.029, 0.13, 0.015], coat.black, 'matte');
  }
}

function instrumentCover(parts) {
  const plan = [
    [-0.325,-0.394],[-0.245,-0.492],[0.245,-0.492],[0.325,-0.394],
    [0.358,0.208],[0.279,0.299],[-0.279,0.299],[-0.358,0.208]
  ];
  const levels = [
    [0.490,0.985,0.985], [0.511,1.000,1.000], [0.580,0.982,0.982],
    [0.689,0.818,0.825], [0.704,0.787,0.803]
  ].map(([y, sx, sz]) => plan.map(([x,z]) => [x * sx, y, z * sz]));
  for (let j = 1; j < levels.length; j++) {
    const vertices = [];
    const triangles = [];
    for (let i = 0; i < plan.length; i++) {
      const next = (i + 1) % plan.length;
      const offset = vertices.length / 3;
      vertices.push(...levels[j - 1][i], ...levels[j][i], ...levels[j][next], ...levels[j - 1][next]);
      triangles.push(offset,offset+1,offset+2,offset,offset+2,offset+3);
    }
    parts.surfaceMesh(vertices,triangles,j < 3 ? coat.pearl : coat.ivory);
  }
  const cap = levels[levels.length - 1];
  const triangles = [];
  for (let i = 0; i < cap.length; i++) triangles.push(0,1+(i+1)%cap.length,1+i);
  parts.surfaceMesh([0,0.704,-0.08,...cap.flat()],triangles,coat.ivory);
}

// Bake the flat call signs on the instrument hatch and aft deck into the existing draw batches.
function deckMarkings(T, parts, id, livery) {
  const outlines = id === 'A' ? [
    [[-.46,-.5],[-.13,.5],[.13,.5],[.46,-.5],[.24,-.5],[.17,-.27],[-.17,-.27],[-.24,-.5]],
    [[-.11,-.06],[.11,-.06],[0,.28]]
  ] : [
    [[-.37,-.5],[-.37,.5],[.17,.5],[.36,.34],[.36,.12],[.24,.02],[.39,-.10],[.39,-.34],[.20,-.5]],
    [[-.16,.10],[.12,.10],[.17,.16],[.17,.26],[.10,.32],[-.16,.32]],
    [[-.16,-.32],[.13,-.32],[.19,-.26],[.19,-.16],[.12,-.09],[-.16,-.09]]
  ];
  const points = outline => outline.map(([x, y]) => new T.Vector2(x, y));
  const shape = new T.Shape(points(outlines[0]));
  shape.holes = outlines.slice(1).map(hole => new T.Path(points(hole)));
  const glyph = new T.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  parts.add(glyph.clone().scale(.37, 1, .35).translate(0, .730, -.087), coat.navyShade, 'matte');
  parts.add(glyph.scale(.39, 1, .39).translate(0, .495, 1.20), livery, 'matte');
}

function buildSurvey(T, id) {
  const livery = surveyLiveries[id];
  const parts = makeParts(T);
  for (const s of [-1, 1]) {
    const x = 0.615 * s;
    surveyPontoon(parts, x, livery);
    sternThruster(parts, x);
    cleat(parts, x, 0.393, -1.253);
    const hatch = rectangle(x, -0.883, 0.232, 0.320);
    plate(T, parts, hatch, 0.456, 0.008, '#b6c4c7', 'metal', 0.024, 0.003);
    for (const u of [-1, 1]) {
      for (const v of [-1, 1]) {
        parts.cylinder([x + u * 0.09, 0.470, -0.883 + v * 0.123], 0.008, 0.008, 0.006, coat.steel, 'metal', 'y', 6);
      }
    }
  }
  const bridge = [
    [-0.66,-0.843],[-0.51,-0.848],[-0.39,-0.64],[0.39,-0.64],[0.51,-0.848],[0.66,-0.843],
    [0.74,0.19],[0.72,1.25],[0.58,1.59],[0.37,1.59],[0.30,1.51],[-0.30,1.51],
    [-0.37,1.59],[-0.58,1.59],[-0.72,1.25],[-0.74,0.19]
  ];
  plate(T, parts, bridge, 0.380, 0.098, coat.graphite, 'tread', 0.050, 0.013);
  for (const s of [-1, 1]) {
    plate(T, parts, rectangle(s * 0.455, -0.43, 0.162, 0.31), 0.487, 0.007, coat.deck, 'matte', 0.022, 0.002);
    parts.box([s * 0.565,0.492,0.984],[0.20,0.003,0.006],coat.black,'matte');
    for (const z of [-0.53,0.83,1.40]) {
      parts.cylinder([s * 0.52,0.493,z],0.012,0.012,0.004,coat.steel,'metal','y',8);
    }
  }
  instrumentCover(parts);
  plate(T, parts, rectangle(0,-0.087,0.482,0.518), 0.704, 0.012, coat.black, 'matte', 0.059, 0.004);
  plate(T, parts, rectangle(0,-0.087,0.458,0.494), 0.717, 0.007, livery, 'matte', 0.05, 0.003);
  for (const s of [-1,1]) {
    parts.box([s * 0.144,0.726,0.145],[0.064,0.012,0.023],coat.black,'matte');
  }
  cameraGantry(parts);
  aftEquipment(T, parts, livery);
  deckMarkings(T, parts, id, livery);
  const group = parts.build('survey-catamaran');
  group.userData.boatId = id;
  const camera = new T.Object3D();
  camera.name = 'inspection-camera';
  camera.position.set(0, 1.236, 0.178);
  group.add(camera);
  return group;
}

function buildBuoy(T, kind) {
  const parts = makeParts(T);
  const special = kind === 'yellow';
  const tint = special ? '#f4bb24' : kind === 'green' ? '#299968' : '#d9543c';
  const shade = special ? '#d39018' : kind === 'green' ? '#27795d' : '#a94135';
  const body = (profile, color, surface = 'paint') => {
    const points = profile.map(([r,y]) => new T.Vector2(r,y));
    parts.add(new T.LatheGeometry(points, 28), color, surface);
  };
  body([[0,-0.26],[0.23,-0.23],[0.42,-0.08],[0.465,0.10],[0.46,0.30],
        [0.435,0.39],[0.31,0.48],[0.13,0.502],[0,0.502]], tint);
  parts.hoop([0,0.093,0], 0.459, 0.022, shade, 'matte');
  parts.hoop([0,0.345,0], 0.449, 0.014, shade, 'paint');
  for (let j = 0; j < 4; j++) {
    const a = Math.PI * 0.5 * j + Math.PI * 0.25;
    const x = Math.cos(a);
    const z = Math.sin(a);
    parts.rod([x * 0.32,0.46,z * 0.32],[x * 0.32,0.603,z * 0.32],0.014,shade,'paint',8);
    if (special) {
      const b = a + Math.PI / 2;
      parts.rod([x * 0.235,0.474,z * 0.235],[x * 0.137,1.488,z * 0.137],0.030,tint,'paint');
      parts.rod([x * 0.22,0.58,z * 0.22],[Math.cos(b) * 0.165,1.12,Math.sin(b) * 0.165],0.014,shade,'paint',8);
      parts.rod([x * 0.177,1.04,z * 0.177],[Math.cos(b) * 0.142,1.46,Math.sin(b) * 0.142],0.013,tint,'paint',8);
    }
  }
  parts.hoop([0,0.606,0],0.321,0.015,tint,'paint');
  if (special) {
    parts.cylinder([0,1.456,0],0.197,0.196,0.047,tint,'paint');
    parts.cylinder([0,1.501,0],0.091,0.097,0.046,coat.graphite,'matte');
    parts.cylinder([0,1.574,0],0.066,0.082,0.112,'#ffe5a0','light');
    for (const y of [1.532,1.563,1.595]) parts.hoop([0,y,0],0.079,0.005,'#cca459','paint');
    parts.cylinder([0,1.643,0],0.085,0.093,0.028,shade);
    parts.rod([0,1.65,0],[0,1.897,0],0.022,tint,'paint');
    // Upright yellow X topmark; two planes keep its silhouette visible around the mark.
    for (const axis of [[1,0],[0,1]]) {
      const [x,z] = axis;
      for (const sign of [-1,1]) {
        parts.rod([-sign * x * 0.158,1.814,-sign * z * 0.158],
                  [sign * x * 0.158,2.122,sign * z * 0.158],0.028,tint,'paint',8);
      }
    }
  } else {
    parts.cylinder([0,0.761,0],0.157,0.232,0.52,tint);
    parts.cylinder([0,0.849,0],0.185,0.193,0.058,'#d8ded4','matte');
    parts.cylinder([0,1.043,0],0.079,0.083,0.064,coat.graphite,'matte');
    parts.cylinder([0,1.11,0],0.055,0.059,0.081,kind === 'red' ? '#ff8473' : '#81e2ae','light');
    parts.rod([0,1.15,0],[0,1.28,0],0.018,tint,'paint');
    if (kind === 'green') parts.cylinder([0,1.36,0],0.0,0.152,0.238,tint);
    else parts.cylinder([0,1.355,0],0.13,0.13,0.20,tint);
  }
  return parts.build('navigation-buoy-' + kind);
}

function buildService(T) {
  const parts = makeParts(T);
  const teal = '#227d80';
  const darkTeal = '#1e535e';
  const deck = '#637b7b';
  const station = [
    [-1.55,0.018,0.41,0.13],[-1.36,0.28,0.40,-0.09],[-1.04,0.51,0.36,-0.20],
    [-0.52,0.60,0.34,-0.23],[0.69,0.60,0.34,-0.23],[1.36,0.55,0.34,-0.19],[1.48,0.50,0.32,-0.18]
  ];
  const rings = station.map(([z,w,top,keel]) => [
    [w,top,z],[-w,top,z],[-w * 0.978,top - 0.073,z],[-w * 0.88,0.0,z],[-w * 0.46,keel,z],
    [w * 0.46,keel,z],[w * 0.88,0.0,z],[w * 0.978,top - 0.073,z]
  ]);
  loft(parts, rings, [deck,coat.pearl,teal,darkTeal,darkTeal,darkTeal,teal,coat.pearl],darkTeal);
  for (const s of [-1,1]) {
    parts.tube(station.map(([z,w,h]) => [s * w,h - 0.050,z]),0.022,coat.rubber,'matte');
  }
  plate(T,parts,rectangle(0,0.48,0.78,0.89),0.35,0.47,coat.pearl,'paint',0.06,0.025);
  for (const s of [-1,1]) {
    parts.box([s * 0.417,0.682,0.398],[0.013,0.195,0.380],coat.glass,'glass');
    parts.box([s * 0.417,0.682,0.726],[0.013,0.195,0.200],coat.glass,'glass');
  }
  parts.box([0,0.682,0.006],[0.649,0.192,0.016],coat.glass,'glass');
  parts.box([0,0.682,0.954],[0.456,0.176,0.015],coat.glass,'glass');
  plate(T,parts,rectangle(0,0.475,0.94,1.055),0.833,0.052,teal,'paint',0.061,0.012);
  parts.cylinder([0,0.931,0.65],0.061,0.074,0.070,'#f2b445','light');
  parts.rod([0.28,0.90,0.74],[0.26,1.211,0.77],0.008,coat.graphite,'matte',7);
  // Perforated collection basket on the working deck.
  plate(T,parts,rectangle(0,-0.69,0.77,0.74),0.348,0.055,'#74878a','metal',0.052,0.009);
  for (const s of [-1,1]) {
    for (let i=0; i<6; i++) {
      const f = i / 5;
      parts.rod([s * 0.378,0.405,-1.035+0.69*f],[s * 0.401,0.588,-1.046+0.706*f],0.011,coat.steel,'metal',6);
      parts.rod([-0.367+0.734*f,0.405,-0.688+s*0.355],
                [-0.39+0.78*f,0.588,-0.688+s*0.367],0.010,coat.steel,'metal',6);
    }
    parts.rod([s*0.4,0.592,-1.055],[s*0.4,0.592,-0.321],0.018,coat.metal);
    parts.rod([-0.40,0.592,-0.688+s*0.367],[0.40,0.592,-0.688+s*0.367],0.018,coat.metal);
    cleat(parts,s*0.43,0.343,1.12);
  }
  parts.box([0,0.214,1.526],[0.186,0.361,0.128],coat.graphite,'matte');
  return parts.build('harbor-service-boat');
}

function instance(T, key, build) {
  const cache = library(T).models;
  if (!cache.has(key)) cache.set(key, build(T));
  return cache.get(key).clone(true);
}

export function makeVessel(THREE, id = 'A') {
  if (id !== 'A' && id !== 'B') throw new RangeError('Unknown survey vessel: ' + id);
  return instance(THREE, 'survey-' + id, (T) => buildSurvey(T, id));
}

export function makeBuoy(THREE, kind = 'yellow') {
  if (!['yellow','red','green'].includes(kind)) throw new RangeError('Unknown buoy type: ' + kind);
  return instance(THREE, 'buoy-' + kind, (T) => buildBuoy(T, kind));
}

export function makeServiceBoat(THREE) {
  return instance(THREE, 'service', buildService);
}
