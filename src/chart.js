import {MARKS,gateMarkIds} from './marks.js';
import {plannerName} from './rrt-star.js';
const ink = '#102731';
const vesselColors = { A: '#f3b65a', B: '#65ddc6' };
const labelFont = '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif';
const north = -33;
const south = 43;
const west = -51;
const east = 51;

function makeChartView(width, height) {
  const scaleX = width / (east - west);
  const scaleZ = height / (south - north);
  return {
    width, height, scaleX, scaleZ,
    x: worldX => (worldX - west) * scaleX,
    y: worldZ => (worldZ - north) * scaleZ,
    bearing: yaw => Math.atan2(Math.sin(yaw) * scaleX, Math.cos(yaw) * scaleZ)
  };
}

function drawTrack(ctx, view, points, color, width, dash = []) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(view.x(points[0].x), view.y(points[0].z));
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(view.x(points[i].x), view.y(points[i].z));
  }
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBanks(ctx, view) {
  // The harbor mesh uses the same bank profiles and south quay extents.
  for (const sign of [-1, 1]) {
    const shore = [];
    for (let z = north; z <= south; z += 2) {
      shore.push({ x: sign * (45.5 + 1.3 * Math.sin(z * .091) + .48 * Math.cos(z * .16)), z });
    }
    ctx.beginPath();
    ctx.moveTo(view.x(sign * east), 0);
    for (const p of shore) ctx.lineTo(view.x(p.x), view.y(p.z));
    ctx.lineTo(view.x(sign * east), view.height);
    ctx.fillStyle = '#283e45';
    ctx.fill();
    drawTrack(ctx, view, shore, '#67817f', 1);
  }
  const shore = [];
  for (let x = west; x <= east; x += 2) shore.push({ x, z: 39.1 + .45 * Math.cos(x * .12) });
  ctx.beginPath();
  ctx.moveTo(0, view.height);
  for (const p of shore) ctx.lineTo(view.x(p.x), view.y(p.z));
  ctx.lineTo(view.width, view.height);
  ctx.fill();
  drawTrack(ctx, view, shore, '#66807f', 1);
  drawTrack(ctx, view, [{x: -30.5, z: 38.05}, {x: 30.5, z: 38.05}], '#9aa79d', 1.3);
}

