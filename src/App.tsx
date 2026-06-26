/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Navigation, 
  Compass, 
  Shield, 
  Activity, 
  Layers, 
  Settings, 
  AlertTriangle, 
  Anchor, 
  Clock, 
  Fuel, 
  MapPin, 
  RotateCcw, 
  HelpCircle, 
  Info, 
  Sliders, 
  Wind, 
  Thermometer, 
  Check, 
  X, 
  ChevronRight, 
  Wifi, 
  WifiOff,
  Ship,
  Sparkles,
  Gauge
} from 'lucide-react';
import CanvasMap from './components/CanvasMap';

// Define TS Interfaces for our structured data
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
  surface: string; // key of surfaces
}

interface Path {
  id: string;
  nodes: string[];
  edges: Edge[];
  totalLength: number;
  totalTime: number; // in hours
  totalFuel: number; // in liters
  totalRisk: number; // cumulative risk (length * risk)
  isAllowed: boolean;
  blockingReason?: string;
  planingPct: number;
}

export default function App() {
  // 1. Core State derived from the JSON scenario
  const [boatConfig, setBoatConfig] = useState({
    name: "Raptor 650",
    length_m: 6.9,
    width_m: 2.45,
    capacity: 6,
    engine: "Honda J35, 280 л.с.",
    tank_l: 370,
    base_l_per_km: 0.8,
    payload_t: "1.0–1.5",
    reserve_frac_tank: 0.2
  });

  // Active cushion config ("без поддува" vs "с поддувом")
  const [activeCushion, setActiveCushion] = useState<'without_boost' | 'with_boost'>('with_boost');

  // Cushion parameters
  const cushionConfigs = {
    without_boost: {
      label: "Без поддува",
      k_load: 1.0,
      allow_hard: false,
      desc: "Стандартный режим хода без воздушного нагнетателя. Проход по камням и болотам невозможен."
    },
    with_boost: {
      label: "С поддувом (Воздушная подушка)",
      k_load: 1.12,
      allow_hard: true,
      desc: "Включение поддува снижает трение о жесткие препятствия. Позволяет проходить камни и болота."
    }
  };

  // Customizable surfaces state
  const [surfaces, setSurfaces] = useState<Record<string, Surface>>({
    water: {
      label: "Вода (открытая)",
      spd: 58,
      k_surf: 1.0,
      risk: 2,
      planing: true,
      hard: false,
      color: "#0284c7", // Bright cyan/blue
    },
    ice: {
      label: "Лёд",
      spd: 64,
      k_surf: 0.9,
      risk: 1,
      planing: true,
      hard: false,
      color: "#e2e8f0", // Ice white
    },
    shallow: {
      label: "Мелководье",
      spd: 34,
      k_surf: 1.4,
      risk: 4,
      planing: false,
      hard: false,
      color: "#eab308", // Yellow, dashed
      dashArray: "5, 5"
    },
    grass: {
      label: "Трава/камыш",
      spd: 30,
      k_surf: 1.5,
      risk: 3,
      planing: false,
      hard: false,
      color: "#22c55e", // Green
    },
    slush: {
      label: "Шуга/наледь",
      spd: 28,
      k_surf: 1.7,
      risk: 4,
      planing: false,
      hard: false,
      color: "#a855f7", // Purple, dashed
      dashArray: "6, 4"
    },
    rocks: {
      label: "Камни",
      spd: 24,
      k_surf: 1.65,
      risk: 6,
      planing: false,
      hard: true,
      color: "#ef4444", // Red, dotted
      dashArray: "2, 4"
    },
    marsh: {
      label: "Болото",
      spd: 20,
      k_surf: 1.9,
      risk: 7,
      planing: false,
      hard: true,
      color: "#f97316", // Orange, dotted
      dashArray: "3, 6"
    }
  });

  // Routing modes
  const [activeMode, setActiveMode] = useState<string>("быстрый");
  const modes: Record<string, { obj: string; k_mode: number; desc: string; icon: any }> = {
    "быстрый": {
      obj: "time",
      k_mode: 1.15,
      desc: "Минимум расчётного времени хода за счёт форсированной скорости.",
      icon: Clock
    },
    "экономичный": {
      obj: "fuel",
      k_mode: 0.95,
      desc: "Минимум расхода топлива на оптимальных оборотах двигателя.",
      icon: Fuel
    },
    "кратчайший": {
      obj: "length",
      k_mode: 1.0,
      desc: "Минимум длины маршрута с учётом ограничений проходимости.",
      icon: Compass
    },
    "безопасный": {
      obj: "risk",
      k_mode: 1.05,
      desc: "Обход зон повышенного риска и неблагоприятных покрытий.",
      icon: Shield
    },
    "глиссирование": {
      obj: "planing",
      k_mode: 1.05,
      desc: "Максимальное поддержание глиссирования на чистой воде и ровном льду.",
      icon: Gauge
    }
  };

  // Base map default definitions (to allow easy reset)
  const DEFAULT_EDGES = [
    { from: "Дивногорск", to: "Полынья", km: 8, surface: "water" },
    { from: "Полынья", to: "Узел-М", km: 15, surface: "ice" },
    { from: "Дивногорск", to: "Лёд-1", km: 11, surface: "ice" },
    { from: "Лёд-1", to: "Узел-М", km: 13, surface: "ice" },
    { from: "Дивногорск", to: "Камни", km: 6, surface: "rocks" },
    { from: "Камни", to: "Узел-М", km: 11, surface: "ice" },
    { from: "Дивногорск", to: "Болото", km: 7, surface: "marsh" },
    { from: "Болото", to: "Узел-М", km: 12, surface: "ice" },
    { from: "Узел-М", to: "Шуга", km: 9, surface: "slush" },
    { from: "Шуга", to: "Бирюса", km: 6, surface: "shallow" },
    { from: "Узел-М", to: "Чисто", km: 13, surface: "ice" },
    { from: "Чисто", to: "Бирюса", km: 9, surface: "ice" }
  ];

  const DEFAULT_COORDS: Record<string, [number, number]> = {
    "Дивногорск": [55.932, 92.290],
    "Полынья": [55.918, 92.220],
    "Лёд-1": [55.902, 92.190],
    "Камни": [55.925, 92.160],
    "Болото": [55.885, 92.170],
    "Узел-М": [55.880, 92.080],
    "Шуга": [55.858, 92.040],
    "Чисто": [55.872, 92.030],
    "Бирюса": [55.860, 91.950]
  };

  const DEFAULT_DESCS: Record<string, string> = {
    "Дивногорск": "Старт маршрута. Причал в районе Красноярской ГЭС. Координаты швартовки.",
    "Полынья": "Зона открытой воды. Требуется повышенное внимание, глиссирование на высокой скорости.",
    "Лёд-1": "Участок стабильного ровного льда. Оптимальные условия для скольжения.",
    "Камни": "Мелководная каменная гряда. Смертельно опасна без воздушного поддува!",
    "Болото": "Заросшая болотистая отмель на левом берегу. Проходима только с поддувом.",
    "Узел-М": "Промежуточный навигационный хаб. Развилка путей в Бирюсинский залив.",
    "Шуга": "Наледь, скопление рыхлого льда со снегом. Снижение скорости, повышенное сопротивление.",
    "Чисто": "Скоростной ледовый коридор. Отсутствие торосов.",
    "Бирюса": "Финиш маршрута. Залив Бирюса, территория ТИМ (Территория Инициативной Молодёжи)."
  };

  const [edges, setEdges] = useState<Edge[]>(DEFAULT_EDGES);
  const [nodeCoords, setNodeCoords] = useState<Record<string, [number, number]>>(DEFAULT_COORDS);
  const [nodeDescs, setNodeDescs] = useState<Record<string, string>>(DEFAULT_DESCS);

  // Handlers for adding custom points and links via interactive Canvas Map
  const handleAddWaypoint = (name: string, coords: [number, number], desc: string) => {
    setNodeCoords(prev => ({ ...prev, [name]: coords }));
    setNodeDescs(prev => ({ ...prev, [name]: desc }));
  };

  const handleAddEdge = (from: string, to: string, surface: string, km: number) => {
    const newEdge: Edge = { from, to, km, surface };
    setEdges(prev => [...prev, newEdge]);
  };

  const handleResetGraph = () => {
    setEdges(DEFAULT_EDGES);
    setNodeCoords(DEFAULT_COORDS);
    setNodeDescs(DEFAULT_DESCS);
  };

  // 2. Active State for Route Selection & Navigation Simulation
  const [allPaths, setAllPaths] = useState<Path[]>([]);
  const [selectedPathId, setSelectedPathId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<'routes' | 'surfaces' | 'boat_specs' | 'help'>('routes');
  const [offlineMode, setOfflineMode] = useState<boolean>(true); // "offline_first: true" is requested
  const [currentMapStyle, setCurrentMapStyle] = useState<'dark' | 'satellite' | 'terrain'>('dark');

  // Simulation controls
  const [simulatedWind, setSimulatedWind] = useState<number>(14); // km/h
  const [simulatedTemp, setSimulatedTemp] = useState<number>(-12); // °C

  // 3. Graph traversal & routing calculations
  useEffect(() => {
    calculatePaths();
  }, [edges, surfaces, boatConfig, activeCushion, activeMode, nodeCoords]);

  const calculatePaths = () => {
    const startNode = "Дивногорск";
    const finishNode = "Бирюса";

    // Build adjacency list
    const adj: Record<string, Edge[]> = {};
    Object.keys(nodeCoords).forEach(n => { adj[n] = []; });
    edges.forEach(edge => {
      adj[edge.from]?.push(edge);
    });

    const foundPaths: Path[] = [];
    let pathCounter = 0;

    // DFS to find all simple paths
    const findPathsDFS = (curr: string, currentPathNodes: string[], currentPathEdges: Edge[]) => {
      if (curr === finishNode) {
        // Calculate metrics
        let totalLength = 0;
        let totalTime = 0;
        let totalFuel = 0;
        let totalRisk = 0;
        let isAllowed = true;
        let blockingReason = "";
        let planingLength = 0;

        const k_load = cushionConfigs[activeCushion].k_load;
        const k_mode = modes[activeMode].k_mode;

        currentPathEdges.forEach(edge => {
          const surf = surfaces[edge.surface];
          totalLength += edge.km;

          if (surf.planing) {
            planingLength += edge.km;
          }

          // Check passability
          if (surf.hard && !cushionConfigs[activeCushion].allow_hard) {
            isAllowed = false;
            blockingReason = `Требуется поддув для участка "${surf.label}" (${edge.from} → ${edge.to})`;
          }

          // Speed on segment: surface base speed adjusted by mode factor, and divided by load coefficient
          // Let's assume mode affects speed: "быстрый" (k_mode=1.15) increases speed, "экономичный" (0.95) decreases it
          let modeSpeedFactor = 1.0;
          if (activeMode === "быстрый") modeSpeedFactor = 1.15;
          if (activeMode === "экономичный") modeSpeedFactor = 0.90; // Cruising speed reduction
          if (activeMode === "безопасный") modeSpeedFactor = 0.95; // Cautious speed

          const segmentSpeed = surf.spd * modeSpeedFactor / (activeCushion === 'with_boost' ? 1.05 : 1.0); 
          // Air cushion adds minor weight load or aerodynamic resistance, but let's calculate:
          const timeSegment = edge.km / segmentSpeed; // hours
          totalTime += timeSegment;

          // Fuel on segment: km × base_consumption × k_surf × k_load × k_mode
          const fuelSegment = edge.km * boatConfig.base_l_per_km * surf.k_surf * k_load * k_mode;
          totalFuel += fuelSegment;

          // Risk rating: length weighted by surface risk
          totalRisk += edge.km * surf.risk;
        });

        pathCounter++;
        foundPaths.push({
          id: `route-${pathCounter}`,
          nodes: [...currentPathNodes],
          edges: [...currentPathEdges],
          totalLength: Math.round(totalLength * 10) / 10,
          totalTime: Math.round(totalTime * 60), // in minutes
          totalFuel: Math.round(totalFuel * 10) / 10,
          totalRisk: Math.round(totalRisk * 10) / 10,
          isAllowed,
          blockingReason,
          planingPct: totalLength > 0 ? Math.round((planingLength / totalLength) * 100) : 0
        });
        return;
      }

      adj[curr]?.forEach(edge => {
        if (!currentPathNodes.includes(edge.to)) {
          currentPathNodes.push(edge.to);
          currentPathEdges.push(edge);
          findPathsDFS(edge.to, currentPathNodes, currentPathEdges);
          currentPathEdges.pop();
          currentPathNodes.pop();
        }
      });
    };

    findPathsDFS(startNode, [startNode], []);

    // Sort paths based on optimization objective of active mode
    const objective = modes[activeMode].obj;
    const sortedPaths = [...foundPaths].sort((a, b) => {
      if (!a.isAllowed && b.isAllowed) return 1;
      if (a.isAllowed && !b.isAllowed) return -1;
      
      if (objective === "time") return a.totalTime - b.totalTime;
      if (objective === "fuel") return a.totalFuel - b.totalFuel;
      if (objective === "length") return a.totalLength - b.totalLength;
      if (objective === "risk") return a.totalRisk - b.totalRisk;
      if (objective === "planing") return b.planingPct - a.planingPct;
      return 0;
    });

    setAllPaths(sortedPaths);

    // Auto select the top allowed path as active route
    const firstAllowed = sortedPaths.find(p => p.isAllowed);
    if (firstAllowed) {
      setSelectedPathId(firstAllowed.id);
    } else if (sortedPaths.length > 0) {
      setSelectedPathId(sortedPaths[0].id);
    }
  };

  // 4. Interactive canvas map handlers & rendering are managed within the custom <CanvasMap /> component.

  // Utility calculations for current active path
  const activePathObj = allPaths.find(p => p.id === selectedPathId);
  const totalLength = activePathObj?.totalLength || 0;
  const totalTimeMinutes = activePathObj?.totalTime || 0;
  const totalFuelLiters = activePathObj?.totalFuel || 0;
  const totalRiskScore = activePathObj?.totalRisk || 0;

  const reserveLiters = Math.round(boatConfig.tank_l * boatConfig.reserve_frac_tank);
  const fuelRemainder = Math.round((boatConfig.tank_l - totalFuelLiters) * 10) / 10;
  const isFuelCritical = fuelRemainder < reserveLiters;
  const isOutOfFuel = fuelRemainder < 0;

  // Average fuel consumption (L/km)
  const avgFuelPerKm = totalLength > 0 ? Math.round((totalFuelLiters / totalLength) * 100) / 100 : 0;
  // Maximum cruising range on remainder
  const maxCruisingRange = avgFuelPerKm > 0 ? Math.round((fuelRemainder > 0 ? fuelRemainder : 0) / avgFuelPerKm) : 0;

  const getRouteExplanation = () => {
    if (!activePathObj) return "";
    
    const containsHard = activePathObj.edges.some(e => surfaces[e.surface].hard);
    const containsPlaningLoss = activePathObj.edges.some(e => !surfaces[e.surface].planing);
    
    let text = `Маршрут оптимизирован под критерий "${activeMode}". `;
    if (activeMode === "быстрый") {
      text += "Выбран кратчайший по времени коридор с максимальной средней скоростью хода.";
    } else if (activeMode === "экономичный") {
      text += "Минимизирован расход топлива за счет снижения крейсерских оборотов и обхода вязких покрытий.";
    } else if (activeMode === "кратчайший") {
      text += "Проложен самый короткий путь напрямую через развилки.";
    } else if (activeMode === "безопасный") {
      text += "Выбран безопасный обходной фарватер с минимальным уровнем риска и аварийных участков.";
    } else if (activeMode === "глиссирование") {
      text += "Маршрут максимизирует прохождение по чистой воде и ровному льду для сохранения устойчивого глиссирования.";
    }
    
    if (containsHard && activeCushion === "with_boost") {
      text += " Включенный воздушный нагнетатель позволяет безопасно преодолевать жесткие участки (камни/болота) на маршруте.";
    }
    if (containsPlaningLoss) {
      text += " Внимание: на пути присутствуют участки сложной текстуры (шуга/мелководье), где глиссирование невозможно и возрастает сопротивление.";
    } else {
      text += " Благоприятные условия позволяют поддерживать стабильное скольжение по всему фарватеру.";
    }
    
    return text;
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden text-slate-100 bg-[#080b11] font-sans" id="navigator-app">
      
      {/* 1. Header Navigation HUD */}
      <header className="flex items-center justify-between px-6 py-4 bg-[#0c111e] border-b border-slate-800/80 shadow-md shrink-0" id="header-hud">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400">
            <Compass className="w-6 h-6 animate-spin-slow" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-wide font-display text-sky-100">
              Кубок Енисея <span className="text-sky-400 text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 ml-2">Цифровой Штурман</span>
            </h1>
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-sky-500" />
              Дивногорск (Красноярская ГЭС) &rarr; Залив Бирюса (ТИМ)
            </p>
          </div>
        </div>

        {/* Dynamic Telemetry HUD Panel */}
        <div className="hidden lg:flex items-center gap-6 text-xs bg-slate-900/50 border border-slate-800/60 rounded-xl px-4 py-2">
          <div className="flex items-center gap-2">
            <Wind className="w-4 h-4 text-emerald-400" />
            <div>
              <div className="text-gray-400 font-medium">Ветер</div>
              <div className="font-mono font-bold text-gray-200">{simulatedWind} км/ч</div>
            </div>
          </div>
          <div className="h-6 w-[1px] bg-slate-800"></div>
          <div className="flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-cyan-400" />
            <div>
              <div className="text-gray-400 font-medium">Темп. воздуха</div>
              <div className="font-mono font-bold text-gray-200">{simulatedTemp}°C</div>
            </div>
          </div>
          <div className="h-6 w-[1px] bg-slate-800"></div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${offlineMode ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></div>
            <div>
              <div className="text-gray-400 font-medium">Режим связи</div>
              <div className="font-semibold text-gray-200">{offlineMode ? 'Автономный (Offline First)' : 'Онлайн (Спутник)'}</div>
            </div>
          </div>
        </div>

        {/* Global Action Toggles */}
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setOfflineMode(!offlineMode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              offlineMode 
                ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20' 
                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20'
            }`}
            title="Переключить автономный режим"
          >
            {offlineMode ? <WifiOff className="w-3.5 h-3.5" /> : <Wifi className="w-3.5 h-3.5" />}
            {offlineMode ? 'ОФФЛАЙН' : 'ОНЛАЙН'}
          </button>
        </div>
      </header>

      {/* 2. Main Pilot Workspace (Grid splitting sidebar & Leaflet container) */}
      <main className="flex flex-1 h-full overflow-hidden" id="navigator-workspace">
        
        {/* SIDEBAR NAVIGATION CONTROL (LEFT PANEL) */}
        <aside className="w-full md:w-[460px] flex flex-col bg-[#0c1220] border-r border-slate-800/80 shrink-0 shadow-lg overflow-hidden" id="navigator-sidebar">
          
          {/* Main Quick Pilot Toggle Tabs */}
          <div className="flex border-b border-slate-800 shrink-0 bg-[#0a0f1c]" id="sidebar-tabs">
            <button
              onClick={() => setActiveTab('routes')}
              className={`flex-1 py-3 text-xs font-bold tracking-wider text-center border-b-2 uppercase transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'routes' 
                  ? 'border-sky-500 text-sky-400 bg-sky-500/5' 
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-slate-800/30'
              }`}
            >
              <Navigation className="w-3.5 h-3.5" />
              Маршруты
            </button>
            <button
              onClick={() => setActiveTab('surfaces')}
              className={`flex-1 py-3 text-xs font-bold tracking-wider text-center border-b-2 uppercase transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'surfaces' 
                  ? 'border-sky-500 text-sky-400 bg-sky-500/5' 
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-slate-800/30'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Покрытия
            </button>
            <button
              onClick={() => setActiveTab('boat_specs')}
              className={`flex-1 py-3 text-xs font-bold tracking-wider text-center border-b-2 uppercase transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'boat_specs' 
                  ? 'border-sky-500 text-sky-400 bg-sky-500/5' 
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-slate-800/30'
              }`}
            >
              <Ship className="w-3.5 h-3.5" />
              Судно
            </button>
            <button
              onClick={() => setActiveTab('help')}
              className={`flex-1 py-3 text-xs font-bold tracking-wider text-center border-b-2 uppercase transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'help' 
                  ? 'border-sky-500 text-sky-400 bg-sky-500/5' 
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-slate-800/30'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Справка
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-slate-900" id="sidebar-content">
            
            {/* === TAB 1: ROUTES AND COMPASS CALCULATIONS === */}
            {activeTab === 'routes' && (
              <div className="space-y-5 animate-fadeIn">
                
                {/* 1A. Boat Air cushion setup */}
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 space-y-3 shadow-inner" id="boat-config-selector">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                      <Sliders className="w-4 h-4 text-sky-400" />
                      Режим нагнетания аэролодки
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${activeCushion === 'with_boost' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'}`}>
                      {cushionConfigs[activeCushion].label}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setActiveCushion('without_boost')}
                      className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left flex flex-col gap-1 border ${
                        activeCushion === 'without_boost'
                          ? 'bg-amber-500/10 border-amber-500/50 text-amber-300'
                          : 'bg-slate-800/30 border-slate-800 text-gray-400 hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="font-bold">Без поддува</span>
                      <span className="text-[10px] text-gray-500">k_load: 1.0 (Легкий ход)</span>
                    </button>
                    <button
                      onClick={() => setActiveCushion('with_boost')}
                      className={`px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left flex flex-col gap-1 border ${
                        activeCushion === 'with_boost'
                          ? 'bg-sky-500/10 border-sky-500/50 text-sky-300'
                          : 'bg-slate-800/30 border-slate-800 text-gray-400 hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="font-bold">С поддувом</span>
                      <span className="text-[10px] text-sky-400">k_load: 1.12 (+Расход)</span>
                    </button>
                  </div>

                  <p className="text-[11px] text-gray-400 leading-relaxed italic bg-slate-950/40 p-2 rounded-lg">
                    {cushionConfigs[activeCushion].desc}
                  </p>
                </div>

                {/* 1B. Optimization routing goals selector */}
                <div className="space-y-2.5" id="routing-mode-selector">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5 px-1">
                    <Compass className="w-4 h-4 text-sky-400" />
                    Критерий оптимизации (Режим хода)
                  </span>

                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(modes).map(([modeKey, modeVal]) => {
                      const IconComponent = modeVal.icon;
                      const isActive = activeMode === modeKey;
                      return (
                        <button
                          key={modeKey}
                          onClick={() => setActiveMode(modeKey)}
                          className={`flex flex-col gap-1 px-3 py-2.5 rounded-xl border text-left transition-all ${
                            isActive
                              ? 'bg-sky-500/10 border-sky-500/50 text-sky-100'
                              : 'bg-slate-900/30 border-slate-800 hover:bg-slate-800/40 text-gray-400 hover:text-gray-200'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <IconComponent className={`w-4 h-4 ${isActive ? 'text-sky-400 animate-pulse' : 'text-gray-500'}`} />
                            <span className="font-semibold text-xs capitalize">{modeKey}</span>
                          </div>
                          <span className="text-[10px] text-gray-400 leading-tight line-clamp-2">
                            {modeVal.desc}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 1C. Active Route Analytics Hud */}
                {activePathObj && (
                  <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-4 shadow-md relative overflow-hidden" id="analytics-hud">
                    
                    {/* Glowing Accent line */}
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-400 via-orange-500 to-amber-500"></div>
                    
                    <div className="flex items-center justify-between pb-1">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                        Текущий Расчёт навигатора
                      </h3>
                      <span className="text-[10px] font-semibold bg-orange-500/10 border border-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                        Активный маршрут #{selectedPathId.replace('route-', '')}
                      </span>
                    </div>

                    {/* Standard Telemetry Metrics Grid */}
                    <div className="grid grid-cols-2 gap-3.5">
                      <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-850 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-400">
                          <Compass className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-400 block font-medium">Расстояние</span>
                          <span className="font-mono text-base font-bold text-sky-300">{totalLength} км</span>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-850 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                          <Clock className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-400 block font-medium">Время в пути</span>
                          <span className="font-mono text-base font-bold text-emerald-300">
                            {Math.floor(totalTimeMinutes / 60)}ч {totalTimeMinutes % 60}м
                          </span>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-850 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center text-orange-400">
                          <Fuel className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-400 block font-medium">Расход топлива</span>
                          <span className="font-mono text-base font-bold text-orange-300">{totalFuelLiters} л</span>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-850 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400">
                          <Shield className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-400 block font-medium">Фактор риска</span>
                          <span className="font-mono text-base font-bold text-red-400">{totalRiskScore}</span>
                        </div>
                      </div>
                    </div>

                    {/* Fuel alert telemetry */}
                    <div className="border-t border-slate-800/80 pt-3.5 space-y-2.5">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-400">Резерв топлива ({Math.round(boatConfig.reserve_frac_tank * 100)}%):</span>
                        <span className="font-mono font-bold text-gray-200">{reserveLiters} л</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-400">Свободный остаток в баке:</span>
                        <span className={`font-mono font-bold ${
                          isOutOfFuel ? 'text-red-500 animate-pulse' : isFuelCritical ? 'text-amber-500' : 'text-emerald-400'
                        }`}>
                          {fuelRemainder} л {isOutOfFuel && '(Сухой бак!)'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-400">Расчетный запас хода:</span>
                        <span className="font-mono font-bold text-sky-400">{maxCruisingRange} км</span>
                      </div>

                      {/* Warnings and errors */}
                      {isOutOfFuel ? (
                        <div className="flex gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[11px] leading-relaxed">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 animate-bounce" />
                          <span>
                            <strong>ВНИМАНИЕ! БАК СУХОЙ!</strong> Общий расход топлива ({totalFuelLiters} л) превышает доступный объем топливной системы ({boatConfig.tank_l} л). Выберите более экономичный маршрут.
                          </span>
                        </div>
                      ) : isFuelCritical ? (
                        <div className="flex gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] leading-relaxed">
                          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>
                            <strong>ВНИМАНИЕ! КРИТИЧЕСКИЙ РЕЗЕРВ!</strong> Остаток топлива упал ниже установленного запаса хода в {reserveLiters} л. Возможна остановка при неблагоприятных условиях.
                          </span>
                        </div>
                      ) : (
                        <div className="flex gap-1.5 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10 text-emerald-400 text-[11px] items-center">
                          <Check className="w-4 h-4" />
                          <span>Топливного резерва достаточно для завершения экспедиции.</span>
                        </div>
                      )}

                      {/* Dynamic Route Choice Explanation */}
                      <div className="bg-slate-950/40 p-2.5 rounded-lg border border-slate-900 text-[11px] text-slate-300 leading-relaxed space-y-1">
                        <strong className="text-slate-200 block text-[10px] uppercase tracking-wider">Обоснование штурмана:</strong>
                        <p>{getRouteExplanation()}</p>
                      </div>

                      {/* Segment breakdown table */}
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Детализация участков пути:</span>
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                          {activePathObj.edges.map((edge, eIdx) => {
                            const surf = surfaces[edge.surface];
                            const speed_mode = activeMode === "быстрый" ? 1.15 : activeMode === "экономичный" ? 0.90 : activeMode === "безопасный" ? 0.95 : 1.0;
                            const speed = Math.round(surf.spd * speed_mode);
                            const k_load = cushionConfigs[activeCushion].k_load;
                            const k_mode = modes[activeMode].k_mode;
                            const fuelSegment = Math.round(edge.km * boatConfig.base_l_per_km * surf.k_surf * k_load * k_mode * 10) / 10;
                            
                            return (
                              <div key={eIdx} className="bg-slate-950/40 border border-slate-900 rounded-lg p-2.5 text-[11px] space-y-1">
                                <div className="flex justify-between font-medium">
                                  <span className="text-gray-200">{edge.from} &rarr; {edge.to}</span>
                                  <span className="font-mono text-sky-400 font-bold">{edge.km} км</span>
                                </div>
                                <div className="flex items-center justify-between text-gray-400 text-[10px]">
                                  <span className="flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: surf.color }}></span>
                                    {surf.label}
                                  </span>
                                  <span className="font-mono">{speed} км/ч • {fuelSegment} л</span>
                                </div>
                                <div className="flex justify-between text-[9px] border-t border-slate-900/40 pt-1 mt-1">
                                  <span className="text-gray-500">Тип: <span className="font-semibold text-gray-300">{surf.hard ? 'Препятствие' : 'Гладкий'}</span></span>
                                  <span className={surf.planing ? "text-emerald-500 font-semibold" : "text-amber-500 font-semibold flex items-center gap-0.5"}>
                                    {surf.planing ? "✓ Глиссирование" : "⚠️ Потеря глиссирования!"}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                    </div>
                  </div>
                )}

                {/* 1D. Comparative analysis of routes */}
                <div className="space-y-3" id="comparative-routes-list">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-sky-400" />
                      Сравнение и Выбор Маршрутов
                    </span>
                    <span className="text-[10px] text-gray-500">Найдено: {allPaths.length}</span>
                  </div>

                  <div className="space-y-2.5">
                    {allPaths.map((path, idx) => {
                      const isSelected = path.id === selectedPathId;
                      const fuelExceeded = path.totalFuel > boatConfig.tank_l;
                      const isOptimal = idx === 0 && path.isAllowed; // First item is the top recommendation under chosen metric

                      return (
                        <div
                          key={path.id}
                          onClick={() => setSelectedPathId(path.id)}
                          className={`relative border rounded-xl p-3.5 transition-all cursor-pointer text-left ${
                            isSelected
                              ? 'bg-slate-900 border-sky-500 shadow-md ring-1 ring-sky-500/20'
                              : 'bg-slate-950/40 border-slate-800 hover:bg-slate-900/30'
                          }`}
                        >
                          {/* Top Tag Badges */}
                          <div className="absolute top-3.5 right-3.5 flex items-center gap-1.5">
                            {isOptimal && (
                              <span className="text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 px-1.5 py-0.5 rounded">
                                РЕКОМЕНДУЕМЫЙ
                              </span>
                            )}
                            {!path.isAllowed && (
                              <span className="text-[9px] font-bold uppercase tracking-wider bg-red-500/15 border border-red-500/30 text-red-400 px-1.5 py-0.5 rounded">
                                БЛОКИРОВАН
                              </span>
                            )}
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono ${
                                  isSelected ? 'bg-sky-500 text-slate-900' : 'bg-slate-800 text-gray-400'
                                }`}>
                                  {idx + 1}
                                </span>
                                <span className="font-bold text-xs text-gray-200">
                                  Маршрут через: {path.nodes[1]} &rarr; {path.nodes[2]} &rarr; {path.nodes[3]}
                                </span>
                              </div>
                              <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800/20" title="Доля глиссирования на маршруте">
                                Глисс: {path.planingPct}%
                              </span>
                            </div>

                            {/* Node chain path breadcrumbs */}
                            <div className="flex flex-wrap items-center gap-1 text-[10px] text-gray-400 pl-7 font-mono">
                              {path.nodes.map((node, nIdx) => (
                                <React.Fragment key={nIdx}>
                                  <span className={nIdx === 0 ? 'text-emerald-400 font-semibold' : nIdx === path.nodes.length - 1 ? 'text-amber-400 font-semibold' : ''}>
                                    {node}
                                  </span>
                                  {nIdx < path.nodes.length - 1 && <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />}
                                </React.Fragment>
                              ))}
                            </div>

                            {/* Metrics snippet */}
                            <div className="grid grid-cols-4 gap-2 text-center text-[10px] pt-1 pl-7">
                              <div className="bg-slate-900/30 border border-slate-800 p-1.5 rounded-lg">
                                <span className="text-gray-500 block">Длина</span>
                                <span className="font-mono font-bold text-sky-400">{path.totalLength} км</span>
                              </div>
                              <div className="bg-slate-900/30 border border-slate-800 p-1.5 rounded-lg">
                                <span className="text-gray-500 block">Время</span>
                                <span className="font-mono font-bold text-emerald-400">
                                  {Math.floor(path.totalTime / 60)}ч {path.totalTime % 60}м
                                </span>
                              </div>
                              <div className="bg-slate-900/30 border border-slate-800 p-1.5 rounded-lg">
                                <span className="text-gray-500 block">Топливо</span>
                                <span className={`font-mono font-bold ${fuelExceeded ? 'text-red-400' : 'text-orange-400'}`}>
                                  {path.totalFuel} л
                                </span>
                              </div>
                              <div className="bg-slate-900/30 border border-slate-800 p-1.5 rounded-lg">
                                <span className="text-gray-500 block">Риск</span>
                                <span className="font-mono font-bold text-red-400">{path.totalRisk}</span>
                              </div>
                            </div>

                            {/* If blocked, show reason */}
                            {!path.isAllowed && path.blockingReason && (
                              <div className="mt-2 text-[10px] text-red-400 bg-red-500/5 p-2 rounded-lg border border-red-500/10 flex items-start gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <span>{path.blockingReason}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            )}

            {/* === TAB 2: INTERACTIVE SURFACES ADJUSTMENT === */}
            {activeTab === 'surfaces' && (
              <div className="space-y-4 animate-fadeIn" id="surfaces-tab">
                <div className="bg-slate-900/40 p-3.5 rounded-xl border border-slate-800 text-xs text-gray-400 leading-relaxed">
                  Показатели скорости, риска и трения зависят от текущего климатического состояния льда на Красноярском водохранилище. Изменяйте параметры поверхностей в реальном времени для симуляции навигационной обстановки.
                </div>

                <div className="space-y-3.5">
                  {Object.entries(surfaces).map(([key, rawSurface]) => {
                    const surface = rawSurface as Surface;
                    return (
                      <div key={key} className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                          <div className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full shadow" style={{ backgroundColor: surface.color }}></span>
                            <span className="font-bold text-xs text-gray-200">{surface.label}</span>
                          </div>
                          <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                            surface.hard ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                          }`}>
                            {surface.hard ? 'Жесткое (Препятствие)' : 'Гладкое'}
                          </span>
                        </div>

                        {/* Surface Parameter Sliders */}
                        <div className="space-y-3.5 text-xs">
                          {/* 1. Speed slider */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between font-medium">
                              <span className="text-gray-400">Базовая скорость аэролодки:</span>
                              <span className="font-mono text-emerald-400 font-bold">{surface.spd} км/ч</span>
                            </div>
                            <input
                              type="range"
                              min="10"
                              max="100"
                              step="2"
                              value={surface.spd}
                              onChange={(e) => {
                                setSurfaces({
                                  ...surfaces,
                                  [key]: { ...surface, spd: parseInt(e.target.value) }
                                });
                              }}
                              className="w-full accent-emerald-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>

                          {/* 2. Resistance multiplier */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between font-medium">
                              <span className="text-gray-400">Коэффициент сопротивления (k_surf):</span>
                              <span className="font-mono text-sky-400 font-bold">{surface.k_surf}x</span>
                            </div>
                            <input
                              type="range"
                              min="0.5"
                              max="2.5"
                              step="0.05"
                              value={surface.k_surf}
                              onChange={(e) => {
                                setSurfaces({
                                  ...surfaces,
                                  [key]: { ...surface, k_surf: parseFloat(e.target.value) }
                                });
                              }}
                              className="w-full accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>

                          {/* 3. Risk indicator */}
                          <div className="space-y-1.5">
                            <div className="flex justify-between font-medium">
                              <span className="text-gray-400">Индекс аварийного риска:</span>
                              <span className="font-mono text-red-400 font-bold">{surface.risk} / 10</span>
                            </div>
                            <input
                              type="range"
                              min="1"
                              max="10"
                              step="1"
                              value={surface.risk}
                              onChange={(e) => {
                                setSurfaces({
                                  ...surfaces,
                                  [key]: { ...surface, risk: parseInt(e.target.value) }
                                });
                              }}
                              className="w-full accent-red-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={() => {
                    // Reset to defaults
                    setSurfaces({
                      water: { label: "Вода (открытая)", spd: 58, k_surf: 1.0, risk: 2, planing: true, hard: false, color: "#0284c7" },
                      ice: { label: "Лёд", spd: 64, k_surf: 0.9, risk: 1, planing: true, hard: false, color: "#e2e8f0" },
                      shallow: { label: "Мелководье", spd: 34, k_surf: 1.4, risk: 4, planing: false, hard: false, color: "#eab308", dashArray: "5, 5" },
                      grass: { label: "Трава/камыш", spd: 30, k_surf: 1.5, risk: 3, planing: false, hard: false, color: "#22c55e" },
                      slush: { label: "Шуга/наледь", spd: 28, k_surf: 1.7, risk: 4, planing: false, hard: false, color: "#a855f7", dashArray: "6, 4" },
                      rocks: { label: "Камни", spd: 24, k_surf: 1.65, risk: 6, planing: false, hard: true, color: "#ef4444", dashArray: "2, 4" },
                      marsh: { label: "Болото", spd: 20, k_surf: 1.9, risk: 7, planing: false, hard: true, color: "#f97316", dashArray: "3, 6" }
                    });
                  }}
                  className="w-full py-2.5 rounded-xl border border-slate-800 hover:border-slate-700 bg-slate-900/40 text-xs font-bold text-gray-400 hover:text-gray-200 transition-all flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Сбросить к исходным данным
                </button>
              </div>
            )}

            {/* === TAB 3: BOAT SPECIFICATIONS & ENGINES === */}
            {activeTab === 'boat_specs' && (
              <div className="space-y-4 animate-fadeIn font-sans" id="boat-specs-tab">
                
                {/* Visual rendering of Raptor 650 */}
                <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/80 rounded-2xl p-4 space-y-4 relative overflow-hidden shadow-lg">
                  <div className="absolute -right-6 -bottom-6 w-32 h-32 bg-sky-500/5 rounded-full filter blur-xl"></div>
                  
                  <div className="flex items-center gap-3 border-b border-slate-800/60 pb-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400">
                      <Ship className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-100">{boatConfig.name}</h3>
                      <p className="text-[11px] text-gray-400">Высокоскоростная грузовая аэролодка</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-slate-900/40 p-2.5 rounded-xl border border-slate-800/40">
                      <span className="text-gray-500 block text-[10px]">Двигатель</span>
                      <span className="font-semibold text-gray-200">{boatConfig.engine}</span>
                    </div>
                    <div className="bg-slate-900/40 p-2.5 rounded-xl border border-slate-800/40">
                      <span className="text-gray-500 block text-[10px]">Запас топлива</span>
                      <span className="font-mono font-bold text-sky-400">{boatConfig.tank_l} л</span>
                    </div>
                    <div className="bg-slate-900/40 p-2.5 rounded-xl border border-slate-800/40">
                      <span className="text-gray-500 block text-[10px]">Габариты (Д × Ш)</span>
                      <span className="font-semibold text-gray-200">{boatConfig.length_m}м × {boatConfig.width_m}м</span>
                    </div>
                    <div className="bg-slate-900/40 p-2.5 rounded-xl border border-slate-800/40">
                      <span className="text-gray-500 block text-[10px]">Полезная нагрузка</span>
                      <span className="font-semibold text-gray-200">{boatConfig.payload_t} т</span>
                    </div>
                  </div>
                </div>

                {/* Boat settings controls */}
                <div className="space-y-3.5 pt-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5 px-1">
                    <Settings className="w-4 h-4 text-sky-400" />
                    Настройки Судовой Системы
                  </span>

                  {/* Slider 1: Base Consumption */}
                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-gray-400">Базовый расход (л/км):</span>
                      <span className="font-mono text-orange-400 font-bold">{boatConfig.base_l_per_km} л/км</span>
                    </div>
                    <input
                      type="range"
                      min="0.4"
                      max="1.5"
                      step="0.05"
                      value={boatConfig.base_l_per_km}
                      onChange={(e) => {
                        setBoatConfig({
                          ...boatConfig,
                          base_l_per_km: parseFloat(e.target.value)
                        });
                      }}
                      className="w-full accent-orange-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    />
                    <p className="text-[10px] text-gray-500 italic leading-snug">
                      Зависит от загрузки, типа карбюратора и оборотов винта. Базовый паспортный расход Raptor 650: 0.8 л/км.
                    </p>
                  </div>

                  {/* Slider 2: Fuel Capacity */}
                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-gray-400">Объем топливного бака (л):</span>
                      <span className="font-mono text-sky-400 font-bold">{boatConfig.tank_l} л</span>
                    </div>
                    <input
                      type="range"
                      min="150"
                      max="500"
                      step="10"
                      value={boatConfig.tank_l}
                      onChange={(e) => {
                        setBoatConfig({
                          ...boatConfig,
                          tank_l: parseInt(e.target.value)
                        });
                      }}
                      className="w-full accent-sky-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>

                  {/* Slider 3: Safety Reserve Percentage */}
                  <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-gray-400">Гарантийный резерв топлива (%):</span>
                      <span className="font-mono text-amber-400 font-bold">{Math.round(boatConfig.reserve_frac_tank * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="10"
                      max="30"
                      step="5"
                      value={boatConfig.reserve_frac_tank * 100}
                      onChange={(e) => {
                        setBoatConfig({
                          ...boatConfig,
                          reserve_frac_tank: parseInt(e.target.value) / 100
                        });
                      }}
                      className="w-full accent-amber-500 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/30 border border-slate-800 text-xs text-gray-400">
                  <Info className="w-4 h-4 text-sky-400 shrink-0" />
                  <span>Параметры Raptor 650 адаптированы под суровые зимние условия Красноярского водохранилища.</span>
                </div>
              </div>
            )}

            {/* === TAB 4: MATHEMATICS & FORMULAS REFERENCE === */}
            {activeTab === 'help' && (
              <div className="space-y-4 animate-fadeIn text-xs leading-relaxed text-gray-300 font-sans" id="help-tab">
                <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
                  <h4 className="font-bold text-sm text-slate-100 border-b border-slate-800 pb-2 flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-sky-400" />
                    Расчётные Формулы Штурмана
                  </h4>

                  <div className="space-y-3">
                    <div>
                      <span className="text-sky-400 font-semibold block font-mono">1. Время на участке (Segment Time):</span>
                      <p className="font-mono text-[11px] bg-slate-950/50 p-1.5 rounded text-emerald-400">
                        t = длина_участка / скорость_на_участке
                      </p>
                      <span className="text-[10px] text-gray-400 italic block mt-1">
                        Где скорость_на_участке зависит от покрытия, коэффициента режима и воздушного поддува.
                      </span>
                    </div>

                    <div className="h-[1px] bg-slate-800"></div>

                    <div>
                      <span className="text-sky-400 font-semibold block font-mono">2. Расход топлива участка (Segment Fuel):</span>
                      <p className="font-mono text-[11px] bg-slate-950/50 p-1.5 rounded text-orange-400">
                        F = L × F_base × k_surf × k_load × k_mode
                      </p>
                      <div className="text-[10px] text-gray-400 space-y-1 mt-1">
                        <div>• <code className="text-gray-300 font-mono font-semibold">L</code>: Длина отрезка в километрах.</div>
                        <div>• <code className="text-gray-300 font-mono font-semibold">F_base</code>: Базовый расход аэролодки ({boatConfig.base_l_per_km} л/км).</div>
                        <div>• <code className="text-gray-300 font-mono font-semibold">k_surf</code>: Коэффициент трения поверхности покрытия.</div>
                        <div>• <code className="text-gray-300 font-mono font-semibold">k_load</code>: Нагнетание воздушной подушки ({cushionConfigs[activeCushion].k_load}).</div>
                        <div>• <code className="text-gray-300 font-mono font-semibold">k_mode</code>: Режим хода ({modes[activeMode].k_mode}).</div>
                      </div>
                    </div>

                    <div className="h-[1px] bg-slate-800"></div>

                    <div>
                      <span className="text-sky-400 font-semibold block font-mono">3. Кумулятивный риск (Cumulative Risk):</span>
                      <p className="font-mono text-[11px] bg-slate-950/50 p-1.5 rounded text-red-400">
                        R = &Sigma; (длина_участка &times; риск_покрытия)
                      </p>
                      <span className="text-[10px] text-gray-400 italic block mt-1">
                        Чем длиннее опасный участок, тем выше суммарный навигационный риск маршрута.
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 space-y-2">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-slate-300">Легенда Покрытий</h4>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {Object.entries(surfaces).map(([key, valueVal]) => {
                      const value = valueVal as Surface;
                      return (
                        <div key={key} className="flex items-center gap-2 bg-slate-950/30 p-1.5 rounded border border-slate-850">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: value.color }}></span>
                          <span className="text-gray-300 truncate">{value.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

          </div>

          {/* Quick status bar at the bottom of sidebar */}
          <div className="p-4 bg-[#0a0e1a] border-t border-slate-800 text-[10px] text-gray-400 flex justify-between shrink-0" id="sidebar-footer">
            <span>© Енисейский Навигатор v2.6</span>
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-sky-400 animate-pulse" />
              Красноярское Вдхр.
            </span>
          </div>

        </aside>

        {/* INTERACTIVE GEOGRAPHIC VECTOR CANVAS MAP CONTAINER (RIGHT SIDE) */}
        <CanvasMap
          nodeCoords={nodeCoords}
          nodeDescs={nodeDescs}
          edges={edges}
          surfaces={surfaces}
          activePathId={selectedPathId}
          allPaths={allPaths}
          activeMode={activeMode}
          activeCushion={activeCushion}
          boatConfig={boatConfig}
          modes={modes}
          cushionConfigs={cushionConfigs}
          onAddWaypoint={handleAddWaypoint}
          onAddEdge={handleAddEdge}
          onResetGraph={handleResetGraph}
        />

      </main>

      {/* Embedded CSS animation for route pulse */}
      <style>{`
        @keyframes routePulse {
          0% {
            stroke-dashoffset: 24;
            opacity: 0.85;
          }
          50% {
            opacity: 1;
          }
          100% {
            stroke-dashoffset: 0;
            opacity: 0.85;
          }
        }
        .active-route-pulse {
          stroke-dasharray: 8, 8;
          animation: routePulse 1.8s linear infinite;
          filter: drop-shadow(0px 0px 4px rgba(249, 115, 22, 0.6));
        }
        .leaflet-container {
          outline: none;
        }
      `}</style>
    </div>
  );
}
