import React, { useState, useEffect, useRef } from 'react';
import { 
  MapPin, 
  Plus, 
  Link, 
  Compass, 
  Navigation, 
  Activity, 
  AlertTriangle, 
  Check, 
  X, 
  Layers, 
  Info, 
  HelpCircle,
  Eye,
  RefreshCw
} from 'lucide-react';

interface Surface {
  label: string;
  spd: number;
  k_surf: number;
  risk: number;
  planing: boolean;
  hard: boolean;
  color: string;
  dashArray?: string;
}

interface Edge {
  from: string;
  to: string;
  km: number;
  surface: string;
}

interface Path {
  id: string;
  nodes: string[];
  edges: Edge[];
  totalLength: number;
  totalTime: number;
  totalFuel: number;
  totalRisk: number;
  isAllowed: boolean;
  blockingReason?: string;
  planingPct: number;
}

interface CanvasMapProps {
  nodeCoords: Record<string, [number, number]>;
  nodeDescs: Record<string, string>;
  edges: Edge[];
  surfaces: Record<string, Surface>;
  activePathId: string;
  allPaths: Path[];
  activeMode: string;
  activeCushion: 'without_boost' | 'with_boost';
  boatConfig: any;
  modes: any;
  cushionConfigs: any;
  onAddWaypoint: (name: string, coords: [number, number], desc: string) => void;
  onAddEdge: (from: string, to: string, surface: string, km: number) => void;
  onResetGraph: () => void;
}

// Bounding box of the Krasnoyarsk Reservoir area
const MAP_BOUNDS = {
  minLat: 55.830,
  maxLat: 55.960,
  minLon: 91.900,
  maxLon: 92.330,
};

// Yenisey River midline definition for physical distance calculations and vector rendering
const RIVER_MIDLINE: [number, number][] = [
  [55.932, 92.290], // Дивногорск
  [55.922, 92.250],
  [55.918, 92.220], // Полынья
  [55.910, 92.180],
  [55.885, 92.170], // Болото
  [55.880, 92.080], // Узел-М
  [55.872, 92.030], // Чисто
  [55.858, 92.040], // Шуга
  [55.860, 91.950], // Бирюса
];

// Helper: Calculate distance from a lat/lon point to a line segment in kilometers
function getDistanceToSegmentKm(p: [number, number], a: [number, number], b: [number, number]) {
  const latP = p[0], lonP = p[1];
  const latA = a[0], lonA = a[1];
  const latB = b[0], lonB = b[1];
  
  const dLat = (latB - latA) * 111;
  const dLon = (lonB - lonA) * 111 * Math.cos(55.9 * Math.PI / 180);
  
  const pLat = (latP - latA) * 111;
  const pLon = (lonP - lonA) * 111 * Math.cos(55.9 * Math.PI / 180);
  
  const segLenSq = dLat * dLat + dLon * dLon;
  if (segLenSq === 0) {
    return Math.sqrt(pLat * pLat + pLon * pLon);
  }
  
  let t = (pLat * dLat + pLon * dLon) / segLenSq;
  t = Math.max(0, Math.min(1, t));
  
  const closestLat = latA * 111 + t * dLat;
  const closestLon = lonA * 111 * Math.cos(55.9 * Math.PI / 180) + t * dLon;
  
  const diffLat = latP * 111 - closestLat;
  const diffLon = lonP * 111 * Math.cos(55.9 * Math.PI / 180) - closestLon;
  
  return Math.sqrt(diffLat * diffLat + diffLon * diffLon);
}

// Helper: Get minimum distance to any river segment
function getMinDistanceToRiverKm(p: [number, number]): number {
  let minD = Infinity;
  for (let i = 0; i < RIVER_MIDLINE.length - 1; i++) {
    const d = getDistanceToSegmentKm(p, RIVER_MIDLINE[i], RIVER_MIDLINE[i + 1]);
    if (d < minD) {
      minD = d;
    }
  }
  return minD;
}

