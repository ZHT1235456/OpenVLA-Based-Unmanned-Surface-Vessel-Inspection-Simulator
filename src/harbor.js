const referenceUrl = new URL('../design/assets/harbor.png', import.meta.url).href
const environmentUrl = new URL('../design/assets/environment.png', import.meta.url).href
const TAU = 2 * Math.PI

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

function surfaceTexture(THREE, wood) {
  const size = 128
  const pixels = new Uint8Array(size * size * 4)
  const random = seededRandom(wood ? 1203 : 489)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const curl = 0.32 * Math.sin(v * TAU) + 0.15 * Math.sin(3 * TAU * v)
      const grain = wood
        ? 0.9 + 0.052 * Math.sin(TAU * 20 * u + curl) + 0.035 * Math.sin(TAU * 39 * u + 3 * curl)
        : 0.91 + 0.032 * Math.sin(TAU * (3 * u + 5 * v) + Math.sin(TAU * 4 * v))
      const level = Math.min(255, Math.floor(255 * (grain + 0.12 * (random() - 0.5))))
      const i = 4 * (y * size + x)
      pixels[i] = pixels[i + 1] = pixels[i + 2] = level
      pixels[i + 3] = 255
    }
  }
  const tex = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.needsUpdate = true
  return tex
}

// A periodic slope field for capillary ripples. Mip filtering removes distant sparkle aliasing.
function waveSlopeTexture(THREE) {
  const size = 192
  const random = seededRandom(91045)
  const spectrum = []
  for (let i = 0; i < 33; i++) {
    const kx = 1 + Math.floor(random() * 10)
    const ky = Math.floor((random() - 0.39) * 12)
    const length = Math.hypot(kx, ky)
    const amp = (0.27 + random() * 0.73) / Math.sqrt(length)
    spectrum.push([kx, ky, TAU * random(), (amp * kx) / length, (amp * ky) / length])
  }
  const data = new Uint8Array(size * size * 4)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let sx = 0,
        sz = 0
      for (const [kx, ky, phase, ax, az] of spectrum) {
        const c = Math.cos((TAU * (kx * i + ky * j)) / size + phase)
        sx += c * ax
        sz += c * az
      }
      const o = 4 * (j * size + i)
      data[o] = Math.round((0.5 + 0.49 * Math.tanh(sx * 0.75)) * 255)
      data[o + 1] = Math.round((0.5 + 0.49 * Math.tanh(sz * 0.9)) * 255)
      data[o + 2] = 220
      data[o + 3] = 255
    }
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

const skyLookup = `
uniform sampler2D skyPhoto;
uniform float hasPhoto;
vec3 harborSky(vec3 ray, float reflectionBlur) {
  ray = normalize(ray);
  float elevation = asin(clamp(ray.y, -1.0, 1.0));
  // This photo covers a sector, not a full panorama. Fold two complete periods
  // around the horizon with rounded ends, using the direction itself at the meridian.
  vec2 horizon = ray.xz / max(length(ray.xz), 0.0001);
  float twiceHeading = -2.0 * horizon.x * horizon.y;
  const float shoulder = 0.99;
  float u = 0.5 + 0.5 * asin(clamp(shoulder * twiceHeading, -shoulder, shoulder)) / asin(shoulder);
  float rawV = max(0.642 + 0.80 * elevation, 0.59);
  float v = min(rawV, .84) + .155 * (1.0 - exp(-max(0.0, rawV-.84)/.155));
  vec2 uv = vec2(0.065 + 0.797 * u, v);
  vec3 plate = reflectionBlur > 0.0 ? textureLod(skyPhoto, uv, reflectionBlur).rgb
                                   : texture2D(skyPhoto, uv).rgb;
  vec3 zenith = vec3(0.19, 0.43, 0.69);
  plate = mix(plate, zenith, smoothstep(0.33, 0.64, elevation));
  vec3 clearSky = mix(vec3(0.65, 0.80, 0.88), zenith, smoothstep(0.0, 0.9, ray.y));
  return mix(clearSky, plate, hasPhoto);
}
`