function mapLabel(ctx, text, x, y, color, align = 'left') {
  ctx.textAlign = align;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.8;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawHarbor(ctx, view, layout, compact) {
  const { width, height, scaleX, scaleZ } = view;
  const water = ctx.createLinearGradient(0, 0, 0, height);
  water.addColorStop(0, '#163942');
  water.addColorStop(1, ink);
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#294750';
  ctx.lineWidth = .65;
  ctx.beginPath();
  for (let x = -50; x <= 50; x += 10) {
    ctx.moveTo(view.x(x), 0);
    ctx.lineTo(view.x(x), height);
  }
  for (let z = -30; z <= 40; z += 10) {
    ctx.moveTo(0, view.y(z));
    ctx.lineTo(width, view.y(z));
  }
  ctx.stroke();
  drawBanks(ctx, view);
  ctx.font = (compact ? '9px ' : '10px ') + labelFont;
  for (const [key, label] of [['pier', '栈桥'], ['wall', '堤坝'], ['east', '东泊位'], ['west', '西泊位']]) {
    const { x, z } = layout[key];
    const side = Math.sign(x) || 1;
    const align = side > 0 ? 'left' : 'right';
    const px = view.x(x), py = view.y(z);
    if (key === 'pier' || key === 'wall') {
      const pier = key === 'pier';
      const tip = x + side * (pier ? 6.5 : 7.7);
      const extent = Math.abs(45 * side - tip);
      const depth = pier ? 2.75 : 4.6;
      const innerEdge = Math.min(tip, 45 * side);
      ctx.fillStyle = pier ? '#88785e' : '#627774';
      ctx.fillRect(view.x(innerEdge), view.y(z - depth / 2), extent * scaleX, depth * scaleZ);
      drawTrack(ctx, view, [{x: tip, z}, {x: side * 45, z}], pier ? '#c1ad88' : '#b3c1b4', 1);
      ctx.fillStyle = '#e1c994';
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, 2 * Math.PI);
      ctx.fill();
      mapLabel(ctx, label, px + side * 5, py - 7, '#cad6ce', align);
    } else {
      const deckZ = z + 6.65;
      ctx.fillStyle = '#61736f';
      ctx.fillRect(view.x(x - 1.28), view.y(deckZ), 2.56 * scaleX, (38.05 - deckZ) * scaleZ);
      ctx.fillRect(view.x(x - 3.7), view.y(deckZ - 1.875), 7.4 * scaleX, 3.75 * scaleZ);
      drawTrack(ctx, view, [{x: x - 3.7, z: deckZ - 1.875}, {x: x + 3.7, z: deckZ - 1.875}], '#c4cbbd', 1);
      mapLabel(ctx, label, view.x(x + side * 4.4), view.y(deckZ), '#b3c6c4', align);
    }
  }
  for (const id of gateMarkIds) {
    const {x,z}=layout[id]||MARKS[id].point;
    ctx.fillStyle = MARKS[id].paint==='red'?'#cd867b':'#76ad94';
    ctx.beginPath();
    ctx.arc(view.x(x), view.y(z), 1.8, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.strokeStyle = '#c1d0ca';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(10, 17);
  ctx.lineTo(10, 7);
  ctx.lineTo(7.5, 11);
  ctx.moveTo(10, 7);
  ctx.lineTo(12.5, 11);
  ctx.stroke();
  ctx.font = 'bold 9px sans-serif';
  mapLabel(ctx, 'N', 16, 12, '#c1d0ca');
}

function drawMarker(ctx, view, id, boat, focused, labelSide, close) {
  const x = view.x(boat.x), y = view.y(boat.z);
  const color = vesselColors[id];
  ctx.save();
  ctx.translate(x, y);
  if (focused || close) {
    ctx.beginPath();
    ctx.arc(0, 0, close && !focused ? 11 : 8, 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    ctx.globalAlpha = .68;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.rotate(view.bearing(boat.yaw));
  ctx.beginPath();
  ctx.moveTo(0, -6.4);
  ctx.lineTo(4.3, 4.6);
  ctx.lineTo(0, 2.4);
  ctx.lineTo(-4.3, 4.6);
  ctx.closePath();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  const labelX = Math.max(6, Math.min(view.width - 6, x + labelSide * (close ? 16 : 13)));
  const labelY = Math.max(7, Math.min(view.height - 7, y + 3));
  ctx.font = 'bold 11px "Segoe UI", sans-serif';
  mapLabel(ctx, id, labelX, labelY, color, 'center');
}

function drawLegend(ctx, width, y, height, fleet, hasRoute) {
  ctx.fillStyle = '#10242d';
  ctx.fillRect(0, y, width, height);
  ctx.fillStyle = '#315059';
  ctx.fillRect(0, y, width, .7);
  const middle = y + height / 2 + .5;
  let cursor = 8;
  const key = (label, color, dash = []) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = dash.length ? 1.35 : 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(cursor, middle);
    ctx.lineTo(cursor + 13, middle);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#bfd1ce';
    ctx.fillText(label, cursor + 17, middle);
    cursor += 28 + ctx.measureText(label).width;
  };
  ctx.font = '10px ' + labelFont;
  ctx.textAlign = 'left';
  key(fleet?'A 艇':'实际航迹', vesselColors.A);
  if(hasRoute)key(width<240?plannerName:plannerName+' 规划航线','#d1e1d5',[7,3]);
  if (fleet) {
    key('B 艇', vesselColors.B);
    if(cursor+69<=width)key(fleet.linkFresh ? '链路在线' : '链路待同步', fleet.linkFresh ? '#a5bebe' : '#637a7e', [1,4]);
  }
}

export function drawChart(canvas, run, fleetOverlay = null) {
  const width = canvas.clientWidth || 320;
  const height = canvas.clientHeight || 140;
  const dpr = Math.min(1.7, globalThis.devicePixelRatio || 1);
  const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const fleet = fleetOverlay?.boats?.A && fleetOverlay?.boats?.B ? fleetOverlay : null;
  const follow = fleet?.follow === 'B' ? 'B' : 'A';
  const compact = width < 310 || height < 130;
  const entries = fleet ? [['A', fleet.boats.A], ['B', fleet.boats.B]] : [['A', run]];
  const hasRoute=entries.some(([,v])=>v.nextWaypoint&&!v.awaitingOrder);
  const legendHeight = height >= 94 && width >= 180 && (fleet || hasRoute) ? 19 : 0;
  const view = makeChartView(width, height - legendHeight);
  ctx.save();
  ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, view.height);
  ctx.clip();
  drawHarbor(ctx, view, run.layout, compact);
  for(const [id,vessel] of entries){
    drawTrack(ctx,view,vessel.plannedTrack,vesselColors[id],id===follow?1.65:1.2,[7,3]);
  }
  for(const item of run.litter.items){
    if(item.state!=='water')continue;
    const x=view.x(item.x),y=view.y(item.z);
    ctx.fillStyle=item.kind==='foam'?'#fff0cb':'#94dce8';ctx.strokeStyle=ink;ctx.lineWidth=1;
    ctx.beginPath();
    if(item.kind==='foam')ctx.rect(x-2.4,y-2.4,4.8,4.8);
    else ctx.ellipse(x,y,3.4,1.9,-.6,0,Math.PI*2);
    ctx.fill();ctx.stroke();
  }
  for(const [id,vessel] of entries){
    const track=vessel.cleanup?.track;
    if(!track)continue;
    const x=view.x(track.x),y=view.y(track.z);
    ctx.beginPath();ctx.arc(x,y,6.5,0,Math.PI*2);ctx.strokeStyle=vesselColors[id];ctx.stroke();
    if(id===follow&&!compact)mapLabel(ctx,'视觉锁定',x+8,y-6,'#fff4d9');
  }
  let close = false;
  let leftBoat = 'A';
  if (fleet) {
    const a = fleet.boats.A.boat, b = fleet.boats.B.boat;
    const gapX = (a.x - b.x) * view.scaleX;
    close = Math.hypot(gapX, (a.z - b.z) * view.scaleZ) < 26;
    if (gapX > 1) leftBoat = 'B';
    if (fleet.linkFresh) drawTrack(ctx, view, [a, b], '#92b1b0', 1, [1, 4]);
  }
  if (run.traffic) {
    const ship = run.service();
    ctx.save();
    ctx.translate(view.x(ship.x), view.y(ship.z));
    ctx.rotate(Math.atan2(ship.vz * view.scaleZ, ship.vx * view.scaleX));
    ctx.fillStyle = '#c4b7a3';
    ctx.fillRect(-3.3, -1.4, 6.6, 2.8);
    ctx.restore();
  }
  for (const [id, vessel] of entries) {
    drawTrack(ctx, view, vessel.trace, vesselColors[id], id === follow ? 2 : 1.6);
  }
  // When both positions coincide, keep both labels visible and draw the focused heading last.
  if (follow === 'A') entries.reverse();
  for (const [id, vessel] of entries) {
    const labelSide = close ? (id === leftBoat ? -1 : 1) : (vessel.boat.x < 0 ? 1 : -1);
    drawMarker(ctx, view, id, vessel.boat, id === follow, labelSide, close);
  }
  ctx.restore();
  if (legendHeight) drawLegend(ctx, width, view.height, legendHeight, fleet, hasRoute);
  ctx.restore();
}