export default function CanvasMap({
  nodeCoords,
  nodeDescs,
  edges,
  surfaces,
  activePathId,
  allPaths,
  activeMode,
  activeCushion,
  boatConfig,
  modes,
  cushionConfigs,
  onAddWaypoint,
  onAddEdge,
  onResetGraph
}: CanvasMapProps) {
  
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Interaction states (Pan & Zoom)
  const [zoom, setZoom] = useState<number>(1.1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 600, height: 500 });

  // Map settings
  const [mapStyle, setMapStyle] = useState<'dark' | 'satellite' | 'terrain'>('dark');
  const [mapMode, setMapMode] = useState<'inspect' | 'add_point' | 'add_edge'>('inspect');

  // Hover states for tooltips / sonar
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null); // index of edge
  
  // Placement/creation workflow states
  const [pointCreationCoords, setPointCreationCoords] = useState<[number, number] | null>(null);
  const [newPointName, setNewPointName] = useState<string>('');
  const [newPointDesc, setNewPointDesc] = useState<string>('');
  const [newPointTerrain, setNewPointTerrain] = useState<string>('water');

  const [edgeSourceNode, setEdgeSourceNode] = useState<string | null>(null);
  const [edgeTargetNode, setEdgeTargetNode] = useState<string | null>(null);
  const [newEdgeSurface, setNewEdgeSurface] = useState<string>('water');

  // Animation flow
  const animationFrameRef = useRef<number>(0);
  const dashOffsetRef = useRef<number>(0);

  // Monitor element sizing and keep canvas in perfect sync
  useEffect(() => {
    if (!containerRef.current) return;
    
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  // Coordinate Projection Helpers based on canvas dimensions, zoom, and panning offsets
  const getCanvasCoords = (lat: number, lon: number) => {
    const pad = 60;
    const w = dimensions.width;
    const h = dimensions.height;

    // Relative progress in MAP_BOUNDS
    const xPct = (lon - MAP_BOUNDS.minLon) / (MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon);
    const yPct = 1 - (lat - MAP_BOUNDS.minLat) / (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat);

    // Initial projection
    const baseRawX = pad + xPct * (w - 2 * pad);
    const baseRawY = pad + yPct * (h - 2 * pad);

    // Center of projection
    const centerX = w / 2;
    const centerY = h / 2;

    // Apply zoom & pan centered on the screen center
    const px = centerX + (baseRawX - centerX) * zoom + pan.x;
    const py = centerY + (baseRawY - centerY) * zoom + pan.y;

    return { x: px, y: py };
  };

  // Convert canvas pixel coordinates back to Geo-coordinates
  const getGeoCoords = (x: number, y: number) => {
    const pad = 60;
    const w = dimensions.width;
    const h = dimensions.height;

    const centerX = w / 2;
    const centerY = h / 2;

    // Undo zoom & pan
    const baseRawX = (x - pan.x - centerX) / zoom + centerX;
    const baseRawY = (y - pan.y - centerY) / zoom + centerY;

    // Undo padding
    const xPct = (baseRawX - pad) / (w - 2 * pad);
    const yPct = (baseRawY - pad) / (h - 2 * pad);

    const lon = MAP_BOUNDS.minLon + xPct * (MAP_BOUNDS.maxLon - MAP_BOUNDS.minLon);
    const lat = MAP_BOUNDS.minLat + (1 - yPct) * (MAP_BOUNDS.maxLat - MAP_BOUNDS.minLat);

    // Bound check
    const boundedLat = Math.max(MAP_BOUNDS.minLat, Math.min(MAP_BOUNDS.maxLat, lat));
    const boundedLon = Math.max(MAP_BOUNDS.minLon, Math.min(MAP_BOUNDS.maxLon, lon));

    return [boundedLat, boundedLon] as [number, number];
  };

  // Dragging handlers for map panning
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if clicked near a node in waypoint connection mode or inspect mode
    let clickedNode: string | null = null;
    Object.entries(nodeCoords).forEach(([name, coords]) => {
      const c = getCanvasCoords(coords[0], coords[1]);
      const dist = Math.hypot(x - c.x, y - c.y);
      if (dist < 15) {
        clickedNode = name;
      }
    });

    if (mapMode === 'add_edge' && clickedNode) {
      if (!edgeSourceNode) {
        setEdgeSourceNode(clickedNode);
      } else if (edgeSourceNode !== clickedNode) {
        setEdgeTargetNode(clickedNode);
      }
      return;
    }

    if (mapMode === 'add_point') {
      const geo = getGeoCoords(x, y);
      setPointCreationCoords(geo);
      const minD = getMinDistanceToRiverKm(geo);
      const isRiver = minD < 1.3;
      const pointId = Object.keys(nodeCoords).length + 1;
      
      setNewPointName(`Точка-${pointId}`);
      setNewPointDesc(
        isRiver 
          ? `Промежуточный навигационный пост №${pointId}. Расположен в глубоком судоходном русле.` 
          : `Пользовательский ориентир №${pointId} у береговой полосы.`
      );
      setNewPointTerrain(isRiver ? 'water' : 'ice');
      return;
    }

    // Start panning
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCursorPos({ x, y });

    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
      return;
    }

    // Detect node hovering
    let hoverNodeName: string | null = null;
    Object.entries(nodeCoords).forEach(([name, coords]) => {
      const c = getCanvasCoords(coords[0], coords[1]);
      const dist = Math.hypot(x - c.x, y - c.y);
      if (dist < 12) {
        hoverNodeName = name;
      }
    });
    setHoveredNode(hoverNodeName);

    // Detect edge hovering (if not hovering a node)
    if (!hoverNodeName) {
      let hoverEdgeIdx: number | null = null;
      edges.forEach((edge, idx) => {
        const fromC = getCanvasCoords(nodeCoords[edge.from][0], nodeCoords[edge.from][1]);
        const toC = getCanvasCoords(nodeCoords[edge.to][0], nodeCoords[edge.to][1]);
        
        // Distance from point to line segment in screen pixels
        const lineLenSq = Math.hypot(toC.x - fromC.x, toC.y - fromC.y) ** 2;
        if (lineLenSq > 0) {
          let t = ((x - fromC.x) * (toC.x - fromC.x) + (y - fromC.y) * (toC.y - fromC.y)) / lineLenSq;
          t = Math.max(0, Math.min(1, t));
          const cx = fromC.x + t * (toC.x - fromC.x);
          const cy = fromC.y + t * (toC.y - fromC.y);
          const dist = Math.hypot(x - cx, y - cy);
          if (dist < 6) {
            hoverEdgeIdx = idx;
          }
        }
      });
      setHoveredEdge(hoverEdgeIdx);
    } else {
      setHoveredEdge(null);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    if (e.deltaY < 0) {
      // Zoom in
      setZoom(z => Math.min(5.0, z * zoomFactor));
    } else {
      // Zoom out
      setZoom(z => Math.max(0.4, z / zoomFactor));
    }
  };

  // Floating forms action triggers
  const saveWaypoint = () => {
    if (pointCreationCoords && newPointName.trim()) {
      onAddWaypoint(newPointName.trim(), pointCreationCoords, newPointDesc || 'Пользовательский маяк.');
      setPointCreationCoords(null);
      setMapMode('inspect');
    }
  };

  const saveEdge = () => {
    if (edgeSourceNode && edgeTargetNode) {
      const fromC = nodeCoords[edgeSourceNode];
      const toC = nodeCoords[edgeTargetNode];
      
      // Calculate real distance using physical formula (km)
      const latDiff = (toC[0] - fromC[0]) * 111;
      const lonDiff = (toC[1] - fromC[1]) * 111 * Math.cos(55.9 * Math.PI / 180);
      const calculatedDistance = Math.round(Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 10) / 10;
      
      onAddEdge(edgeSourceNode, edgeTargetNode, newEdgeSurface, calculatedDistance || 1.0);
      
      // Reset linkage state
      setEdgeSourceNode(null);
      setEdgeTargetNode(null);
      setMapMode('inspect');
    }
  };

  const activePathObj = allPaths.find(p => p.id === activePathId);

  // Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let localFrameId: number;

    const render = () => {
      // Increment line dash flow
      dashOffsetRef.current = (dashOffsetRef.current - 0.25) % 24;

      // 1. Clear Screen
      ctx.clearRect(0, 0, dimensions.width, dimensions.height);

      // Define style palettes
      const isSatellite = mapStyle === 'satellite';
      const isTerrain = mapStyle === 'terrain';

      // Backgrounds
      if (isSatellite) {
        ctx.fillStyle = '#060a14'; // Dark satellite space
      } else if (isTerrain) {
        ctx.fillStyle = '#111823'; // Tech terrain color
      } else {
        ctx.fillStyle = '#080b11'; // Pure dark navigation slate
      }
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);

      // Draw Grid Lines (Dynamic Tactical Grid)
      ctx.strokeStyle = isSatellite ? 'rgba(56, 189, 248, 0.05)' : 'rgba(30, 41, 59, 0.4)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      
      // Horizontal Grid lines
      for (let i = 1; i < 8; i++) {
        const gridY = (dimensions.height / 8) * i;
        ctx.beginPath();
        ctx.moveTo(0, gridY);
        ctx.lineTo(dimensions.width, gridY);
        ctx.stroke();
      }
      // Vertical Grid lines
      for (let i = 1; i < 8; i++) {
        const gridX = (dimensions.width / 8) * i;
        ctx.beginPath();
        ctx.moveTo(gridX, 0);
        ctx.lineTo(gridX, dimensions.height);
        ctx.stroke();
      }

      // 2. Draw Vector River Bed Shape (The main Yenisey water body)
      // This is the river recognition area which we draw with wide gradient pathing
      ctx.beginPath();
      RIVER_MIDLINE.forEach((coord, index) => {
        const c = getCanvasCoords(coord[0], coord[1]);
        if (index === 0) {
          ctx.moveTo(c.x, c.y);
        } else {
          ctx.lineTo(c.x, c.y);
        }
      });
      
      // Stroke wide transparent river bed
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = isSatellite ? 'rgba(14, 116, 144, 0.35)' : 'rgba(14, 165, 233, 0.12)';
      ctx.lineWidth = 55 * zoom; // river bed average width
      ctx.setLineDash([]);
      ctx.stroke();

      // Stroke inner channel
      ctx.strokeStyle = isSatellite ? 'rgba(6, 182, 212, 0.4)' : 'rgba(14, 165, 233, 0.18)';
      ctx.lineWidth = 28 * zoom;
      ctx.stroke();

      // Highlight the exact river center track (ship passage line)
      ctx.strokeStyle = 'rgba(14, 165, 233, 0.15)';
      ctx.lineWidth = 3 * zoom;
      ctx.setLineDash([6, 12]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Shore Outline lines for aesthetics (Outer boundaries)
      ctx.beginPath();
      RIVER_MIDLINE.forEach((coord, index) => {
        const c = getCanvasCoords(coord[0], coord[1]);
        // Shift slightly north/south to simulate shorelines
        if (index === 0) ctx.moveTo(c.x, c.y - 25 * zoom);
        else ctx.lineTo(c.x, c.y - 25 * zoom);
      });
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      RIVER_MIDLINE.forEach((coord, index) => {
        const c = getCanvasCoords(coord[0], coord[1]);
        if (index === 0) ctx.moveTo(c.x, c.y + 25 * zoom);
        else ctx.lineTo(c.x, c.y + 25 * zoom);
      });
      ctx.stroke();

      // 3. Draw All Edges (Route Segments)
      edges.forEach((edge, idx) => {
        const fromCoord = nodeCoords[edge.from];
        const toCoord = nodeCoords[edge.to];
        if (!fromCoord || !toCoord) return;

        const cFrom = getCanvasCoords(fromCoord[0], fromCoord[1]);
        const cTo = getCanvasCoords(toCoord[0], toCoord[1]);

        const surf = surfaces[edge.surface];
        const isHovered = hoveredEdge === idx;
        const isPartofActiveRoute = activePathObj?.edges.some(
          ae => (ae.from === edge.from && ae.to === edge.to)
        );

        ctx.beginPath();
        ctx.moveTo(cFrom.x, cFrom.y);
        ctx.lineTo(cTo.x, cTo.y);

        // Core line logic
        if (isPartofActiveRoute) {
          // Glow background for active path
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.25)';
          ctx.lineWidth = 11 * zoom;
          ctx.setLineDash([]);
          ctx.stroke();

          // Active path sliding glowing dash
          ctx.strokeStyle = '#f97316'; // Vibrant orange
          ctx.lineWidth = 5 * zoom;
          ctx.setLineDash([12, 10]);
          ctx.lineDashOffset = dashOffsetRef.current;
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          // Standard segment lines
          ctx.strokeStyle = isHovered ? '#38bdf8' : surf.color;
          ctx.lineWidth = isHovered ? 4.5 * zoom : 2.5 * zoom;
          ctx.globalAlpha = isHovered ? 1.0 : 0.45;
          
          if (surf.dashArray) {
            // Translate dash string to number array
            const dashes = surf.dashArray.split(',').map(Number);
            ctx.setLineDash(dashes);
          } else {
            ctx.setLineDash([]);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1.0;
        }
      });

      // 4. Draw Waypoint Beacon Nodes (Beacons)
      Object.entries(nodeCoords).forEach(([name, coords]) => {
        const c = getCanvasCoords(coords[0], coords[1]);
        const isStart = name === "Дивногорск";
        const isFinish = name === "Бирюса";
        const isActiveNode = activePathObj?.nodes.includes(name);
        const isHovered = hoveredNode === name;
        const isLinkedSource = edgeSourceNode === name;

        // Draw pulsing outer glow rings
        const pulseSize = 10 + Math.sin(Date.now() / 180) * 3;
        ctx.beginPath();
        ctx.arc(c.x, c.y, (isHovered ? 14 : 9) + pulseSize * 0.4, 0, Math.PI * 2);
        
        if (isStart) {
          ctx.fillStyle = 'rgba(34, 197, 94, 0.12)';
          ctx.strokeStyle = 'rgba(34, 197, 94, 0.35)';
        } else if (isFinish) {
          ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
        } else if (isActiveNode) {
          ctx.fillStyle = 'rgba(249, 115, 22, 0.12)';
          ctx.strokeStyle = 'rgba(249, 115, 22, 0.35)';
        } else if (isLinkedSource) {
          ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
        } else {
          ctx.fillStyle = 'rgba(14, 165, 233, 0.08)';
          ctx.strokeStyle = 'rgba(14, 165, 233, 0.25)';
        }
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();

        // Core marker point
        ctx.beginPath();
        ctx.arc(c.x, c.y, isHovered ? 6 : 4, 0, Math.PI * 2);
        if (isStart) {
          ctx.fillStyle = '#22c55e'; // Green start
        } else if (isFinish) {
          ctx.fillStyle = '#f59e0b'; // Gold finish
        } else if (isActiveNode) {
          ctx.fillStyle = '#f97316'; // Orange active route
        } else {
          ctx.fillStyle = '#38bdf8'; // Blue waypoint
        }
        ctx.fill();

        // Inner white dot
        ctx.beginPath();
        ctx.arc(c.x, c.y, isHovered ? 2.5 : 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Label Text
        ctx.font = isHovered ? 'bold 11px sans-serif' : '500 10px sans-serif';
        ctx.fillStyle = isHovered ? '#ffffff' : '#94a3b8';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#020617';
        ctx.shadowBlur = 4;
        ctx.fillText(name, c.x, c.y - 12 - (isHovered ? 2 : 0));
        ctx.shadowBlur = 0; // reset
      });

      // 5. Draw Sonar Sweep Ring at Cursor Pos
      if (cursorPos && mapMode === 'inspect') {
        const sweepTime = (Date.now() / 1200) % 1;
        const radius = sweepTime * 45;
        ctx.beginPath();
        ctx.arc(cursorPos.x, cursorPos.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(56, 189, 248, ${1 - sweepTime})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Cursor pointer dot
        ctx.beginPath();
        ctx.arc(cursorPos.x, cursorPos.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.7)';
        ctx.fill();
      }

      // 6. Draw dynamic scale bar in lower-right
      const scaleX = dimensions.width - 130;
      const scaleY = dimensions.height - 25;
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(scaleX, scaleY - 4);
      ctx.lineTo(scaleX, scaleY);
      ctx.lineTo(scaleX + 80, scaleY);
      ctx.lineTo(scaleX + 80, scaleY - 4);
      ctx.stroke();

      // Label scale
      ctx.font = '9px monospace';
      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'center';
      const scaleKm = Math.round((80 / zoom) * 0.05 * 10) / 10; // estimate
      ctx.fillText(`${scaleKm} км`, scaleX + 40, scaleY - 6);

      localFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(localFrameId);
    };
  }, [dimensions, zoom, pan, mapStyle, nodeCoords, edges, hoveredNode, hoveredEdge, activePathId, mapMode, edgeSourceNode]);

  // Handle zooming using buttons
  const zoomIn = () => setZoom(z => Math.min(5.0, z * 1.25));
  const zoomOut = () => setZoom(z => Math.max(0.4, z / 1.25));
  const resetMap = () => {
    setZoom(1.1);
    setPan({ x: 0, y: 0 });
    setMapMode('inspect');
    setEdgeSourceNode(null);
    setEdgeTargetNode(null);
  };

  // Sonar radar variables under cursor
  let sonarData = null;
  if (cursorPos) {
    const geo = getGeoCoords(cursorPos.x, cursorPos.y);
    const minD = getMinDistanceToRiverKm(geo);

    let classification = 'Таёжный склон (Суша)';
    let depth = 0;
    let surfaceType = 'land';
    let safety = 'Опасность столкновения / Суша';
    let actionTip = 'Запрещено для Raptor (без нагнетателя)';

    if (minD < 1.1) {
      classification = 'Главный судовой фарватер (р. Енисей)';
      depth = Math.round(14.5 - minD * 4);
      surfaceType = 'water';
      safety = 'Безопасный глубокий фарватер';
      actionTip = 'Стабильное скольжение / Глиссирование разрешено';
    } else if (minD < 2.5) {
      classification = 'Прибрежная песчаная отмель';
      depth = Math.max(0.5, Math.round((2.5 - minD) * 3 * 10) / 10);
      surfaceType = 'shallow';
      safety = 'Риск посадки на мель (глубина < 2м)';
      actionTip = 'Перейти в режим нагнетателя подушки!';
    } else if (minD < 3.2) {
      classification = 'Каменистая отмель берега';
      depth = 0;
      surfaceType = 'rocks';
      safety = 'Высокий риск повреждения корпуса!';
      actionTip = 'Включить поддув на максимум!';
    }

    sonarData = {
      lat: geo[0].toFixed(5),
      lon: geo[1].toFixed(5),
      dist: minD.toFixed(2),
      classification,
      depth,
      safety,
      actionTip,
      surfaceType
    };
  }

  return (
    <section className="flex-1 h-full relative" id="navigator-map-view">
      
      {/* Dynamic Toolbar Overlay (Style & Mode Selectors) */}
      <div className="absolute top-4 left-4 z-[50] flex flex-col sm:flex-row gap-2" id="canvas-toolbar">
        {/* Map Style Selector */}
        <div className="flex bg-slate-900/90 backdrop-blur-md p-1 rounded-xl border border-slate-800 shadow-lg">
          <button
            onClick={() => setMapStyle('dark')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mapStyle === 'dark'
                ? 'bg-sky-500 text-slate-900 font-bold'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Радар
          </button>
          <button
            onClick={() => setMapStyle('satellite')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mapStyle === 'satellite'
                ? 'bg-sky-500 text-slate-900 font-bold'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Спутник
          </button>
          <button
            onClick={() => setMapStyle('terrain')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mapStyle === 'terrain'
                ? 'bg-sky-500 text-slate-900 font-bold'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Топография
          </button>
        </div>

        {/* Tactical Navigation Modes */}
        <div className="flex bg-slate-950/95 backdrop-blur-md p-1 rounded-xl border border-emerald-900/40 shadow-xl gap-1">
          <button
            onClick={() => {
              setMapMode('inspect');
              setEdgeSourceNode(null);
              setEdgeTargetNode(null);
            }}
            title="Осмотр карты и сонарное зондирование"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mapMode === 'inspect'
                ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-slate-800/30'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Сонар</span>
          </button>

          <button
            onClick={() => {
              setMapMode('add_point');
              setEdgeSourceNode(null);
              setEdgeTargetNode(null);
            }}
            title="Добавить новые путевые точки кликом"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mapMode === 'add_point'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-slate-800/30'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Точка</span>
          </button>

          <button
            onClick={() => {
              setMapMode('add_edge');
              setEdgeSourceNode(null);
              setEdgeTargetNode(null);
            }}
            title="Проложить новые сектора связей между точками"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mapMode === 'add_edge'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-slate-800/30'
            }`}
          >
            <Link className="w-3.5 h-3.5" />
            <span>+ Сектор</span>
          </button>
        </div>
      </div>

      {/* Floating Action Trigger for Graph Reset */}
      <div className="absolute top-4 right-4 z-[50]">
        <button
          onClick={onResetGraph}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-900/90 hover:bg-slate-800/95 border border-slate-800 hover:border-slate-700 text-slate-300 transition-all shadow-md"
          title="Сбросить карту на базовый сценарий"
        >
          <RefreshCw className="w-3 h-3 text-sky-400 animate-spin-slow" />
          <span>Сброс сценария</span>
        </button>
      </div>

      {/* Dynamic Floating Form for Waypoint Creation */}
      {pointCreationCoords && (
        <div className="absolute top-20 left-4 z-[60] bg-slate-950/95 border border-emerald-900/50 rounded-2xl p-4 w-80 shadow-2xl backdrop-blur-md space-y-3.5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-emerald-950/80 pb-2">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
              <MapPin className="w-4 h-4" />
              Новый Маяк Навигации
            </span>
            <button onClick={() => setPointCreationCoords(null)} className="text-gray-500 hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="text-[10px] text-gray-500 uppercase font-mono block mb-1">Название точки:</label>
              <input
                type="text"
                value={newPointName}
                onChange={(e) => setNewPointName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                placeholder="Например: Посты-3"
              />
            </div>

            <div>
              <label className="text-[10px] text-gray-500 uppercase font-mono block mb-1">Координаты:</label>
              <div className="text-[11px] font-mono text-emerald-400/90 bg-slate-900/80 px-2 py-1.5 rounded-lg border border-slate-900">
                {pointCreationCoords[0].toFixed(5)}°N, {pointCreationCoords[1].toFixed(5)}°E
              </div>
            </div>

            <div>
              <label className="text-[10px] text-gray-500 uppercase font-mono block mb-1">Описание / Сводка штурмана:</label>
              <textarea
                value={newPointDesc}
                onChange={(e) => setNewPointDesc(e.target.value)}
                rows={2}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none"
                placeholder="Инструкции прохождения..."
              />
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setPointCreationCoords(null)}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-slate-900 hover:bg-slate-850 text-gray-400 border border-slate-800 transition-all"
            >
              Отмена
            </button>
            <button
              onClick={saveWaypoint}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-all shadow-md shadow-emerald-950/40"
            >
              Добавить
            </button>
          </div>
        </div>
      )}

      {/* Floating Action Menu for Link (Edge) Creation */}
      {mapMode === 'add_edge' && (
        <div className="absolute top-20 left-4 z-[60] bg-slate-950/95 border border-amber-900/50 rounded-2xl p-4 w-80 shadow-2xl backdrop-blur-md space-y-3.5">
          <div className="flex items-center justify-between border-b border-amber-950 pb-2">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-400">
              <Link className="w-4 h-4" />
              Прокладка судового сектора
            </span>
            <button onClick={() => setMapMode('inspect')} className="text-gray-500 hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <p className="text-gray-400 text-[11px] leading-relaxed">
              Выберите на карте последовательно две точки, чтобы соединить их новым фарватером.
            </p>

            <div className="space-y-2">
              <div className="flex justify-between items-center bg-slate-900 p-2 rounded-lg border border-slate-800">
                <span className="text-gray-400">Старт сектора:</span>
                <span className={`font-semibold ${edgeSourceNode ? 'text-amber-400' : 'text-gray-600 italic'}`}>
                  {edgeSourceNode || 'Кликните точку'}
                </span>
              </div>
              
              <div className="flex justify-between items-center bg-slate-900 p-2 rounded-lg border border-slate-800">
                <span className="text-gray-400">Финиш сектора:</span>
                <span className={`font-semibold ${edgeTargetNode ? 'text-amber-400' : 'text-gray-600 italic'}`}>
                  {edgeTargetNode || 'Кликните точку'}
                </span>
              </div>
            </div>

            {edgeSourceNode && edgeTargetNode && (
              <div className="space-y-2.5 pt-1 animate-in slide-in-from-top-2 duration-200">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase font-mono block mb-1">Покрытие пути:</label>
                  <select
                    value={newEdgeSurface}
                    onChange={(e) => setNewEdgeSurface(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none"
                  >
                    {Object.entries(surfaces).map(([key, val]) => (
                      <option key={key} value={key}>{val.label} ({val.spd} км/ч)</option>
                    ))}
                  </select>
                </div>

                <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800/80 text-[11px] space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Вычисленное расстояние:</span>
                    <strong className="text-sky-400 font-mono">
                      {(() => {
                        const fromC = nodeCoords[edgeSourceNode];
                        const toC = nodeCoords[edgeTargetNode];
                        const latDiff = (toC[0] - fromC[0]) * 111;
                        const lonDiff = (toC[1] - fromC[1]) * 111 * Math.cos(55.9 * Math.PI / 180);
                        return Math.round(Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) * 10) / 10;
                      })()} км
                    </strong>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => {
                      setEdgeSourceNode(null);
                      setEdgeTargetNode(null);
                    }}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-slate-900 hover:bg-slate-850 text-gray-400 border border-slate-800 transition-all"
                  >
                    Очистить
                  </button>
                  <button
                    onClick={saveEdge}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-amber-600 hover:bg-amber-500 text-white font-semibold transition-all shadow-md shadow-amber-950/40"
                  >
                    Проложить
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Vector HTML5 Canvas Element */}
      <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-slate-950 cursor-crosshair">
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          className="absolute inset-0 block"
        />

        {/* Dynamic Zoom & Pan Controls (Bottom-Right Floating) */}
        <div className="absolute bottom-4 right-4 z-[50] flex flex-col gap-1.5 bg-slate-900/90 backdrop-blur-md p-1.5 rounded-xl border border-slate-800 shadow-xl">
          <button
            onClick={zoomIn}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-white hover:bg-slate-800 font-bold transition-all text-sm"
            title="Приблизить"
          >
            +
          </button>
          <button
            onClick={zoomOut}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-white hover:bg-slate-800 font-bold transition-all text-sm"
            title="Отдалить"
          >
            −
          </button>
          <div className="h-[1px] bg-slate-800 mx-1 my-0.5"></div>
          <button
            onClick={resetMap}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-300 hover:text-white hover:bg-slate-800 transition-all"
            title="Сбросить центр"
          >
            <Compass className="w-4 h-4 text-sky-400 animate-pulse" />
          </button>
        </div>

        {/* Dynamic Sonar / Radar HUD (Floating Top-Right) */}
        {sonarData && mapMode === 'inspect' && (
          <div className="absolute top-4 right-4 z-[40] max-w-xs bg-slate-950/95 backdrop-blur-md p-3.5 rounded-xl border border-sky-900/50 shadow-2xl hidden md:block animate-in fade-in duration-300">
            <h5 className="text-[10px] font-bold uppercase tracking-wider text-sky-400 mb-2 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 animate-pulse" />
              Тактический Сонар-Сканер
            </h5>
            <div className="space-y-1.5 text-[11px] leading-relaxed">
              <div className="flex justify-between">
                <span className="text-gray-500">Координаты:</span>
                <span className="font-mono text-gray-300">{sonarData.lat}, {sonarData.lon}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Дистанция до русла:</span>
                <span className="font-mono text-sky-400 font-semibold">{sonarData.dist} км</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Эхолот (Глубина):</span>
                <span className="font-mono text-emerald-400 font-bold">
                  {sonarData.depth > 0 ? `${sonarData.depth} м` : 'Суша'}
                </span>
              </div>
              
              <div className="border-t border-slate-900/80 pt-1.5 mt-1.5 space-y-1">
                <span className="text-[10px] font-bold text-gray-400 block uppercase">Распознавание ИИ:</span>
                <span className="text-white font-medium block text-xs">{sonarData.classification}</span>
                <div className="flex items-center gap-1 text-[10px] text-amber-400">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                  <span>{sonarData.safety}</span>
                </div>
                <div className="text-[9px] text-gray-400 bg-slate-900/60 p-1.5 rounded border border-slate-900 mt-1 leading-normal font-mono">
                  {sonarData.actionTip}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Hover details for selected Edge/Node directly on bottom bar */}
        {(hoveredNode || hoveredEdge !== null) && (
          <div className="absolute bottom-4 left-4 z-[50] max-w-md bg-slate-950/95 border border-slate-800 p-3 rounded-xl shadow-xl animate-in slide-in-from-bottom-2 duration-150">
            {hoveredNode && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-sky-400" />
                  <strong className="text-xs text-white">{hoveredNode}</strong>
                  <span className="text-[9px] font-mono text-gray-500 bg-slate-900 px-1 py-0.5 rounded">
                    Ш: {nodeCoords[hoveredNode][0].toFixed(4)}°, Д: {nodeCoords[hoveredNode][1].toFixed(4)}°
                  </span>
                </div>
                <p className="text-[10px] text-gray-300 leading-normal">
                  {nodeDescs[hoveredNode] || 'Навигационная точка.'}
                </p>
              </div>
            )}

            {hoveredEdge !== null && !hoveredNode && (
              <div className="space-y-1 text-xs">
                {(() => {
                  const edge = edges[hoveredEdge];
                  const surf = surfaces[edge.surface];
                  const speed_factor = activeMode === "быстрый" ? 1.15 : activeMode === "экономичный" ? 0.90 : 1.0;
                  const currentSpeed = Math.round(surf.spd * speed_factor);
                  const fuelSegment = Math.round(edge.km * boatConfig.base_l_per_km * surf.k_surf * cushionConfigs[activeCushion].k_load * modes[activeMode].k_mode * 10) / 10;
                  return (
                    <>
                      <div className="flex items-center justify-between border-b border-slate-900 pb-1 mb-1">
                        <span className="font-semibold text-white">{edge.from} &rarr; {edge.to}</span>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-slate-100" style={{ backgroundColor: surf.color }}>
                          {surf.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-400 font-mono">
                        <div>Длина: <strong className="text-sky-400">{edge.km} км</strong></div>
                        <div>Скорость: <strong className="text-emerald-400">{currentSpeed} км/ч</strong></div>
                        <div>Расход: <strong className="text-orange-400">{fuelSegment} л</strong></div>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Map Overlay legend/info widgets */}
      <div className="absolute bottom-4 left-4 z-[40] max-w-xs bg-slate-900/95 backdrop-blur-md p-4 rounded-xl border border-slate-800/80 shadow-xl hidden sm:block pointer-events-none" id="map-overlay-legend">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200 mb-2 border-b border-slate-800 pb-1.5">
          Легенда Трассы Енисея
        </h4>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="h-0.5 w-6 bg-gradient-to-r from-orange-500 to-amber-500 inline-block rounded"></span>
            <span className="text-slate-100 font-semibold">Активный Путь Raptor 650</span>
          </div>
          <div className="h-[1px] bg-slate-800/60 my-2"></div>
          {Object.entries(surfaces).map(([key, valVal]) => {
            const val = valVal as Surface;
            return (
              <div key={key} className="flex items-center justify-between text-xs text-gray-300">
                <div className="flex items-center gap-2">
                  <span 
                    className="h-1.5 w-5 inline-block rounded" 
                    style={{ 
                      backgroundColor: val.color,
                      borderStyle: val.dashArray ? 'dashed' : 'solid',
                      borderWidth: val.dashArray ? '1px' : '0px'
                    }}
                  ></span>
                  <span>{val.label}</span>
                </div>
                <span className="font-mono text-[10px] text-gray-500">{val.spd} км/ч</span>
              </div>
            );
          })}
        </div>
      </div>

    </section>
  );
}