function addSkyAndWater(THREE, root, layout, resources) {
  const loaded = { value: 0 }
  let texture
  if (typeof document !== 'undefined') {
    texture = new THREE.TextureLoader().load(referenceUrl, () => {
      loaded.value = 1
    })
    texture.colorSpace = THREE.SRGBColorSpace
  } else {
    texture = new THREE.DataTexture(new Uint8Array([155, 192, 222, 255]), 1, 1)
    texture.needsUpdate = true
  }
  const ripple = waveSlopeTexture(THREE)
  resources.textures.push(texture, ripple)
  const skyGeometry = new THREE.SphereGeometry(1, 32, 18)
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: { skyPhoto: { value: texture }, hasPhoto: loaded },
    vertexShader: `
      varying vec3 sight;
      void main() {
        sight = position;
        vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
        gl_Position = clip.xyww;
      }`,
    fragmentShader:
      skyLookup +
      `
      varying vec3 sight;
      void main() {
        gl_FragColor = vec4(harborSky(sight, 0.0), 1.0);
        #include <colorspace_fragment>
      }`,
  })
  const sky = new THREE.Mesh(skyGeometry, skyMaterial)
  sky.name = '远岸与雨后云层'
  sky.frustumCulled = false
  sky.renderOrder = -100
  root.add(sky)

  const waterGeometry = new THREE.PlaneGeometry(660, 660, 125, 125)
  waterGeometry.rotateX(-Math.PI / 2)
  const uniforms = {
    skyPhoto: { value: texture },
    hasPhoto: loaded,
    slopes: { value: ripple },
    seconds: { value: 0 },
    breeze: { value: 0.76 },
    pierEnd: {
      value: new THREE.Vector2(layout.pier.x + Math.sign(layout.pier.x || -1) * 6.55, layout.pier.z),
    },
    wallEnd: {
      value: new THREE.Vector2(layout.wall.x + Math.sign(layout.wall.x || 1) * 7.6, layout.wall.z),
    },
  }
  const waterMaterial = new THREE.ShaderMaterial({
    uniforms,
    toneMapped: false,
    vertexShader: `
      uniform float seconds;
      uniform float breeze;
      varying vec3 vWorld;
      void main() {
        vec3 p = position;
        p.y += breeze * (0.052 * sin(dot(p.xz, vec2(.34,.51)) - seconds * .85)
                     + 0.027 * sin(dot(p.xz, vec2(.57,-.32)) + seconds * .91));
        vec4 wp = modelMatrix * vec4(p,1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader:
      skyLookup +
      `
      uniform sampler2D slopes;
      uniform float seconds;
      uniform float breeze;
      uniform vec2 pierEnd;
      uniform vec2 wallEnd;
      varying vec3 vWorld;
      float nearbyBank(float z) {
        return smoothstep(15.0, 44.0, abs(z));
      }
      float stripDistance(vec2 p, vec2 endpoint, float halfWidth) {
        float outerX = 45.0 * sign(endpoint.x);
        vec2 centre = vec2((outerX + endpoint.x) * 0.5, endpoint.y);
        return length(max(abs(p - centre) - vec2(abs(outerX-endpoint.x)*.5, halfWidth), 0.0));
      }
      vec3 photographedWater(vec2 coordinates) {
        vec2 tile=1.0-abs(mod(coordinates,2.0)-1.0);
        return texture2D(skyPhoto,vec2(.41,.045)+vec2(.28,.18)*tile).rgb;
      }
      void main() {
        vec2 p = vWorld.xz;
        vec3 view = normalize(cameraPosition - vWorld);
        vec2 q = vec2(.93*p.x-.36*p.y, .36*p.x+.93*p.y);
        vec2 fine = texture2D(slopes, q/vec2(2.35,1.65)+vec2(.032,-.026)*seconds).rg * 2.0 - 1.0;
        vec2 mid  = texture2D(slopes, vec2(-.82*q.y,.79*q.x)/5.65-vec2(.016,.012)*seconds).rg*2.0-1.0;
        vec2 broad= texture2D(slopes,p/15.8+vec2(.006,-.010)*seconds).rg*2.0-1.0;
        float farFade = smoothstep(32.0, 185.0, length(cameraPosition - vWorld));
        vec2 slope = (fine*(.091-.065*farFade) + mid*.087 + broad*.080) * breeze;
        slope += .045*breeze*vec2(cos(.4*p.x+.58*p.y-seconds),sin(.52*p.x-.36*p.y+.63*seconds));
        vec3 n = normalize(vec3(-slope.x,1.0,-slope.y));
        vec3 reflected = reflect(-view,n);
        reflected.y=max(.006,reflected.y);
        vec3 skyMean=mix(vec3(.24,.38,.46),vec3(.44,.62,.73),smoothstep(.02,.49,reflected.y));
        vec3 reflection = mix(skyMean,harborSky(reflected, 4.4),.36);
        float cosi = max(0.0,dot(n,view));
        float fresnel = .115+.50*pow(1.0-cosi,3.3);
        float bank = min(stripDistance(p,wallEnd,2.05),stripDistance(p,pierEnd,1.18));
        float shade = exp(-bank/2.0);
        float mottling = (broad.x+mid.y)*.5;
        vec3 body = mix(vec3(.016,.104,.129),vec3(.047,.217,.240),
                        clamp(.51+.22*mottling+.25*nearbyBank(p.y),0.0,1.0));
        body *= .95+.11*fine.x+.10*mid.y;
        vec3 waterPlate = mix(photographedWater(p*vec2(.081,.126)+vec2(.009,.014)*seconds+.05*mid),
          photographedWater(vec2(p.x*.060-p.y*.021,p.y*.094+p.x*.016)-vec2(.006,.009)*seconds),
          .36);
        body=mix(body,waterPlate*.91,.65*hasPhoto);
        vec3 color = mix(body,reflection,fresnel);
        color *= 1.0-.34*shade;
        vec3 sunDir = normalize(vec3(-.58,.48,-.66));
        vec3 halfVector = normalize(sunDir+view);
        float ndh=clamp(dot(n,halfVector),0.0,1.0);
        float light = pow(ndh,340.0)*.66+pow(ndh,68.0)*.072;
        color += vec3(.98,.91,.71)*light;
        float edge=stripDistance(p+vec2(.09*mid.x,.18*fine.y),wallEnd,2.20);
        color += vec3(.27,.37,.36) * exp(-edge*2.9)*pow(max(.0,.52+.38*fine.x+.25*mid.y),4.0);
        gl_FragColor=vec4(color,1.0);
        #include <colorspace_fragment>
      }`,
  })
  const water = new THREE.Mesh(waterGeometry, waterMaterial)
  water.name = '港池风纹水面'
  root.add(water)
  resources.materials.push(skyMaterial, waterMaterial)
  resources.geometries.push(skyGeometry, waterGeometry)
  return uniforms
}

function irregularStone(THREE, variant) {
  const shape = new THREE.DodecahedronGeometry(1, 0)
  const pos = shape.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i)
    const k = 1 + 0.14 * Math.sin(4.31 * x + 5.72 * y - 0.92 * z + 2.13 * variant)
    pos.setXYZ(i, x * k + 0.1 * y, y * k + 0.13 * x, z * k)
  }
  shape.computeVertexNormals()
  return shape
}

function pineCanopy(THREE) {
  const profile = [
    [0.1, 0.15],
    [0.15, 0.98],
    [0.29, 0.59],
    [0.31, 0.87],
    [0.46, 0.44],
    [0.48, 0.73],
    [0.62, 0.32],
    [0.63, 0.55],
    [0.76, 0.18],
    [0.77, 0.35],
    [1, 0.018],
  ]
  const rings = 18
  const positions = [],
    colors = [],
    indices = []
  for (let row = 0; row < profile.length; row++) {
    const [h, r] = profile[row]
    for (let j = 0; j < rings; j++) {
      const angle = (j * TAU) / rings + 0.09 * Math.sin(1.9 * row)
      const wobble = 0.76 + 0.15 * Math.sin(5 * angle + 0.37 * row) + 0.1 * Math.cos(3 * angle + row * 0.19)
      positions.push(
        r * wobble * Math.cos(angle) + 0.06 * h,
        h + 0.027 * Math.sin(7 * angle + row) * (1 - h),
        r * wobble * Math.sin(angle) - 0.04 * h,
      )
      const value = 0.68 + 0.24 * h + 0.07 * Math.sin(angle - 1.0) + 0.055 * Math.cos(7 * angle + row)
      colors.push(value, value * 1.025, value)
      if (row < profile.length - 1) {
        const a = row * rings + j,
          b = row * rings + ((j + 1) % rings),
          c = a + rings,
          d = b + rings
        indices.push(a, c, b, b, c, d)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function gable(THREE) {
  // A unit triangular prism. The roof ridge runs down local Z.
  const positions = [
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0, 0.5, -0.5, -0.5,
    -0.5, -0.5, -0.5, -0.5, 0.5, 0, 0.5, 0.5, -0.5, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0.5,
    -0.5, 0.5, 0.5, -0.5, -0.5, 0, 0.5, 0.5, 0.5, -0.5, -0.5, 0, 0.5, -0.5,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

// Batching identical parts keeps the piles, tiles, rocks and vegetation inexpensive to draw.
class Parts {
  constructor(THREE, parent, library, materials, name, semantic) {
    this.three = THREE
    this.library = library
    this.materials = materials
    this.buckets = new Map()
    this.group = new THREE.Group()
    this.group.name = name
    this.group.userData.landmark = semantic
    parent.add(this.group)
    this.frame = new THREE.Matrix4()
    this.pose = new THREE.Object3D()
  }
  at(x, y, z, yaw, build) {
    const previous = this.frame
    const next = new this.three.Matrix4().makeRotationY(yaw)
    next.setPosition(x, y, z)
    this.frame = previous.clone().multiply(next)
    try {
      build()
    } finally {
      this.frame = previous
    }
  }
  part(kind, material, color, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0) {
    const tag = kind + '/' + material
    if (!this.buckets.has(tag)) this.buckets.set(tag, { kind, material, matrices: [], colors: [] })
    const bucket = this.buckets.get(tag)
    this.pose.position.set(x, y, z)
    this.pose.scale.set(w, h, d)
    this.pose.rotation.set(rx, ry, rz)
    this.pose.updateMatrix()
    bucket.matrices.push(this.frame.clone().multiply(this.pose.matrix))
    bucket.colors.push(color)
  }
  box(mat, c, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0) {
    this.part('box', mat, c, x, y, z, w, h, d, rx, ry, rz)
  }
  post(mat, c, x, y, z, r, h) {
    this.part('round', mat, c, x, y, z, r, h, r)
  }
  finish() {
    const THREE = this.three
    const tint = new THREE.Color()
    for (const { kind, material, matrices, colors } of this.buckets.values()) {
      const mesh = new THREE.InstancedMesh(this.library[kind], this.materials[material], matrices.length)
      mesh.name = this.group.name + ' · ' + kind + '/' + material
      mesh.userData.landmark = this.group.userData.landmark
      for (let i = 0; i < matrices.length; i++) {
        mesh.setMatrixAt(i, matrices[i])
        mesh.setColorAt(i, tint.setHex(colors[i]))
      }
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
      this.group.add(mesh)
    }
    this.buckets.clear()
  }
}

function addTire(b, x, y, z, scale = 1) {
  b.part('tire', 'rubber', 0x2e3435, x, y, z, scale, scale, scale)
  for (const side of [-1, 1]) {
    b.box(
      'hardware',
      0x6c6558,
      x + side * 0.15 * scale,
      y + 0.37 * scale,
      z,
      0.032 * scale,
      0.5 * scale,
      0.032 * scale,
      0,
      0,
      -side * 0.27,
    )
  }
}

function bollard(b, x, y, z, s = 1) {
  b.part('round', 'hardware', 0x454942, x, y + 0.035 * s, z, 0.28 * s, 0.07 * s, 0.24 * s)
  b.post('hardware', 0x383e3e, x, y + 0.21 * s, z, 0.115 * s, 0.35 * s)
  b.part('round', 'hardware', 0x535858, x, y + 0.39 * s, z, 0.24 * s, 0.095 * s, 0.16 * s)
}

function addPier(b, site, random) {
  const side = Math.sign(site.x) || -1
  const tip = site.x + side * 6.5,
    edge = side * 45
  const length = Math.abs(edge - tip),
    cx = (edge + tip) * 0.5,
    z = site.z
  const width = 2.75,
    deck = 0.79
  const woods = [0xb08b65, 0xb7916c, 0x997956, 0xb99670, 0xa68360, 0xb3916c]
  const boards = Math.ceil(length / 0.28)
  for (let i = 0; i < boards; i++) {
    const x = tip + (side * length * (i + 0.5)) / boards
    b.box(
      'wood',
      woods[Math.floor(random() * woods.length)],
      x,
      deck,
      z,
      length / boards - 0.015,
      0.16,
      width,
      0,
      0,
      (random() - 0.5) * 0.004,
    )
  }
  for (const lane of [-1, 1]) {
    b.box('wood', 0x785f46, cx, 0.57, z + lane * 1.11, length, 0.33, 0.22)
    b.box('wood', 0x9a734f, cx, 0.69, z + lane * 1.37, length, 0.24, 0.13)
  }
  const sets = Math.max(3, Math.floor(length / 2.8))
  for (let i = 0; i <= sets; i++) {
    const x = tip + side * (0.23 + ((length - 0.46) * i) / sets)
    for (const lane of [-1, 1]) {
      const postZ = z + lane * 1.1
      b.post('wood', 0x61594b, x, 0.06, postZ, 0.18, 2.05)
      b.post('rough', 0x424e47, x, -0.03, postZ, 0.186, 0.26)
      b.post('wood', 0x9a7857, x, 1.09, postZ, 0.182, 0.13)
      if (i % 2 === 0) addTire(b, x, 0.35, z + lane * 1.48, 0.72)
      if (i % 3 === 1) bollard(b, x, 0.88, z + lane * 0.91, 0.69)
    }
    if (i < sets) {
      const nx = (length - 0.46) / sets
      const braceLen = Math.sqrt(nx * nx + 0.67 * 0.67)
      b.box(
        'wood',
        0x725d44,
        x + side * nx * 0.5,
        0.18,
        z + 1.09,
        braceLen,
        0.12,
        0.14,
        0,
        0,
        side * Math.atan2(0.67, nx),
      )
    }
  }
  b.box('wood', 0x9a7554, tip, 0.62, z, 0.13, 0.32, width)
}

function addBreakwater(b, site, random) {
  const side = Math.sign(site.x) || 1
  const tip = site.x + side * 7.7,
    edge = side * 45
  const length = Math.abs(edge - tip),
    cx = (edge + tip) * 0.5,
    z = site.z
  const stonePalette = [0x747a79, 0x828782, 0x707a77, 0x626c68, 0x8b8b81, 0x68716b, 0x7c7b71]
  const rows = Math.ceil(length / 0.95)
  for (let i = 0; i < rows; i++) {
    for (let j = -2; j <= 2; j++) {
      const off = Math.abs(j)
      const x = tip + (side * (i + 0.4 + random() * 0.42) * length) / rows
      const rz = z + j * 0.92 + (random() - 0.5) * 0.53
      const y = 0.8 - off * 0.36 + (random() - 0.5) * 0.38
      b.part(
        'stone' + ((i + j + 6) % 3),
        'rough',
        stonePalette[Math.floor(random() * stonePalette.length)],
        x,
        y,
        rz,
        0.75 + random() * 0.53,
        0.6 + random() * 0.52,
        0.65 + random() * 0.5,
        random() * 0.58,
        random() * TAU,
        random() * 0.34,
      )
    }
  }
  const blocks = Math.max(3, Math.round(length / 3.1))
  for (let i = 0; i < blocks; i++) {
    const x = tip + side * (((i + 0.5) * length) / blocks)
    b.box('rough', i % 3 === 0 ? 0xa4a391 : 0xb2ae9b, x, 1.18, z, length / blocks - 0.026, 0.71, 1.74)
    b.box('rough', 0xc6c5b5, x, 1.565, z, length / blocks - 0.024, 0.115, 1.91)
  }
  for (let i = 0; i < 5; i++) {
    b.part(
      'stone' + (i % 3),
      'rough',
      stonePalette[i],
      tip - side * (0.22 + random() * 0.42),
      -0.05 + random() * 0.5,
      z + (i - 2) * 0.6,
      0.72 + random() * 0.47,
      0.6 + random() * 0.35,
      0.78,
      random() * 0.3,
      random() * TAU,
      0.18,
    )
  }
  const lx = tip + side * 1.55,
    base = 1.63
  b.post('rough', 0xcecfbf, lx, base + 0.1, z, 0.7, 0.21)
  b.post('paint', 0xe3e5d6, lx, base + 1.14, z, 0.39, 2.03)
  b.post('paint', 0x347f7c, lx, base + 1.22, z, 0.398, 0.52)
  b.post('hardware', 0x496665, lx, base + 2.19, z, 0.6, 0.12)
  b.post('glass', 0xc0e0d5, lx, base + 2.44, z, 0.285, 0.47)
  b.part('roofCone', 'metal', 0x397f7a, lx, base + 2.82, z, 0.45, 0.35, 0.45)
  b.post('hardware', 0x425c59, lx, base + 3.02, z, 0.04, 0.17)
  for (let i = 0; i < 10; i++) {
    const a = (TAU * i) / 10
    b.post('metal', 0xa5aeaa, lx + 0.55 * Math.cos(a), base + 2.4, z + 0.55 * Math.sin(a), 0.022, 0.43)
  }
  for (const dy of [2.47, 2.61]) {
    b.part('ring', 'metal', 0x9aa9a3, lx, base + dy, z, 0.55, 0.55, 0.55, Math.PI / 2)
  }
}

function addBerth(b, site) {
  const x = site.x,
    z = site.z + 6.65
  const width = 7.4,
    depth = 3.75,
    deck = 1.12
  b.box('rough', 0x888e89, x, 0.28, z, width, 1.49, depth)
  b.box('rough', 0xb7b8aa, x, 1.04, z, width + 0.08, 0.17, depth + 0.08)
  b.box('rough', 0x6d7d73, x, -0.05, z - depth * 0.5 - 0.02, width, 0.31, 0.102)
  const endZ = Math.max(36.5, z + 3.2),
    spine = (endZ - z) / 2
  b.box('rough', 0x9fa599, x, 0.45, z + spine, 2.56, 1.24, 2 * spine)
  for (const side of [-1, 1]) {
    bollard(b, x + side * 2.45, deck, z - 1.44, 0.93)
    addTire(b, x + side * 2.28, 0.48, z - depth / 2 - 0.09, 0.88)
  }
  const ladderX = x + 0.48,
    front = z - depth / 2 - 0.12
  for (const s of [-1, 1]) {
    b.post('metal', 0xa8b5ac, ladderX + s * 0.24, 0.55, front, 0.032, 2.16)
    b.box('metal', 0xc1c8bf, ladderX + s * 0.24, 1.6, front + 0.13, 0.055, 0.055, 0.3)
  }
  for (let i = 0; i < 5; i++) b.box('metal', 0x9da9a0, ladderX, 0.03 + i * 0.28, front, 0.48, 0.045, 0.06)
}

function addWarehouse(b, x, z, base, w, h, d, yaw, variant) {
  b.at(x, base, z, yaw, () => {
    const pitch = h * 0.35
    const eave = h + 0.18
    const face = d / 2 + 0.035
    const slope = Math.atan2(pitch, w / 2)
    const halfPanel = Math.hypot(w / 2 + 0.28, pitch + 0.07)
    const roofTints = [0x567b7b, 0x678e87, 0x4f7477, 0x6d8580]
    const wall = variant % 2 ? 0xdad7c5 : 0xdddccf
    const roof = roofTints[variant % roofTints.length]
    b.box('rough', 0x8d9185, 0, 0.1, 0, w + 0.28, 0.26, d + 0.32)
    b.box('paint', wall, 0, h / 2 + 0.18, 0, w, h, d)
    b.part('gable', 'paint', wall, 0, eave + pitch / 2, 0, w, pitch, d)
    for (const side of [-1, 1]) {
      b.box(
        'metal',
        roof,
        side * (w / 4 + 0.07),
        eave + pitch * 0.49,
        0,
        halfPanel,
        0.145,
        d + 0.52,
        0,
        0,
        -side * slope,
      )
      for (let row = 0; row < 6; row++) {
        const where = (row + 0.35) / 6
        b.box(
          'metal',
          0x80968b,
          side * (0.05 + where * w * 0.51),
          eave + pitch * (1 - where) + 0.075,
          0,
          0.047,
          0.057,
          d + 0.5,
          0,
          0,
          -side * slope,
        )
      }
      b.box('metal', 0x677974, side * (w / 2 + 0.16), eave - 0.05, 0, 0.105, 0.14, d + 0.4)
      b.post('metal', 0x86918a, side * (w / 2 + 0.07), eave * 0.49, face - 0.28, 0.049, eave * 0.98)
    }
    b.box('metal', 0x83938b, 0, eave + pitch + 0.05, 0, 0.165, 0.15, d + 0.54)
    // Board seams at the gable, a pair of rolling doors, glazing and lintels.
    const seams = Math.floor(w / 0.43)
    for (let i = 1; i < seams; i++) {
      const dx = (i * w) / seams - w / 2
      const rise = pitch * (1 - Math.abs((2 * dx) / w))
      b.box('paint', 0xc2c2b3, dx, eave + rise * 0.5, face, 0.021, Math.max(0.05, rise), 0.028)
    }
    const doorH = h * 0.66,
      doorW = w * 0.32
    for (const s of [-1, 1]) {
      const doorX = s * w * 0.228,
        baseY = 0.22
      b.box('metal', 0x465757, doorX, baseY + doorH / 2, face, doorW + 0.12, doorH + 0.1, 0.1)
      b.box(
        'metal',
        variant % 2 ? 0x577e78 : 0x5c7f7c,
        doorX,
        baseY + doorH / 2,
        face + 0.058,
        doorW,
        doorH,
        0.054,
      )
      for (let k = 1; k <= 5; k++) {
        b.box('metal', 0x648682, doorX, baseY + (doorH * k) / 6, face + 0.093, doorW - 0.04, 0.022, 0.02)
      }
      if (w > 5) {
        const winY = eave + 0.08,
          ww = w * 0.17,
          wh = h * 0.22
        b.box('paint', 0xc2c2b4, doorX, winY, face, ww + 0.13, wh + 0.13, 0.1)
        b.box('glass', 0x50666a, doorX, winY, face + 0.066, ww, wh, 0.03)
        b.box('metal', 0x9bada9, doorX, winY, face + 0.086, 0.055, wh, 0.025)
        b.box('metal', 0x9bada9, doorX, winY, face + 0.086, ww, 0.044, 0.025)
      }
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const wz = (i - 1) * d * 0.26
        b.box('paint', 0xc1c2b4, s * (w / 2 + 0.025), h * 0.58, wz, 0.08, h * 0.43, d * 0.18)
        b.box('glass', 0x526a6b, s * (w / 2 + 0.075), h * 0.58, wz, 0.028, h * 0.38, d * 0.16)
        b.box('metal', 0x96a9a3, s * (w / 2 + 0.097), h * 0.58, wz, 0.028, 0.046, d * 0.16)
        b.box('metal', 0x96a9a3, s * (w / 2 + 0.097), h * 0.58, wz, 0.028, h * 0.38, 0.052)
      }
    }
  })
}

function addLamp(b, x, y, z, side) {
  b.post('metal', 0x727f7b, x, y + 2.03, z, 0.049, 4.08)
  b.box('metal', 0x84918a, x + side * 0.32, y + 4.06, z, 0.7, 0.062, 0.06)
  b.box('hardware', 0x4a5654, x + side * 0.62, y + 4.0, z, 0.32, 0.105, 0.23)
  b.box('paint', 0xd8d8b8, x + side * 0.62, y + 3.935, z, 0.27, 0.021, 0.18)
}

function bankPoint(edge, along, depth) {
  if (edge === 'north')
    return [along, -47 - 1.15 * Math.sin(along * 0.109) - 0.9 * Math.cos(along * 0.051) - depth]
  if (edge === 'south') return [along, 39.1 + 0.45 * Math.cos(along * 0.12) + depth]
  const sign = edge === 'east' ? 1 : -1
  return [sign * (45.5 + 1.3 * Math.sin(along * 0.091) + 0.48 * Math.cos(along * 0.16) + depth), along]
}

function addGroundSection(THREE, group, resources, edge, from, to, grain) {
  const n = Math.ceil((to - from) / 2.3)
  const depths = [0, 1.5, 4.0, 10, 21, 40]
  const levels = [-0.9, 0.46, 1.51, 2.26, 3.1, 4.62]
  const colors = [0x596b64, 0x8a9283, 0xa5a18b, 0x858e66, 0x75825e, 0x748464]
  const pos = [],
    color = [],
    idx = [],
    uv = []
  const tint = new THREE.Color()
  for (let i = 0; i <= n; i++) {
    const along = from + ((to - from) * i) / n
    for (let k = 0; k < depths.length; k++) {
      const [x, z] = bankPoint(edge, along, depths[k])
      const variance = 0.92 + 0.06 * Math.sin(along * 0.45 + k) + 0.037 * Math.cos(along * 0.91)
      const taper = Math.min(1, (along - from) / 9, (to - along) / 9)
      const y =
        -0.95 + taper * (levels[k] + 0.95 + Math.min(0.85, k * 0.15) * Math.sin(along * 0.141 + k * 0.37))
      pos.push(x, y, z)
      uv.push(x * 0.24, z * 0.24)
      tint.setHex(colors[k]).multiplyScalar(variance)
      color.push(tint.r, tint.g, tint.b)
      if (i < n && k < depths.length - 1) {
        const a = i * depths.length + k,
          b = a + depths.length
        idx.push(a, b, b + 1, a, b + 1, a + 1)
      }
    }
  }
  const shape = new THREE.BufferGeometry()
  shape.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  shape.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  shape.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  shape.setIndex(idx)
  shape.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    side: THREE.DoubleSide,
    map: grain,
  })
  const mesh = new THREE.Mesh(shape, mat)
  mesh.name = '自然驳岸'
  group.add(mesh)
  resources.geometries.push(shape)
  resources.materials.push(mat)
}

function plantTree(b, x, y, z, h, random) {
  if (b.materials.grove && random() < 0.9) {
    const yaw = random() * TAU
    const width = h * (1.11 + 0.22 * random()),
      height = h * (0.91 + 0.15 * random())
    b.part('grove', 'grove', 0xf2f2e7, x, y - 0.41, z, width, height, 1, 0, yaw)
    b.part(
      'grove',
      'grove',
      0xedf2ed,
      x,
      y - 0.39,
      z,
      width * 0.89,
      height * 0.96,
      1,
      0,
      yaw + Math.PI * 0.51,
    )
    return
  }
  const pine = random() < 0.6
  const treePalette = pine
    ? [0x415d46, 0x557153, 0x496751, 0x628065]
    : [0x66845a, 0x819660, 0x627d50, 0x748e5e]
  const c = treePalette[Math.floor(random() * treePalette.length)]
  const tilt = (random() - 0.5) * 0.12
  b.post('wood', 0x766f55, x, y + h * 0.29, z, h * (pine ? 0.027 : 0.037), h * 0.58)
  if (pine) {
    const r = h * (0.28 + 0.075 * random())
    b.part(
      'pine',
      'needles',
      c,
      x,
      y + h * 0.1,
      z,
      r,
      h * 0.91,
      r * (0.82 + 0.32 * random()),
      tilt,
      random() * TAU,
      tilt * 0.6,
    )
  } else {
    const radius = h * 0.245
    for (let i = 0; i < 4; i++) {
      const a = (i * TAU) / 3 + random() * 0.5
      const s = i === 3 ? 1.22 : 1.05
      b.part(
        'crown',
        'paint',
        c,
        x + (i === 3 ? 0 : Math.cos(a) * radius * 0.61),
        y + h * (i === 3 ? 0.72 : 0.54),
        z + (i === 3 ? 0 : Math.sin(a) * radius * 0.57),
        radius * s,
        h * (i === 3 ? 0.275 : 0.2),
        radius * s,
        tilt,
        random() * TAU,
        0.12,
      )
    }
  }
}

function makeBanks(THREE, group, b, resources, layout, random) {
  const intervals = [
    ['north', -133, 13],
    ['north', 58, 139],
    ['east', -95, 77],
    ['west', -91, 83],
    ['south', -78, 76],
  ]
  for (const [edge, lo, hi] of intervals) {
    addGroundSection(THREE, group, resources, edge, lo, hi, b.materials.rough.map)
    for (let d = lo + 7; d < hi - 7; d += 1.85 + random() * 0.74) {
      const upper = 8 + random() * 17
      const [tx, tz] = bankPoint(edge, d, upper)
      const ground = 1.7 + upper * 0.063
      plantTree(b, tx, ground, tz, 3.45 + random() * 5.1, random)
      if (random() > 0.53) {
        const [px, pz] = bankPoint(edge, d + 0.75, 3.8 + random() * 4)
        b.part(
          'crown',
          'paint',
          random() > 0.45 ? 0x77865d : 0x778353,
          px,
          1.56 + random() * 0.3,
          pz,
          0.5 + random() * 0.55,
          0.4 + random() * 0.5,
          0.62 + random() * 0.64,
          0,
          random() * TAU,
          0.09,
        )
      }
      if (random() > 0.48) {
        const [px, pz] = bankPoint(edge, d, random() * 1.25)
        b.part(
          'stone' + Math.floor(random() * 3),
          'rough',
          random() > 0.43 ? 0x929286 : 0x7d867b,
          px,
          0.04 + random() * 0.24,
          pz,
          0.52 + random() * 0.74,
          0.36 + random() * 0.4,
          0.41 + random() * 0.6,
          random() * 0.33,
          random() * TAU,
          random() * 0.4,
        )
      }
    }
  }

  // North quay apron and the line of boat sheds visible beyond the inspection area.
  b.box('rough', 0x91968d, -16, 0.46, -50.5, 57, 1.62, 8.4)
  b.box('rough', 0xb8baad, -16, 1.3, -50.5, 57.2, 0.12, 8.56)
  b.box('rough', 0x61776f, -16, -0.02, -46.27, 57, 0.28, 0.11)
  for (let x = -43; x <= 10; x += 5.8) {
    bollard(b, x, 1.38, -46.75, 0.69)
    if (x < 9) addTire(b, x + 2.6, 0.46, -46.18, 0.89)
  }
  addWarehouse(b, -36.5, -51.7, 1.35, 7.2, 3.05, 13.6, Math.PI * 0.49, 1)
  addWarehouse(b, -23, -52.1, 1.35, 7.8, 3.62, 8.9, -0.018, 0)
  addWarehouse(b, -13.7, -53.1, 1.35, 6.5, 2.78, 5.5, 0.028, 3)
  addWarehouse(b, 0.3, -52.1, 1.35, 6.6, 3.22, 12.1, -Math.PI * 0.48, 1)
  for (let x = -42; x <= 10; x += 10.3) addLamp(b, x, 1.38, -46.95, 1)

  // Each side bank receives its own apron so randomized port layouts remain grounded.
  for (const [index, site] of [layout.pier, layout.wall].entries()) {
    const side = Math.sign(site.x) || 1
    const sx = side * 46.4
    b.box('rough', 0x9da294, sx, 0.44, site.z, 5.5, 1.48, 19)
    b.box('rough', 0xbfc0b0, sx, 1.22, site.z, 5.65, 0.13, 19.1)
    addWarehouse(
      b,
      side * 48.9,
      site.z - 3.9,
      1.26,
      6.5,
      3.0,
      5.5,
      side > 0 ? -Math.PI / 2 : Math.PI / 2,
      index + 1,
    )
    addLamp(b, side * 44.65, 1.29, site.z + 4.8, -side)
  }
  b.box('rough', 0x989d91, 0, 0.44, 40.1, 61, 1.61, 4.1)
  b.box('rough', 0xb0b4a6, 0, 1.3, 40.1, 61.2, 0.18, 4.25)
  addWarehouse(b, -13.5, 43.7, 1.43, 7.2, 3.1, 5.2, Math.PI, 0)
  addWarehouse(b, 18.4, 44.0, 1.43, 8.4, 3.2, 5.8, Math.PI, 3)
  for (const site of [layout.east, layout.west]) addLamp(b, site.x, 1.42, 40.3, site.x > 0 ? -1 : 1)
}

function harborBirds(THREE, root, resources) {
  const positions = [
    -0.91, 0.06, 0.0, -0.41, 0.23, -0.07, -0.13, -0.008, 0.074, -0.41, 0.23, -0.07, 0, 0.005, -0.02, -0.13,
    -0.008, 0.074, 0, 0.005, -0.02, 0.41, 0.23, -0.07, 0.13, -0.008, 0.074, 0.13, -0.008, 0.074, 0.41, 0.23,
    -0.07, 0.91, 0.06, 0.0, -0.11, 0.04, 0.15, 0.11, 0.04, 0.15, 0, 0.052, -0.32,
  ]
  const shape = new THREE.BufferGeometry()
  shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.MeshBasicMaterial({ color: 0x747f82, side: THREE.DoubleSide, fog: true })
  const birds = new THREE.InstancedMesh(shape, mat, 5)
  birds.name = '远岸的海鸟'
  birds.frustumCulled = false
  root.add(birds)
  resources.materials.push(mat)
  resources.geometries.push(shape)
  const pose = new THREE.Object3D()
  return (t) => {
    for (let i = 0; i < birds.count; i++) {
      const phase = t * 0.057 + i * 1.56
      pose.position.set(
        -18 + Math.sin(phase) * 23 + i * 1.8,
        9.4 + i * 0.83 + Math.sin(phase * 1.38) * 1.45,
        -44 + Math.cos(phase) * 9.6 - i * 1.12,
      )
      pose.rotation.set(
        0.05,
        Math.atan2(23 * Math.cos(phase), -9.6 * Math.sin(phase)),
        0.14 * Math.cos(phase) + 0.095 * Math.sin(t * 0.8 + i),
      )
      pose.scale.setScalar(0.51 + i * 0.018)
      pose.updateMatrix()
      birds.setMatrixAt(i, pose.matrix)
    }
    birds.instanceMatrix.needsUpdate = true
  }
}

// Prepare the alpha before mipmapping, keeping the studio backdrop out of distant leaves.
let groveSheet
function extractGrove(image) {
  const canvas = document.createElement('canvas')
  canvas.width = 496
  canvas.height = 480
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 499, 500, 487, 482, 0, 0, canvas.width, canvas.height)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const rgba = pixels.data
  const clamp = (v) => Math.max(0, Math.min(1, v))
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      const r = rgba[i],
        g = rgba[i + 1],
        b = rgba[i + 2]
      const light = Math.max(r, g, b)
      const chroma = (Math.max(r, g) - b) / Math.max(38, light)
      const dark = clamp((103 - light) / 84)
      const feather =
        clamp(Math.min(x, canvas.width - 1 - x) / 14) * clamp(Math.min(y, canvas.height - 1 - y) / 8)
      const alpha = clamp((chroma + 0.13 * dark - 0.083) / 0.22) * feather
      const background = 1 - alpha
      // The matte on the atlas is cool grey. Removing its contribution prevents pale fringes.
      const correction = Math.max(alpha, 0.07)
      rgba[i] = Math.max(0, Math.min(r, (r - 202 * background) / correction)) * 0.9
      rgba[i + 1] = Math.max(0, Math.min(g, (g - 207 * background) / correction)) * 0.95
      rgba[i + 2] = Math.max(0, Math.min(b, (b - 215 * background) / correction)) * 0.88
      rgba[i + 3] = Math.round(255 * alpha)
    }
  }
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

function photographicGrove(THREE, resources) {
  if (typeof document === 'undefined') return null
  if (!groveSheet) {
    const source = new Image()
    source.src = environmentUrl
    groveSheet = source.decode().then(() => extractGrove(source))
  }
  const blank = document.createElement('canvas')
  blank.width = 496
  blank.height = 480
  const map = new THREE.CanvasTexture(blank)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 4
  groveSheet
    .then((sheet) => {
      blank.getContext('2d').drawImage(sheet, 0, 0)
      map.userData.ready = true
      map.needsUpdate = true
    })
    .catch(() => {
      /* The modeled evergreens remain visible if the atlas cannot load. */
    })
  resources.textures.push(map)
  return new THREE.MeshBasicMaterial({
    map,
    side: THREE.DoubleSide,
    alphaTest: 0.38,
    alphaToCoverage: true,
  })
}

export function buildHarbor(THREE, scene, layout) {
  const root = new THREE.Group()
  root.name = '港池环境'
  scene.add(root)
  const resources = { geometries: [], materials: [], textures: [] }
  const geometry = {
    box: new THREE.BoxGeometry(1, 1, 1),
    round: new THREE.CylinderGeometry(1, 1, 1, 12),
    roofCone: new THREE.ConeGeometry(1, 1, 12),
    tire: new THREE.TorusGeometry(0.339, 0.111, 7, 18),
    ring: new THREE.TorusGeometry(1, 0.034, 5, 16),
    gable: gable(THREE),
    pine: pineCanopy(THREE),
    grove: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0),
    crown: new THREE.IcosahedronGeometry(1, 1),
    stone0: irregularStone(THREE, 0),
    stone1: irregularStone(THREE, 1),
    stone2: irregularStone(THREE, 2),
  }
  resources.geometries.push(...Object.values(geometry))
  const woodMap = surfaceTexture(THREE, true)
  const mineralMap = surfaceTexture(THREE, false)
  resources.textures.push(woodMap, mineralMap)
  const standard = (roughness, metalness, extra = {}) =>
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness,
      metalness,
      ...extra,
    })
  const material = {
    wood: standard(0.71, 0.03, { map: woodMap }),
    rough: standard(0.86, 0.025, { map: mineralMap }),
    paint: standard(0.74, 0.025),
    metal: standard(0.54, 0.25),
    hardware: standard(0.62, 0.26),
    rubber: standard(0.85, 0.02),
    glass: standard(0.32, 0.22),
    needles: standard(0.9, 0.0, { vertexColors: true }),
  }
  const grove = photographicGrove(THREE, resources)
  if (grove) material.grove = grove
  resources.materials.push(...Object.values(material))
  let ambient = false,
    directional = false
  scene.traverse((node) => {
    if (node.isAmbientLight || node.isHemisphereLight) ambient = true
    if (node.isDirectionalLight) directional = true
  })
  if (!ambient) root.add(new THREE.HemisphereLight(0xe0eff9, 0xa2b0a0, 1.42))
  if (!directional) {
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.0)
    sun.position.set(-45, 62, 23)
    root.add(sun)
  }
  const originalFog = scene.fog
  if (!scene.fog) scene.fog = new THREE.FogExp2(0xb9d1dd, 0.0049)
  const uniforms = addSkyAndWater(THREE, root, layout, resources)
  const reflectedPanorama = uniforms.skyPhoto.value
  const oldEnvironmentIntensity = scene.environmentIntensity
  const provideEnvironment = !scene.environment && typeof document !== 'undefined'
  if (provideEnvironment) {
    reflectedPanorama.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = reflectedPanorama
    scene.environmentIntensity = 0.56
  }
  const random = seededRandom(18564)
  const parts = (name, label) => new Parts(THREE, root, geometry, material, name, label)
  const shoreline = parts('工作岸线', 'shore')
  makeBanks(THREE, shoreline.group, shoreline, resources, layout, random)
  shoreline.finish()
  const pier = parts('木栈桥', 'pier')
  addPier(pier, layout.pier, random)
  pier.finish()
  const breakwater = parts('防波堤', 'wall')
  addBreakwater(breakwater, layout.wall, random)
  breakwater.finish()
  for (const [which, display] of [
    ['east', '东泊位'],
    ['west', '西泊位'],
  ]) {
    const berth = parts(display, which)
    addBerth(berth, layout[which])
    berth.finish()
  }
  const moveBirds = harborBirds(THREE, root, resources)
  let disposed = false
  function update(time, wind = 1) {
    if (disposed) return
    uniforms.seconds.value = Number.isFinite(time) ? time : 0
    if (Number.isFinite(wind)) uniforms.breeze.value = Math.min(1.6, Math.max(0.56, 0.64 + wind * 0.21))
    moveBirds(uniforms.seconds.value)
  }
  function dispose() {
    if (disposed) return
    disposed = true
    root.traverse((node) => {
      if (node.isInstancedMesh) node.dispose()
    })
    scene.remove(root)
    if (!originalFog) scene.fog = null
    if (provideEnvironment && scene.environment === reflectedPanorama) {
      scene.environment = null
      scene.environmentIntensity = oldEnvironmentIntensity
    }
    for (const list of [resources.geometries, resources.materials, resources.textures])
      for (const resource of list) resource.dispose()
  }
  update(0)
  return { group: root, update, dispose }
}
